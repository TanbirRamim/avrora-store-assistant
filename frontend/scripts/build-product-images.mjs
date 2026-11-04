// Renders the product illustrations to public/products/<slug>.webp (600 x 600).
// Usage: node scripts/build-product-images.mjs [--sheet out.png]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { NAMES, slug, svgFor } from "./product-art.mjs";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "products");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
let total = 0;
for (const name of NAMES) {
  const svg = svgFor(name);
  const data = await page.evaluate(async (s) => {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 600;
    c.getContext("2d").drawImage(img, 0, 0);
    return c.toDataURL("image/webp", 0.86);
  }, svg);
  const buf = Buffer.from(data.split(",")[1], "base64");
  total += buf.length;
  writeFileSync(join(out, `${slug(name)}.webp`), buf);
}
console.log(`${NAMES.length} images, ${(total / 1024).toFixed(0)} KB total`);

const sheetIdx = process.argv.indexOf("--sheet");
if (sheetIdx > 0) {
  const tiles = NAMES.map(
    (n) => `<figure><img src="data:image/webp;base64,${readFileSync(join(out, `${slug(n)}.webp`)).toString("base64")}"><figcaption>${n}</figcaption></figure>`,
  ).join("");
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.setContent(
    `<style>body{margin:8px;display:grid;grid-template-columns:repeat(10,1fr);gap:6px;font:11px sans-serif;background:#f6f6f7}figure{margin:0}img{width:100%;border-radius:8px;border:1px solid #e4e4e7}</style>${tiles}`,
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path: process.argv[sheetIdx + 1], fullPage: true });
}
await browser.close();
