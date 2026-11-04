// Product packshot illustrations: one per product base type, same framing and light.
// Each item is drawn on a 600 x 600 white stage with a soft ground shadow.
// `node scripts/build-product-images.mjs` renders them to public/products/*.webp.

let defs = [];
let uid = 0;

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb) => "#" + rgb.map((n) => clamp(n).toString(16).padStart(2, "0")).join("");
export const mix = (c, t, k) => toHex(hex(c).map((v, i) => v + (hex(t)[i] - v) * k));
const lt = (c, k = 0.3) => mix(c, "#ffffff", k);
const dk = (c, k = 0.3) => mix(c, "#000000", k);

/** Horizontal gradient: light from the upper left, like a softbox. */
function h(c, spread = 0.28) {
  const id = `g${uid++}`;
  defs.push(
    `<linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${lt(c, spread)}"/><stop offset=".38" stop-color="${lt(c, spread * 0.35)}"/><stop offset="1" stop-color="${dk(c, spread * 0.8)}"/></linearGradient>`,
  );
  return `url(#${id})`;
}
/** Vertical gradient, top light. */
function v(c, spread = 0.25) {
  const id = `g${uid++}`;
  defs.push(
    `<linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${lt(c, spread)}"/><stop offset="1" stop-color="${dk(c, spread * 0.7)}"/></linearGradient>`,
  );
  return `url(#${id})`;
}
/** Radial gradient for spheres. */
function r(c) {
  const id = `g${uid++}`;
  defs.push(
    `<radialGradient id="${id}" cx=".36" cy=".32" r=".75"><stop offset="0" stop-color="${lt(c, 0.55)}"/><stop offset=".45" stop-color="${c}"/><stop offset="1" stop-color="${dk(c, 0.35)}"/></radialGradient>`,
  );
  return `url(#${id})`;
}

