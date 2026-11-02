import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const API = "http://127.0.0.1:8000";
const TOP = "Ceramic mug Black";
const SECOND = "Vacuum bags White";

async function resetDecisions() {
  const res = await fetch(`${API}/api/decisions`);
  for (const d of (await res.json()) as { action_id: string }[]) {
    await fetch(`${API}/api/decisions/${d.action_id}`, { method: "DELETE" });
  }
}

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

const todayList = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: /To decide|All done/ }) });
const handledList = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Handled" }) });
const panel = (page: Page) => page.getByRole("complementary", { name: /Details for/ });

async function openNav(page: Page, name: string) {
  const re = new RegExp(`^${name}( \\d+ to decide)?$`);
  await page.getByRole("button", { name: re }).filter({ visible: true }).first().click();
}

test.beforeEach(async ({ page }) => {
  await resetDecisions();
  await page.goto("/");
  await expect(page.getByText(TOP)).toBeVisible();
});

test("Today shows the date, summary, store note and five priorities", async ({ page }) => {
  const errors = watchConsole(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  await expect(page.getByText("Monday 2 November")).toBeVisible();
  await expect(page.getByText(/5 priorities today, about ₴[\d,]+ at stake\./)).toBeVisible();
  await expect(page.getByText(/power outage lasting 8 hours/)).toBeVisible();
  await expect(todayList(page).getByRole("listitem")).toHaveCount(5);
  await expect(page.getByRole("img", { name: "0 of 5 handled" })).toBeVisible();
  // ranked by money at stake, highest first
  const values = await todayList(page).locator("li .num").allTextContents();
  const nums = values.map((v) => Number(v.replace(/[^\d]/g, "")));
  expect(nums).toEqual([...nums].sort((a, b) => b - a));
  expect(errors).toEqual([]);
});

test("light appearance uses Apple grouped background", async ({ page }) => {
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  expect(bg).toBe("rgb(242, 242, 247)");
  const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  expect(scheme).toBe("light");
});

test("approving with the circle moves the row to Handled and undo brings it back", async ({ page }) => {
  await page.getByRole("button", { name: `Approve ${TOP}` }).click();
  await expect(handledList(page).getByText(TOP)).toBeVisible();
  await expect(handledList(page).getByText("Approved")).toBeVisible();
  await expect(todayList(page).getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("img", { name: "1 of 5 handled" })).toBeVisible();

  await page.reload(); // decision is persisted on the server
  await expect(handledList(page).getByText(TOP)).toBeVisible();

  await page.getByRole("button", { name: `Undo decision for ${TOP}` }).click();
  await expect(handledList(page)).toHaveCount(0);
  await expect(todayList(page).getByRole("listitem")).toHaveCount(5);
});

test("detail panel explains the suggestion with facts and charts", async ({ page }) => {
  await page.getByText(TOP).click();
  const p = panel(page);
  await expect(p).toBeVisible();
  await expect(p.getByRole("heading", { name: TOP })).toBeVisible();
  await expect(p.getByText("Order 120 from KitchenLine")).toBeVisible();
  for (const label of ["In stock", "Sells per day", "Lasts", "Delivery takes", "Already on order"]) {
    await expect(p.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(p.getByText("Units sold per day")).toBeVisible();
  await expect(p.getByText("Stock on hand")).toBeVisible();
  await expect(p.locator("svg rect").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(p).toHaveCount(0);
});

test("adjust approves with the changed quantity", async ({ page }) => {
  await page.getByText(TOP).click();
  const p = panel(page);
  await p.getByRole("button", { name: "Adjust" }).click();
  const input = p.getByRole("spinbutton");
  await expect(input).toHaveValue("120");
  await input.fill("96");
  await p.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(p.getByText("Approved with 96 units")).toBeVisible();
  await expect(handledList(page).getByText("Approved with change: 96")).toBeVisible();
});

test("dismiss records the reason", async ({ page }) => {
  await page.getByText(SECOND).click();
  const p = panel(page);
  await p.getByRole("button", { name: "Dismiss" }).click();
  await p.getByRole("button", { name: "Already handled" }).click();
  await expect(p.getByText("Dismissed: Already handled")).toBeVisible();
  await p.getByRole("button", { name: "Undo" }).click();
  await expect(p.getByRole("button", { name: "Dismiss" })).toBeVisible();
});

test("All suggestions filters by type", async ({ page }) => {
  await openNav(page, "All suggestions");
  await expect(page.getByRole("heading", { name: "All suggestions", level: 1 })).toBeVisible();
  const count = async () => Number((await page.getByText(/^\d+ suggestions$/).textContent())!.split(" ")[0]);
  const all = await count();
  expect(all).toBeGreaterThanOrEqual(19);
  const expected: Record<string, number> = { Reorder: 8, "Mark down": 6, "Move to front": 3, "Chase delivery": 2 };
  let sum = 0;
  for (const [tab, n] of Object.entries(expected)) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(`${n} suggestions`)).toBeVisible();
    sum += n;
  }
  expect(sum).toBe(all);
  const vw = page.viewportSize()!.width;
  for (const tab of await page.getByRole("tab").all()) {
    const b = (await tab.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(vw);
  }
});

test("Decisions log lists decisions and supports undo", async ({ page }) => {
  await openNav(page, "Decisions");
  await expect(page.getByText("No decisions yet.", { exact: false })).toBeVisible();
  await openNav(page, "Today");
  await page.getByRole("button", { name: `Approve ${TOP}` }).click();
  await expect(handledList(page)).toBeVisible();
  await openNav(page, "Decisions");
  const row = page.getByRole("listitem").filter({ hasText: TOP });
  await expect(row).toContainText("Approved");
  await row.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("No decisions yet.", { exact: false })).toBeVisible();
});

test("switching sections starts at the top", async ({ page }) => {
  await page.locator("main").evaluate((m) => m.scrollTo({ top: 600 }));
  await openNav(page, "All suggestions");
  expect(await page.locator("main").evaluate((m) => m.scrollTop)).toBe(0);
});

test("layout never scrolls sideways", async ({ page }) => {
  for (const view of ["Today", "All suggestions", "Decisions"]) {
    await openNav(page, view);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, view).toBeLessThanOrEqual(0);
  }
  await openNav(page, "Today");
  await page.getByText(TOP).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("no accessibility violations on Today, All suggestions and the detail panel", async ({ page }) => {
  const scan = async (label: string) => {
    await page.waitForTimeout(900); // let spring animations settle so contrast is measured at rest
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
  };
  await scan("today");
  await page.getByText(TOP).click();
  await expect(panel(page)).toBeVisible();
  await page.waitForTimeout(600);
  await scan("panel");
  await page.keyboard.press("Escape");
  await openNav(page, "All suggestions");
  await scan("all");
});

test("screens for review", async ({ page }, info) => {
  const dir = "e2e/screens";
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/${info.project.name}-today.png` });
  await page.getByText(TOP).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${dir}/${info.project.name}-detail.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: `Approve ${TOP}` }).click();
  await page.getByRole("button", { name: `Approve ${SECOND}` }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/${info.project.name}-handled.png`, fullPage: true });
  await openNav(page, "All suggestions");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/${info.project.name}-all.png` });
});
