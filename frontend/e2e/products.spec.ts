import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const API = process.env.BASE_URL ?? "http://127.0.0.1:8000";
const SHOTS = process.env.SHOTS; // directory for review screenshots, optional

interface Row {
  product_id: string;
  name: string;
  category: string;
  status: string;
  attention: boolean;
  stock: number;
  actions: { id: string }[];
}

let rows: Row[] = [];

test.beforeAll(async () => {
  rows = (await (await fetch(`${API}/api/products`)).json()).products;
});

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

const productPanel = (page: Page) => page.getByRole("complementary", { name: /^Product / });
const section = (page: Page, title: RegExp) => page.locator("section", { has: page.getByRole("heading", { name: title }) });

async function openProducts(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Products/ }).filter({ visible: true }).first().click();
  await expect(page.getByRole("heading", { name: "Products", level: 1 })).toBeVisible();
  await expect(section(page, /Needs attention/).getByRole("listitem").first()).toBeVisible();
}

test("lists every product, problems first, with status chips", async ({ page }, info) => {
  const errors = watchConsole(page);
  await openProducts(page);
  const need = rows.filter((r) => r.attention);
  await expect(page.getByText(`${rows.length} products · ${need.length} need attention`)).toBeVisible();
  const attention = section(page, /Needs attention/);
  await expect(attention.getByRole("listitem")).toHaveCount(need.length);
  await expect(section(page, /Everything else/).getByRole("listitem")).toHaveCount(rows.length - need.length);
  const first = attention.getByRole("listitem").first();
  await expect(first).toContainText(rows[0].name);
  await expect(first).toContainText("Running out");
  await expect(section(page, /^Updates/).getByRole("listitem")).toHaveCount(4);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/products-${info.project.name}.png` });

  const axe = await new AxeBuilder({ page }).include("main").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  expect(errors).toEqual([]);
});

test("search, category filter and sort", async ({ page }) => {
  await openProducts(page);
  const search = page.getByRole("searchbox", { name: "Search products" });
  await search.fill("mug");
  const mugs = rows.filter((r) => r.name.toLowerCase().includes("mug"));
  await expect(page.locator("main li button", { hasText: /mug/i })).toHaveCount(mugs.length);
  await search.fill("zzzz");
  await expect(page.getByText("No products match “zzzz”.")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();

  await page.getByRole("button", { name: "Toys", exact: true }).click();
  const toys = rows.filter((r) => r.category === "Toys").length;
  const lists = page.locator("main section", { has: page.getByRole("heading", { name: /Needs attention|Everything else|Products/ }) });
  await expect(lists.getByRole("listitem")).toHaveCount(toys);
  await expect(section(page, /^Updates/)).toHaveCount(0);

  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("tab", { name: "A–Z" }).click();
  const byName = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  await expect(section(page, /^Products/).getByRole("listitem").first()).toContainText(byName[0].name);
});

test("product detail shows facts and opens its suggestion", async ({ page }, info) => {
  const errors = watchConsole(page);
  await openProducts(page);
  const top = rows[0];
  await section(page, /Needs attention/).getByRole("button", { name: new RegExp(top.name) }).click();
  const panel = productPanel(page);
  await expect(panel.getByRole("heading", { name: top.name })).toBeVisible();
  await expect(panel.locator("dl").first()).toContainText(`${top.stock} units`);
  await expect(panel.getByRole("list", { name: "Product updates" })).toContainText("Suggested today");
  await expect(panel.getByText("Stock on hand")).toBeVisible();
  if (SHOTS) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/product-detail-${info.project.name}.png` });
  }
  await panel.getByRole("button", { name: "Review suggestion" }).click();
  await expect(productPanel(page)).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: `Details for ${top.name}` })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a product with no suggestion has no review button; Escape closes", async ({ page }) => {
  await openProducts(page);
  const calm = rows.find((r) => r.status === "ok")!;
  await page.getByRole("searchbox", { name: "Search products" }).fill(calm.product_id);
  await page.getByRole("button", { name: new RegExp(calm.name) }).click();
  const panel = productPanel(page);
  await expect(panel.getByText("OK", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Review suggestion" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("a store update opens that product", async ({ page }) => {
  await openProducts(page);
  const item = section(page, /^Updates/).getByRole("listitem").first();
  const name = (await item.locator(".font-semibold").textContent())!;
  await item.click();
  await expect(productPanel(page).getByRole("heading", { name })).toBeVisible();
});
