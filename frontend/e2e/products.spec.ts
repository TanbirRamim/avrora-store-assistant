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

const list = (page: Page) => page.getByTestId("product-list");
const filterTab = (page: Page, name: RegExp) => page.getByRole("tablist", { name: "Filter by status" }).getByRole("tab", { name });

async function openProducts(page: Page, tab?: RegExp) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Products/ }).filter({ visible: true }).first().click();
  await expect(page.getByRole("heading", { name: "Products", level: 1 })).toBeVisible();
  await expect(list(page).getByRole("listitem").first()).toBeVisible();
  if (tab) await filterTab(page, tab).click();
}

async function sortBy(page: Page, label: string, phone: boolean) {
  if (phone) await page.getByRole("combobox", { name: "Sort" }).selectOption({ label });
  else await page.getByRole("radiogroup", { name: "Sort" }).getByRole("radio", { name: label }).click();
}

test("opens on what needs attention, with thumbnails, badges and a count", async ({ page }, info) => {
  const errors = watchConsole(page);
  await openProducts(page);
  const need = rows.filter((r) => r.attention);
  const tag = page.getByRole("region", { name: "Stock health" });
  await expect(tag).toContainText(new RegExp(`${need.length}\\s*need attention`));
  await expect(tag).toContainText(`${rows.length} products`);
  await expect(filterTab(page, /Needs attention/)).toHaveAttribute("aria-selected", "true");
  await expect(filterTab(page, /^All/)).toContainText(String(rows.length));
  await expect(list(page).getByRole("listitem")).toHaveCount(need.length);
  await expect(page.getByText(`Showing ${need.length} of ${rows.length} products`)).toBeVisible();
  const first = list(page).getByRole("listitem").first();
  await expect(first).toContainText(rows[0].name);
  await expect(first).toContainText("Running out");
  await expect(first.locator("svg").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Store updates" }).filter({ visible: true }).getByRole("listitem")).toHaveCount(4);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/products-${info.project.name}.png` });

  await filterTab(page, /^All/).click();
  await expect(list(page).getByRole("listitem")).toHaveCount(rows.length);
  await expect(page.getByText(`Showing ${rows.length} of ${rows.length} products`)).toBeVisible();

  const axe = await new AxeBuilder({ page }).include("main").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  expect(errors).toEqual([]);
});

test("search, category filter and sort", async ({ page }, info) => {
  const phone = info.project.name !== "desktop";
  await openProducts(page, /^All/);
  const search = page.getByRole("searchbox", { name: "Search products" });
  await search.fill("mug");
  const mugs = rows.filter((r) => r.name.toLowerCase().includes("mug"));
  await expect(list(page).getByRole("listitem")).toHaveCount(mugs.length);
  await search.fill("zzzz");
  await expect(page.getByText("No products match “zzzz”.")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();

  await page.getByRole("combobox", { name: "Category" }).selectOption("Toys");
  const toys = rows.filter((r) => r.category === "Toys").length;
  await expect(list(page).getByRole("listitem")).toHaveCount(toys);
  await expect(filterTab(page, /^All/)).toContainText(String(toys));
  await expect(page.getByRole("region", { name: "Store updates" })).toHaveCount(0);

  await page.getByRole("combobox", { name: "Category" }).selectOption("All");
  await sortBy(page, "A–Z", phone);
  const byName = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  await expect(list(page).getByRole("listitem").first()).toContainText(byName[0].name);
});

test("status tabs filter the list", async ({ page }) => {
  await openProducts(page);
  const late = rows.filter((r) => r.status === "late").length;
  const tab = filterTab(page, /^Late/);
  await expect(tab).toContainText(String(late));
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("list", { name: "Late" }).getByRole("listitem")).toHaveCount(late);
  await expect(page.getByRole("region", { name: "Store updates" })).toHaveCount(0);
  await filterTab(page, /Needs attention/).click();
  await expect(list(page).getByRole("listitem")).toHaveCount(rows.filter((r) => r.attention).length);
});

test("product detail shows facts and opens its suggestion", async ({ page }, info) => {
  const errors = watchConsole(page);
  await openProducts(page);
  const top = rows[0];
  await list(page).getByRole("button", { name: new RegExp(top.name) }).click();
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
  await openProducts(page, /^All/);
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
  const item = page.getByRole("region", { name: "Store updates" }).filter({ visible: true }).getByRole("listitem").first();
  const name = (await item.locator(".font-medium").first().textContent())!;
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
  await openProducts(page, /^All/);
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
