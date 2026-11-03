/**
 * Web Push with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291, RFC 8188),
 * built on WebCrypto only so it runs in workerd without Node polyfills.
 */

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidKeys {
  publicKey: string; // base64url, uncompressed P-256 point (65 bytes)
  privateKey: string; // base64url, 32-byte private scalar
  subject: string; // mailto: or https: contact for the push service
}

const encoder = new TextEncoder();
const enc = { encode: (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(encoder.encode(s)) };

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** Signed VAPID JWT for the push service that owns `endpoint`. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys): Promise<string> {
  const pub = b64urlDecode(keys.publicKey);
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: keys.privateKey,
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    ext: true,
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: keys.subject,
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  // WebCrypto returns the raw r||s signature that JWS ES256 expects.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}

/** Encrypts `payload` for one subscription as a single aes128gcm record. */
export async function encryptPayload(sub: PushSubscriptionRow, payload: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);

  const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as SubtleCryptoDeriveKeyAlgorithm, local.privateKey, 256),
  );

  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02 marks the last (and only) record.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(payload, new Uint8Array([2]))));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** Sends one push. Returns the push service's HTTP status (404/410 mean the subscription is gone). */
export async function sendPush(sub: PushSubscriptionRow, message: PushMessage, keys: VapidKeys, ttlSeconds = 6 * 3600): Promise<number> {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(message)));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, keys),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttlSeconds),
      Urgency: "high",
    },
    body,
  });
  return res.status;
}