const rect = (x, y, w, hh, fill, rx = 0, extra = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="${rx}" fill="${fill}" ${extra}/>`;
const ell = (cx, cy, rx, ry, fill, extra = "") => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
const circ = (cx, cy, rr, fill, extra = "") => `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="${fill}" ${extra}/>`;
const path = (d, fill, extra = "") => `<path d="${d}" fill="${fill}" ${extra}/>`;
const line = (d, stroke, w, extra = "") =>
  `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const g = (t, body) => `<g transform="${t}">${body}</g>`;
const gloss = (x, y, w, hh, rx = 0) => rect(x, y, w, hh, "#ffffff", rx, 'opacity=".28"');

/** Upright cylinder seen slightly from above. */
function cyl(cx, top, w, hh, c, capC) {
  const rx = w / 2;
  const ry = w * 0.12;
  return (
    path(`M${cx - rx} ${top} V${top + hh} A${rx} ${ry} 0 0 0 ${cx + rx} ${top + hh} V${top} Z`, h(c)) +
    ell(cx, top, rx, ry, capC ?? lt(c, 0.25))
  );
}
/** Box seen from the front and a little above. */
function box(x, y, w, hh, d, c) {
  return (
    path(`M${x} ${y} L${x + d} ${y - d * 0.6} H${x + w + d} L${x + w} ${y} Z`, lt(c, 0.3)) +
    path(`M${x + w} ${y} L${x + w + d} ${y - d * 0.6} V${y + hh - d * 0.6} L${x + w} ${y + hh} Z`, dk(c, 0.22)) +
    rect(x, y, w, hh, v(c, 0.12))
  );
}

const ITEMS = {
  // Household
  "Storage box": () =>
    box(165, 250, 250, 200, 40, "#b8c4cf") +
    rect(155, 228, 270, 30, v("#7f8c99"), 6) +
    path("M155 228 L195 204 H465 L425 228 Z", "#9aa6b2") +
    rect(245, 300, 90, 16, "#8d99a5", 8),
  "Laundry basket": () =>
    path("M150 230 H450 L420 470 H180 Z", h("#7da7d9")) +
    ell(300, 230, 150, 26, "#5c86b8") +
    ell(300, 230, 136, 20, "#3f5f86") +
    [290, 330, 370, 410].map((y) => rect(195 + (y - 290) * 0.08, y, 210 - (y - 290) * 0.16, 14, "#5f8bbf", 7)).join("") +
    rect(270, 252, 60, 16, "#3f5f86", 8),
  "Clothes hangers": () =>
    [0, 1, 2]
      .map((i) =>
        g(
          `translate(${i * 22 - 22} ${i * 34 - 34})`,
          line("M300 240 C300 215 330 215 330 195 C330 178 312 172 302 182", "#9aa3ad", 8) +
            path("M300 240 L150 330 Q140 340 156 342 H444 Q460 340 450 330 Z", h(["#c08a56", "#b07a47", "#cf9b66"][i])) +
            rect(160, 336, 280, 10, dk("#b07a47", 0.15), 5),
        ),
      )
      .join(""),
  "Sponge set": () =>
    [0, 1, 2]
      .map((i) => {
        const y = 400 - i * 70;
        const c = ["#f2c14e", "#f29e4c", "#7cc47f"][i];
        return rect(185, y, 230, 52, v(c, 0.2), 10) + rect(185, y - 18, 230, 22, v("#2f7d4f", 0.2), 8);
      })
      .join(""),
  "Trash bags": () =>
    path("M190 240 H410 V420 H190 Z", h("#3b4048", 0.35)) +
    ell(410, 330, 34, 90, "#2a2e34") +
    ell(410, 330, 14, 36, "#e5e7eb") +
    ell(190, 330, 34, 90, h("#4b525c")) +
    path("M222 410 Q260 470 330 462 Q380 456 420 470 V490 Q360 476 320 484 Q250 492 210 420 Z", "#2f343b"),
  "Microfiber cloths": () =>
    ["#4f86c6", "#e57f9a", "#5fb98b", "#f0b75a"]
      .map((c, i) => rect(170 + i * 4, 420 - i * 46, 260, 50, v(c, 0.22), 14) + rect(178 + i * 4, 428 - i * 46, 60, 34, lt(c, 0.12), 10))
      .join(""),
  "Shoe rack": () =>
    rect(170, 190, 14, 290, h("#6b7280"), 5) +
    rect(416, 190, 14, 290, h("#6b7280"), 5) +
    [270, 380].map((y) => [0, 1, 2, 3].map((k) => rect(180, y + k * 12 - 18, 240, 6, "#9ca3af", 3)).join("")).join("") +
    path("M200 252 Q205 222 240 222 L290 232 Q312 238 310 252 Z", h("#c0392b")) +
    path("M318 362 Q323 332 358 332 L398 342 Q414 348 412 362 Z", h("#2f6fb0")),
  "Vacuum bags": () =>
    path("M180 200 H420 L428 450 H172 Z", h("#efe9df", 0.18)) +
    rect(180, 200, 240, 18, "#ddd5c8") +
    rect(210, 230, 180, 120, "#d9cfc0", 14) +
    circ(300, 290, 44, "#f6f2ec") +
    circ(300, 290, 26, "#8f8578") +
    [380, 400, 420].map((y) => rect(200, y, 200, 4, "#e2dacd", 2)).join(""),
  "Drying rack": () =>
    line("M180 470 L300 200 L420 470", "#a8b0b9", 10) +
    line("M210 470 L300 230 M390 470 L300 230", "#c3c9d0", 6) +
    [250, 300, 350, 400].map((y) => line(`M${180 + (470 - y) * 0} ${y} H${420}`, "#c3c9d0", 6)).join("") +
    path("M250 300 H350 V380 Q300 392 250 380 Z", v("#7aa6d6", 0.2)) +
    path("M220 350 H280 V420 Q250 428 220 420 Z", v("#e9a3b0", 0.2)),
  "Bath mat": () =>
    path("M170 300 Q300 270 430 300 L460 450 Q300 482 140 450 Z", v("#7fb7b2", 0.25)) +
    [0, 1, 2, 3, 4, 5, 6].map((k) => line(`M${180 + k * 40} 300 L${165 + k * 45} 455`, lt("#7fb7b2", 0.25), 6, 'opacity=".6"')).join(""),

  // Kitchen
  "Food container": () =>
    rect(170, 280, 260, 170, v("#dbeaf3", 0.1), 22, 'opacity=".95"') +
    rect(185, 300, 230, 130, "#ffffff", 16, 'opacity=".4"') +
    rect(160, 250, 280, 40, v("#3f7fc0", 0.25), 14) +
    rect(250, 238, 100, 18, "#336aa3", 8) +
    rect(205, 360, 190, 70, "#f0a65a", 12, 'opacity=".75"'),
  "Ceramic mug": () =>
    path("M402 280 C470 280 470 400 402 400", "none", 'stroke="#dcd6cc" stroke-width="26" stroke-linecap="round"') +
    cyl(300, 230, 210, 220, "#ece7df", "#d8d1c5") +
    ell(300, 230, 92, 20, "#8a6a4f") +
    gloss(222, 250, 18, 170, 9),
  "Chef knife": () =>
    g(
      "rotate(-28 300 330)",
      path("M120 330 L370 312 V352 L150 352 Q118 350 120 330 Z", h("#d6dbe1", 0.35)) +
        path("M120 330 L370 312 V322 L140 336 Z", "#f4f6f8") +
        rect(370, 306, 16, 52, "#9aa3ad", 3) +
        rect(384, 310, 130, 44, v("#26292e", 0.25), 14) +
        [410, 450, 490].map((x) => circ(x, 332, 5, "#b8bec6")).join(""),
    ),
  "Cutting board": () =>
    g(
      "rotate(-6 300 330)",
      rect(160, 200, 280, 280, v("#c99a68", 0.22), 26) +
        rect(170, 210, 260, 260, "none", 20, 'stroke="#b78756" stroke-width="3"') +
        circ(300, 242, 18, "#ffffff") +
        [290, 340, 400].map((y) => line(`M195 ${y} Q300 ${y - 10} 405 ${y + 4}`, "#b98a58", 3, 'opacity=".55"')).join(""),
    ),
  "Glass jar": () =>
    rect(220, 160, 160, 48, h("#9aa3ad", 0.35), 10) +
    path("M222 212 H378 Q412 230 412 280 V430 Q412 470 372 470 H228 Q188 470 188 430 V280 Q188 230 222 212 Z", h("#dbe9ee", 0.12), 'opacity=".95"') +
    path("M200 310 H400 V430 Q400 458 372 458 H228 Q200 458 200 430 Z", v("#e0874e", 0.18)) +
    gloss(210, 240, 16, 190, 8),
  "Frying pan": () =>
    rect(395, 315, 160, 30, v("#2b2e33", 0.3), 15, 'transform="rotate(-12 395 330)"') +
    ell(270, 340, 170, 95, h("#3a3e45", 0.3)) +
    ell(270, 330, 150, 78, "#24272c") +
    ell(250, 320, 90, 40, "#2f3339"),
  "Baking tray": () =>
    path("M140 320 L230 230 H470 L400 420 H160 Z", "#aeb6bf") +
    path("M170 330 L245 255 H440 L385 400 H180 Z", h("#c9d0d7", 0.25)) +
    path("M160 420 H400 V440 H160 Z", "#8f98a2") +
    path("M400 420 L470 230 V250 L400 440 Z", "#7e8791"),
  "Tea towel": () =>
    rect(250, 170, 100, 16, h("#a8b0b9"), 8) +
    path("M200 186 H400 V460 Q300 476 200 460 Z", v("#f7f4ee", 0.08)) +
    [0, 1, 2, 3, 4].map((k) => rect(200, 220 + k * 50, 200, 12, "#d9534f", 0, 'opacity=".85"')).join("") +
    [0, 1, 2, 3].map((k) => rect(225 + k * 50, 186, 10, 274, "#d9534f", 0, 'opacity=".45"')).join(""),
  "Water bottle": () =>
    rect(262, 140, 76, 40, v("#33373d", 0.3), 12) +
    rect(270, 176, 60, 24, "#c9ced4") +
    path("M270 200 Q220 215 220 260 V450 Q220 476 248 476 H352 Q380 476 380 450 V260 Q380 215 330 200 Z", h("#3d8fb8", 0.3)) +
    gloss(238, 260, 14, 180, 7),
  "Spice rack": () =>
    rect(150, 420, 300, 22, v("#b5835a", 0.2), 4) +
    rect(150, 260, 14, 182, "#a7764c", 4) +
    rect(436, 260, 14, 182, "#a7764c", 4) +
    [
      ["#b5452d", 190],
      ["#6d8a3f", 270],
      ["#d39b2a", 350],
    ]
      .map(([c, x]) => rect(x + 4, 300, 52, 22, h("#2b2e33", 0.3), 6) + rect(x, 320, 60, 100, h("#e9eef1", 0.12), 8) + rect(x + 4, 350, 52, 66, c, 6))
      .join(""),

  // Cosmetics
  Shampoo: () =>
    rect(265, 150, 70, 50, v("#f2f2f2", 0.12), 10) +
    path("M240 200 H360 Q385 210 385 240 V450 Q385 474 360 474 H240 Q215 474 215 450 V240 Q215 210 240 200 Z", h("#4e9a8e", 0.3)) +
    rect(240, 300, 120, 110, "#ffffff", 10, 'opacity=".85"') +
    rect(260, 330, 80, 10, "#4e9a8e", 5, 'opacity=".5"') +
    rect(260, 352, 56, 10, "#4e9a8e", 5, 'opacity=".35"'),
  "Shower gel": () =>
    path("M230 170 Q300 150 370 170 L392 410 Q392 440 360 444 H240 Q208 440 208 410 Z", h("#5aa7dd", 0.3)) +
    rect(240, 440, 120, 34, v("#e9edf1", 0.15), 10) +
    ell(300, 300, 62, 72, "#ffffff", 'opacity=".75"') +
    gloss(232, 200, 14, 190, 7),
  "Hand soap": () =>
    rect(286, 150, 28, 60, h("#e8e8e8"), 4) +
    rect(286, 150, 110, 22, v("#e8e8e8", 0.12), 8) +
    rect(262, 200, 76, 40, h("#f1f1f1", 0.12), 8) +
    path("M240 240 H360 Q392 250 392 290 V440 Q392 474 358 474 H242 Q208 474 208 440 V290 Q208 250 240 240 Z", h("#e7a6b4", 0.25), 'opacity=".95"') +
    rect(240, 320, 120, 80, "#ffffff", 10, 'opacity=".8"'),
  Toothpaste: () =>
    g(
      "rotate(-14 300 320)",
      path("M150 280 H420 L470 300 V340 L420 360 H150 Q138 320 150 280 Z", v("#f4f6f8", 0.12)) +
        rect(140, 280, 20, 80, "#d7dce1", 4) +
        rect(470, 300, 50, 40, v("#2f6fb0", 0.25), 8) +
        rect(200, 300, 150, 40, "#2f6fb0", 8, 'opacity=".9"') +
        rect(360, 300, 46, 40, "#e04848", 8),
    ),
  "Hand cream": () =>
    rect(255, 410, 90, 60, v("#3f6d5a", 0.25), 12) +
    path("M228 170 H372 L352 410 H248 Z", h("#eae5da", 0.15)) +
    rect(228, 166, 144, 14, "#d6cfc1", 4) +
    rect(262, 260, 76, 70, "#4f8a72", 8, 'opacity=".85"'),
  Deodorant: () =>
    path("M250 200 Q250 150 300 150 Q350 150 350 200 Z", v("#d9dde2", 0.25)) +
    rect(248, 196, 104, 14, "#aeb4bb", 3) +
    cyl(300, 210, 104, 260, "#2f4a6d", "#3b5a82") +
    rect(254, 280, 92, 80, "#ffffff", 6, 'opacity=".2"') +
    gloss(262, 230, 12, 210, 6),
  "Cotton pads": () =>
    path("M190 230 Q300 200 410 230 L420 450 Q300 478 180 450 Z", "#eef3f7", 'opacity=".9"') +
    [0, 1, 2, 3, 4, 5, 6].map((k) => ell(300, 430 - k * 26, 105, 28, k % 2 ? "#f7f7f5" : "#ecebe6")).join("") +
    ell(300, 270, 105, 28, "#ffffff") +
    rect(190, 230, 220, 14, "#8fb7d6", 6, 'opacity=".8"'),
  "Face wipes": () =>
    rect(160, 260, 280, 190, v("#9ed0cf", 0.22), 40) +
    rect(220, 290, 160, 70, v("#ffffff", 0.08), 22) +
    path("M260 300 Q300 330 340 300 V350 H260 Z", "#f2f2f0") +
    rect(180, 390, 240, 40, "#ffffff", 14, 'opacity=".35"'),
  "Hair conditioner": () =>
    path("M300 140 Q340 140 340 170 V200 H260 V170 Q260 140 300 140 Z", v("#3b3f46", 0.25)) +
    path("M255 200 H345 Q410 230 410 320 V440 Q410 474 376 474 H224 Q190 474 190 440 V320 Q190 230 255 200 Z", h("#b78bc9", 0.3)) +
    rect(228, 320, 144, 100, "#ffffff", 12, 'opacity=".8"'),
  "Lip balm": () =>
    g(
      "rotate(-10 300 330)",
      rect(250, 200, 60, 160, h("#e66b7f", 0.3), 10) +
        rect(250, 340, 60, 120, h("#f3f3f3", 0.18), 10) +
        path("M335 250 Q335 220 365 222 L382 232 V300 H335 Z", h("#e05a71", 0.25)) +
        rect(333, 300, 50, 160, h("#f3f3f3", 0.18), 10),
    ),

  // Toys
  "Toy car": () =>
    path("M140 380 Q140 330 190 322 L240 270 Q256 254 290 254 H360 Q392 254 410 280 L440 322 Q470 330 470 380 V400 H140 Z", h("#d9363e", 0.3)) +
    path("M252 280 Q262 270 290 270 H315 V320 H218 Z", "#bfe0f0") +
    path("M330 270 H360 Q380 270 392 290 L410 320 H330 Z", "#bfe0f0") +
    [205, 400].map((x) => circ(x, 400, 40, "#2b2e33") + circ(x, 400, 18, "#c9ced4")).join("") +
    rect(440, 350, 26, 14, "#f6d36b", 5),
  Puzzle: () => {
    const piece = (x, y, c, t = "") =>
      g(
        t,
        path(
          `M${x} ${y} h45 a22 22 0 1 1 30 0 h45 v45 a22 22 0 1 1 0 30 v45 h-45 a22 22 0 1 0 -30 0 h-45 v-45 a22 22 0 1 0 0 -30 Z`,
          v(c, 0.2),
        ),
      );
    return piece(180, 220, "#4f86c6") + piece(300, 220, "#e57f50") + piece(180, 340, "#5fb98b") + piece(330, 360, "#f0b75a", "rotate(12 390 420)");
  },
  "Soft ball": () =>
    circ(300, 320, 140, r("#5c9ee0")) +
    line("M190 240 Q300 330 410 240", "#ffffff", 8, 'opacity=".8"') +
    line("M190 400 Q300 310 410 400", "#ffffff", 8, 'opacity=".8"'),
  "Building blocks": () => {
    const brick = (x, y, w, c) =>
      [0, 1, 2, 3].slice(0, w / 50).map((k) => rect(x + 12 + k * 50, y - 16, 26, 18, v(c, 0.2), 4)).join("") + rect(x, y, w, 70, v(c, 0.2), 8);
    return brick(160, 400, 200, "#d9363e") + brick(360, 400, 100, "#2f6fb0") + brick(210, 316, 150, "#f0b75a") + brick(260, 232, 100, "#5fb98b");
  },
  Doll: () =>
    path("M300 270 L200 470 H400 Z", h("#e57f9a", 0.25)) +
    rect(270, 260, 60, 40, "#e57f9a", 10) +
    circ(300, 210, 62, "#f3d2b8") +
    path("M238 210 Q238 140 300 140 Q362 140 362 210 Q350 170 300 168 Q250 170 238 210 Z", "#8a5a3b") +
    path("M238 205 Q226 270 246 300 L258 220 Z M362 205 Q374 270 354 300 L342 220 Z", "#8a5a3b") +
    circ(280, 212, 6, "#3b2a20") +
    circ(320, 212, 6, "#3b2a20") +
    line("M286 236 Q300 246 314 236", "#c96a6a", 4),
  "Coloring set": () =>
    ["#d9363e", "#f08a3c", "#f0c43c", "#5fb98b", "#2f6fb0", "#8a5ab8"]
      .map((c, i) =>
        g(
          `rotate(${(i - 2.5) * 9} 300 520)`,
          rect(282, 200, 36, 230, h(c, 0.3), 4) + path("M282 200 L300 160 L318 200 Z", dk(c, 0.1)) + rect(282, 230, 36, 10, "#ffffff", 0, 'opacity=".35"'),
        ),
      )
      .join(""),
  "Bubble wand": () =>
    rect(200, 260, 110, 210, h("#7fc6e0", 0.25), 20) +
    rect(214, 228, 82, 40, v("#e57f9a", 0.25), 10) +
    line("M360 470 L380 240", "#e57f9a", 10) +
    circ(384, 200, 42, "none", 'stroke="#e57f9a" stroke-width="12"') +
    circ(440, 150, 26, "#dff1f8", 'stroke="#b6dcea" stroke-width="3" opacity=".9"') +
    circ(470, 220, 14, "#dff1f8", 'stroke="#b6dcea" stroke-width="3" opacity=".9"'),
  "Toy kitchen set": () =>
    rect(180, 230, 240, 240, v("#f3efe8", 0.1), 14) +
    rect(180, 230, 240, 50, v("#7fb7b2", 0.2), 14) +
    [250, 350].map((x) => ell(x, 255, 34, 12, "#4a5560")).join("") +
    rect(205, 300, 190, 140, "#e6e1d8", 10) +
    rect(225, 320, 150, 86, "#3a3e45", 8, 'opacity=".75"') +
    rect(250, 300, 100, 10, "#b8bec6", 5) +
    [230, 280, 330].map((x) => circ(x + 15, 425, 7, "#7fb7b2")).join(""),
  "Water gun": () =>
    path("M150 290 Q150 250 190 250 H420 Q450 250 450 280 V310 H150 Z", h("#3fa66b", 0.3)) +
    rect(440, 268, 60, 24, v("#f08a3c", 0.25), 8) +
    path("M240 310 H310 L290 460 Q286 474 270 472 L232 466 Q220 462 222 448 Z", h("#f08a3c", 0.3)) +
    path("M310 310 Q330 360 300 380", "none", 'stroke="#2f7d4f" stroke-width="10" stroke-linecap="round"') +
    rect(250, 190, 120, 70, h("#5fb6e0", 0.25), 20),
  "Board game": () =>
    box(150, 240, 300, 150, 50, "#2f6fb0") +
    rect(150, 240, 300, 40, "#ffffff", 0, 'opacity=".2"') +
    rect(210, 290, 180, 70, "#f0b75a", 10, 'opacity=".9"') +
    g("rotate(12 400 430)", rect(370, 400, 60, 60, v("#f4f4f5", 0.1), 12, 'stroke="#d4d4d8" stroke-width="2"') + circ(386, 416, 6, "#2b2e33") + circ(414, 444, 6, "#2b2e33") + circ(400, 430, 6, "#2b2e33")),

  // Stationery
  Notebook: () =>
    rect(195, 170, 230, 300, "#d6dde3", 10) +
    rect(185, 160, 230, 300, v("#2f6fb0", 0.2), 10) +
    [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => rect(175, 182 + k * 31, 26, 10, "#9aa3ad", 5)).join("") +
    rect(250, 220, 120, 50, "#ffffff", 6, 'opacity=".9"'),
  "Gel pen": () =>
    g(
      "rotate(-35 300 320)",
      rect(130, 302, 270, 36, h("#e9edf1", 0.15), 18) +
        rect(320, 300, 160, 40, v("#2f6fb0", 0.3), 18) +
        rect(440, 288, 50, 14, "#2f6fb0", 5) +
        path("M130 302 L90 320 L130 338 Z", "#c9ced4") +
        rect(160, 310, 140, 20, "#2f6fb0", 10, 'opacity=".25"'),
    ),
  "Pencil set": () =>
    ["#d9363e", "#2f6fb0", "#5fb98b", "#f0b75a"]
      .map((c, i) =>
        g(
          `translate(${(i - 1.5) * 52} ${Math.abs(i - 1.5) * 10}) rotate(${(i - 1.5) * 4} 300 330)`,
          rect(282, 220, 36, 240, h(c, 0.3), 3) + path("M282 220 L300 160 L318 220 Z", "#ecc89a") + path("M293 182 L300 160 L307 182 Z", "#2b2e33") + rect(282, 440, 36, 20, "#c9ced4"),
        ),
      )
      .join(""),
  "Sticky notes": () =>
    [0, 1, 2, 3, 4].map((k) => rect(180, 220 + k * 6, 240, 240, k % 2 ? "#efd96a" : "#f4e27c", 4)).join("") +
    path("M180 200 H420 V380 L340 440 H180 Z", v("#f6e690", 0.12)) +
    path("M340 440 L420 380 Q380 400 350 400 Z", "#d8c35a"),
  "Glue stick": () =>
    rect(255, 170, 90, 90, v("#f0b75a", 0.25), 10) +
    cyl(300, 250, 90, 220, "#f4f4f2", "#e3e3df") +
    rect(255, 300, 90, 110, "#2f6fb0", 4) +
    rect(255, 456, 90, 16, "#f0b75a", 4),
  Ruler: () =>
    g(
      "rotate(-30 300 330)",
      rect(100, 290, 400, 76, v("#dbe9ee", 0.1), 6, 'opacity=".95"') +
        Array.from({ length: 37 }, (_, k) => rect(112 + k * 10, 290, 3, k % 5 ? 16 : 30, "#5f6b77")).join(""),
    ),
  "Marker set": () =>
    ["#d9363e", "#f08a3c", "#5fb98b", "#2f6fb0", "#8a5ab8"]
      .map((c, i) => {
        const x = 175 + i * 52;
        return rect(x, 260, 44, 210, h("#f4f4f2", 0.15), 8) + rect(x, 180, 44, 90, h(c, 0.3), 10) + rect(x, 330, 44, 40, c, 0, 'opacity=".85"');
      })
      .join(""),
  Eraser: () =>
    g("rotate(-10 300 330)", box(200, 270, 200, 110, 40, "#f2a5b6") + rect(280, 270, 120, 110, v("#2f6fb0", 0.22)) + path("M280 270 L320 246 H440 L400 270 Z", "#5389c2") + path("M400 270 L440 246 V356 L400 380 Z", "#244f80")),
  "File folder": () =>
    path("M160 210 H270 L292 236 H440 Q450 236 450 246 V460 H160 Z", v("#d9a24f", 0.15)) +
    rect(180, 250, 250, 180, "#ffffff", 4) +
    path("M150 280 H450 L440 470 H160 Z", v("#e8b766", 0.2)),
  Sketchbook: () =>
    rect(186, 166, 240, 310, "#ece7df", 10) +
    rect(176, 156, 240, 310, v("#3a3e45", 0.3), 12) +
    rect(352, 150, 16, 322, "#d9363e", 6) +
    rect(176, 156, 20, 310, "#2b2e33", 6),

  // Seasonal
  "Christmas lights": () => {
    const pts = Array.from({ length: 11 }, (_, k) => [140 + k * 32, 320 + Math.sin(k * 0.9) * 70]);
    const cols = ["#d9363e", "#f0b75a", "#5fb98b", "#2f6fb0"];
    return (
      line("M" + pts.map((p) => p.join(" ")).join(" L"), "#2f5d3e", 6) +
      pts
        .map(([x, y], k) => rect(x - 8, y, 16, 16, "#2f5d3e", 3) + ell(x, y + 34, 15, 22, r(cols[k % 4])) + ell(x, y + 34, 26, 32, cols[k % 4], 'opacity=".14"'))
        .join("")
    );
  },
  "Christmas bauble": () =>
    circ(300, 170, 20, "none", 'stroke="#b8a46a" stroke-width="6"') +
    rect(272, 182, 56, 34, h("#c9b06a", 0.3), 6) +
    circ(300, 340, 130, r("#c0392b")) +
    line("M176 320 Q300 360 424 320", "#e9cf86", 10, 'opacity=".9"') +
    ell(256, 286, 26, 40, "#ffffff", 'opacity=".35" transform="rotate(30 256 286)"'),
  "Tinsel garland": () =>
    Array.from({ length: 260 }, (_, k) => {
      const t = k / 260;
      const x = 130 + t * 340;
      const y = 330 + Math.sin(t * Math.PI * 2.2) * 80;
      const a = (k * 47) % 360;
      return line(`M${x} ${y} l${Math.cos(a) * 28} ${Math.sin(a) * 28}`, ["#c9b06a", "#e2cf8e", "#a8904d"][k % 3], 3.5);
    }).join(""),
  "Gift bag": () =>
    line("M245 230 Q245 160 280 160 Q300 160 300 230", "#8a6a4f", 7) +
    line("M300 230 Q300 160 330 160 Q355 160 355 230", "#8a6a4f", 7) +
    path("M240 200 L270 230 L250 250 Z M360 200 L330 230 L350 250 Z", "#f4f4f2") +
    path("M190 230 H410 L428 470 H172 Z", h("#c0392b", 0.28)) +
    rect(190, 230, 220, 24, "#a8322a"),
  Candle: () =>
    ell(300, 172, 16, 34, "#f6b84a", 'opacity=".9"') +
    ell(300, 182, 8, 18, "#fff1c4") +
    rect(298, 196, 4, 24, "#3b2a20") +
    cyl(300, 220, 160, 250, "#f3ece1", "#e8dfcf"),
  "Snowflake decor": () =>
    [0, 60, 120]
      .map((a) =>
        g(
          `rotate(${a} 300 320)`,
          line("M300 160 V480", "#8fb7d6", 16) +
            line("M300 220 L264 190 M300 220 L336 190 M300 420 L264 450 M300 420 L336 450 M300 270 L276 250 M300 270 L324 250 M300 370 L276 390 M300 370 L324 390", "#8fb7d6", 12),
        ),
      )
      .join("") +
    circ(300, 320, 22, "#c3dcec"),
  "Advent calendar": () =>
    box(165, 190, 270, 270, 30, "#b23a33") +
    Array.from({ length: 16 }, (_, k) => rect(185 + (k % 4) * 62, 210 + Math.floor(k / 4) * 62, 50, 50, k % 3 ? "#c8574f" : "#d9a24f", 6)).join(""),
  "Wrapping paper": () =>
    g(
      "rotate(-12 300 320)",
      path("M150 330 H460 L470 470 H160 Z", v("#2f7d4f", 0.15)) +
        Array.from({ length: 12 }, (_, k) => circ(180 + (k % 6) * 50, 370 + Math.floor(k / 6) * 50, 8, "#e9cf86")).join("") +
        rect(150, 240, 310, 90, v("#2f7d4f", 0.35)) +
        Array.from({ length: 6 }, (_, k) => circ(180 + k * 50, 285, 8, "#e9cf86")).join("") +
        ell(460, 285, 22, 45, "#24603c") +
        ell(460, 285, 10, 22, "#d6c39a") +
        ell(150, 285, 22, 45, "#3a8f5e"),
    ),
  "Santa figure": () =>
    path("M300 150 L190 470 H410 Z", h("#c0392b", 0.3)) +
    ell(300, 470, 112, 16, "#a8322a") +
    circ(300, 150, 16, "#f4f4f2") +
    rect(232, 252, 136, 26, "#f4f4f2", 13) +
    circ(300, 300, 34, "#f3d2b8") +
    path("M262 310 Q300 420 338 310 Q320 338 300 336 Q280 338 262 310 Z", "#f7f7f5") +
    circ(288, 296, 4, "#3b2a20") +
    circ(312, 296, 4, "#3b2a20") +
    rect(196, 430, 208, 20, "#2b2e33", 4),
  "Star topper": () =>
    rect(290, 380, 20, 100, h("#b8a46a", 0.3), 8) +
    path(
      "M300 150 L336 248 L440 252 L358 316 L388 416 L300 358 L212 416 L242 316 L160 252 L264 248 Z",
      r("#d4b45a"),
      'stroke="#b8963c" stroke-width="4" stroke-linejoin="round"',
    ),
};

export const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const NAMES = Object.keys(ITEMS);

export function svgFor(name) {
  defs = [];
  uid = 0;
  const body = ITEMS[name]();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><defs><filter id="s" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="10"/></filter>${defs.join("")}</defs><rect width="600" height="600" fill="#ffffff"/><ellipse cx="300" cy="490" rx="170" ry="16" fill="#18181b" opacity=".12" filter="url(#s)"/>${body}</svg>`;
}
