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
  const tag = page.getByRole("region", { name: "Stock health" });
  await expect(tag).toContainText(new RegExp(`${need.length}\\s*need attention`));
  await expect(tag).toContainText(`${rows.length} products`);
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

test("stock health tiles filter the list", async ({ page }) => {
  await openProducts(page);
  const tiles = page.getByRole("group", { name: "Filter by status" });
  const late = rows.filter((r) => r.status === "late").length;
  const tile = tiles.getByRole("button", { name: /Late delivery/ });
  await expect(tile).toContainText(String(late));
  await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await expect(section(page, /^Late delivery/).getByRole("listitem")).toHaveCount(late);
  await expect(section(page, /^Updates/)).toHaveCount(0);
  await page.getByRole("button", { name: "Show all", exact: true }).click();
  await expect(section(page, /Needs attention/)).toBeVisible();
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
  await panel.getByRole("button", { name: "Review suggestion" }).first().click();
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

interface Purchase {
  id: string;
  ordered: string;
  received: string | null;
  qty: number;
  status: string;
  days_late: number;
}
interface Detail {
  purchases: Purchase[];
  purchase_summary: { orders: number; units: number; on_time_pct: number | null };
}
const detail = async (id: string): Promise<Detail> => (await fetch(`${API}/api/products/${id}`)).json();

async function openProduct(page: Page, row: Row) {
  await openProducts(page);
  await page.getByRole("searchbox", { name: "Search products" }).fill(row.product_id);
  await page.getByRole("button", { name: new RegExp(row.name) }).click();
  const history = productPanel(page).getByRole("list", { name: "Purchase history" });
  await expect(history).toBeVisible();
  return history;
}

test("purchase history matches the API and expands to every order", async ({ page }, info) => {
  const errors = watchConsole(page);
  // a product with more orders than the preview shows
  let row: Row | undefined;
  let d: Detail | undefined;
  for (const r of rows) {
    d = await detail(r.product_id);
    if (d.purchases.length > 5) {
      row = r;
      break;
    }
  }
  expect(row).toBeDefined();
  const history = await openProduct(page, row!);
  const s = d!.purchase_summary;
  const items = history.getByRole("listitem");
  await expect(items.first()).toContainText(`${s.orders} orders, ${s.units.toLocaleString("en-GB")} units`);
  if (s.on_time_pct !== null) await expect(items.first()).toContainText(`${s.on_time_pct}% on time`);
  await expect(items).toHaveCount(1 + 5);
  await expect(items.nth(1)).toContainText(`${d!.purchases[0].qty} units`);
  const head = section(page, /Purchase history/);
  await head.getByRole("button", { name: `Show all ${s.orders}` }).click();
  await expect(items).toHaveCount(1 + s.orders);
  await expect(items.last()).toContainText(`${d!.purchases.at(-1)!.qty} units`);
  if (SHOTS) {
    await items.first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/product-purchases-${info.project.name}.png` });
  }
  await head.getByRole("button", { name: "Show less" }).click();
  await expect(items).toHaveCount(1 + 5);
  const axe = await new AxeBuilder({ page }).include(`aside ul[aria-label="Purchase history"]`).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  expect(errors).toEqual([]);
});

test("a late order shows how late it is", async ({ page }, info) => {
  const row = rows.find((r) => r.status === "late")!;
  const d = await detail(row.product_id);
  const late = d.purchases.find((p) => p.status === "late" && p.received === null)!;
  expect(late).toBeDefined();
  const history = await openProduct(page, row);
  const n = late.days_late;
  await expect(history.getByText(`Late by ${n} ${n === 1 ? "day" : "days"}`, { exact: true })).toBeVisible();
  const received = d.purchases.slice(0, 5).filter((p) => p.status === "received").length;
  await expect(history.getByText("Received", { exact: true })).toHaveCount(received);
  if (SHOTS) {
    await history.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/product-purchases-late-${info.project.name}.png` });
  }
});
