import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";

// Origins the app really uses: the map style and tiles (openfreemap), fonts self-hosted by next/font,
// /api through the rewrite above. A manager's own AI provider is any https host, hence https: in connect-src.
// Next.js inlines scripts and styles, so the full policy runs as Report-Only first; it needs a look at the
// violation reports before it can be enforced. Framing is blocked for real (enforced header below).
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tiles.openfreemap.org",
  "font-src 'self' data: https://tiles.openfreemap.org",
  "connect-src 'self' https://tiles.openfreemap.org https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

// STATIC_EXPORT=1 builds plain files for the Cloudflare Worker, which answers /api itself.
const nextConfig: NextConfig = process.env.STATIC_EXPORT
  ? { output: "export", devIndicators: false }
  : {
      devIndicators: false,
      async headers() {
        return [{ source: "/:path*", headers: SECURITY_HEADERS }];
      },
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
      },
    };

export default nextConfig;
