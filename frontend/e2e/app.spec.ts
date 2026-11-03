import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const API = process.env.BASE_URL ?? "http://127.0.0.1:8000";
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
  const target = page.getByRole("button", { name: re }).filter({ visible: true });
  // All suggestions and the settings sit under More in the tab bar
  if (["All suggestions", "Decisions", "Notifications", "AI briefing"].includes(name) && !(await target.count()))
    await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "More", exact: true }).click();
  await target.first().click();
}

const toast = (page: Page) => page.getByTestId("toast");

test.afterAll(resetDecisions);
// optimistic saves finish in the background: let them land before the next test resets the server
test.afterEach(async ({ page }) => {
  await page.waitForLoadState("networkidle").catch(() => undefined);
});

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

test("AI briefing: add a key, see the model's text, remove the key", async ({ page }) => {
  // The browser calls the OTH server directly; answer for it so the test needs no VPN or key.
  let sentKey = "";
  await page.route("https://im-kigs-openwebui.oth-regensburg.de/ollama/api/chat", async (route) => {
    sentKey = route.request().headers()["authorization"] ?? "";
    if (sentKey === "Bearer sk-wrong-key") return route.fulfill({ status: 401, body: "" });
    const { candidates } = JSON.parse(JSON.parse(route.request().postData()!).messages[1].content);
    const content = JSON.stringify({
      summary: "Restock the mugs first; the rest can follow.",
      priorities: candidates.slice(0, 5).map((c: { id: string }) => ({ action_id: c.id, reason: "Plain reason from the model." })),
    });
    await route.fulfill({ json: { message: { content } } });
  });

  await expect(page.getByText("Fixed rules, not AI.")).toBeVisible();
  await page.getByRole("button", { name: "Write with AI" }).click();
  const dialog = page.getByRole("dialog", { name: "AI briefing" });
  const submit = dialog.getByRole("button", { name: "Save and write briefing" });
  await expect(submit).toBeDisabled();

  await dialog.getByLabel("Open WebUI key").fill("sk-wrong-key");
  await submit.click();
  await expect(dialog.getByRole("alert")).toContainText("This key didn't work");

  await dialog.getByLabel("Open WebUI key").fill("sk-test-key-123");
  await submit.click();
  await expect(dialog).toBeHidden();
  expect(sentKey).toBe("Bearer sk-test-key-123");
  await expect(todayList(page).getByText("Plain reason from the model.")).toHaveCount(5);
  await expect(page.getByText("Restock the mugs first; the rest can follow.")).toBeVisible();
  await expect(page.getByText("Written by AI. Numbers checked against store data.")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Restock the mugs first; the rest can follow.")).toBeVisible();

  await page.getByRole("button", { name: "AI settings" }).click();
  await expect(dialog.getByLabel("Open WebUI key")).toHaveAttribute("placeholder", "Saved in this browser");
  await dialog.getByRole("button", { name: "Remove key and stop using AI" }).click();
  await expect(page.getByText("Fixed rules, not AI.")).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("avrora.")))).toEqual([]);
});

test("light appearance uses the shop-floor background", async ({ page }) => {
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  expect(bg).toBe("rgb(242, 242, 238)");
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
  await expect(handledList(page).getByText("Approved with change: 96")).toBeVisible();
  // reopening the handled item shows the change
  await page.keyboard.press("Escape");
  await handledList(page).getByText(TOP).click();
  await expect(panel(page).getByText("Approved with 96 units")).toBeVisible();
});

test("dismiss records the reason", async ({ page }) => {
  await page.getByText(SECOND).click();
  const p = panel(page);
  await p.getByRole("button", { name: "Dismiss" }).click();
  await p.getByRole("button", { name: "Already handled" }).click();
  await expect(handledList(page).getByText("Dismissed · Already handled")).toBeVisible();
  await expect(toast(page)).toContainText(`Dismissed ${SECOND}`);
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(handledList(page)).toHaveCount(0);
  await expect(todayList(page).getByRole("listitem")).toHaveCount(5);
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
  // the chip row may scroll sideways on its own, the page never does
  const row = (await page.getByRole("tablist", { name: "Filter by type" }).boundingBox())!;
  expect(row.x).toBeGreaterThanOrEqual(0);
  expect(row.x + row.width).toBeLessThanOrEqual(vw);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  for (const tab of await page.getByRole("tab").all()) expect(await tab.evaluate((e) => e.scrollHeight <= 48)).toBe(true);
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

test("Map shows Avrora stores, supply partners and OpenStreetMap infrastructure", async ({ page }, info) => {
  const errors = watchConsole(page);
  await openNav(page, "Map");
  await expect(page.getByRole("heading", { name: "Supply network" })).toBeVisible();
  await expect(page.getByText("7,561 places in Ukraine from Avrora and OpenStreetMap")).toBeVisible();
  await expect(page.getByText("7,561 shown")).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(page.getByLabel("Avrora Store #417, Vinnytsia")).toBeVisible();

  await page.getByRole("tab", { name: "Avrora" }).click();
  await expect(page.getByText("1,935 shown")).toBeVisible();
  await page.getByRole("tab", { name: "Supply" }).click();
  await expect(page.getByText("17 shown")).toBeVisible();
  await page.getByRole("tab", { name: "Storage" }).click();
  await expect(page.getByText("5,328 shown")).toBeVisible();
  await page.getByRole("tab", { name: "Food" }).click();
  await expect(page.getByText("281 shown")).toBeVisible();

  // an official Avrora store links back to the store locator
  await page.getByRole("tab", { name: "All" }).click();
  const results = page.getByRole("list", { name: "Search results" }).getByRole("button");
  await page.getByLabel("Search places").fill("Метрологічна 14");
  await results.first().click();
  await expect(page.locator(".nm-popup")).toContainText("Avrora #3371", { timeout: 8000 });
  await expect(page.locator(".nm-popup")).toContainText("Open Mon–Sun 8:00–21:00");
  await expect(page.locator(".nm-popup").getByRole("link", { name: "View on avrora.ua" })).toHaveAttribute(
    "href",
    "https://avrora.ua/index.php?dispatch=store_locator.view&store_location_id=3371",
  );

  // a supply partner shows its status and cites its source
  await page.getByLabel("Search places").fill("Poltava");
  await results.filter({ hasText: "Avrora distribution centre — Poltava" }).first().click();
  await expect(page.locator(".nm-popup .nm-kind")).toHaveText("Avrora logistics", { timeout: 8000 });
  await expect(page.locator(".nm-popup")).toContainText("Damaged");
  await expect(page.locator(".nm-popup").getByRole("link", { name: "Source: Suspilne Poltava" })).toBeVisible();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `e2e/screens/${info.project.name}-map-supply.png` });

  await page.getByLabel("Search places").fill("Ungurian");
  await expect(results.first()).toBeVisible();
  await results.first().click();
  await expect(page.locator(".nm-popup")).toContainText("Ungurian Trans", { timeout: 8000 });
  await expect(page.locator(".nm-popup").getByRole("link", { name: "View on OpenStreetMap" })).toBeVisible();
  await page.waitForTimeout(2500); // let the flight land and the street tiles load
  await expect(page.locator(".nm-popup")).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: `e2e/screens/${info.project.name}-map-place.png` });

  await page.getByRole("button", { name: "Your store" }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `e2e/screens/${info.project.name}-map-store.png` });
  expect(errors).toEqual([]);
});

test("a decision in the panel moves on to the next open priority, then closes", async ({ page }) => {
  await page.getByText(TOP).click();
  await expect(panel(page)).toHaveAccessibleName(`Details for ${TOP}`);
  await panel(page).getByRole("button", { name: "Approve", exact: true }).click();
  await expect(panel(page)).toHaveAccessibleName(`Details for ${SECOND}`);
  await expect(toast(page)).toContainText(`Approved ${TOP}`);
  for (let i = 0; i < 4; i++) await panel(page).getByRole("button", { name: "Approve", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole("img", { name: "5 of 5 handled" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "All done" })).toBeVisible();
});

test("approval shows at once, Undo in the toast takes it back", async ({ page }) => {
  // hold the save so the row can only have moved because of the optimistic update
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/decisions", async (route) => {
    if (route.request().method() === "POST") await held;
    await route.fallback();
  });
  await page.getByRole("button", { name: `Approve ${TOP}` }).click();
  await expect(handledList(page).getByText(TOP)).toBeVisible();
  await expect(page.getByRole("img", { name: "1 of 5 handled" })).toBeVisible();
  release();
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(handledList(page)).toHaveCount(0);
  await expect(toast(page)).toHaveCount(0);
  await page.reload(); // the undo reached the server after the approval
  await expect(todayList(page).getByRole("listitem")).toHaveCount(5);
  await expect(handledList(page)).toHaveCount(0);
});

test("a failed save rolls back with a plain message", async ({ page }) => {
  await page.route("**/api/decisions", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 500, body: "" }) : route.fallback(),
  );
  await page.getByRole("button", { name: `Approve ${TOP}` }).click();
  await expect(page.getByRole("alert").filter({ hasText: "That decision wasn't saved" })).toBeVisible();
  await expect(handledList(page)).toHaveCount(0);
  await expect(todayList(page).getByRole("listitem")).toHaveCount(5);
});

test("keyboard: j/k move, a approves, d dismisses, Esc closes, typing is left alone", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "hardware keyboard shortcuts are for desktop");
  await page.keyboard.press("j");
  await expect(panel(page)).toHaveAccessibleName(`Details for ${TOP}`);
  await page.keyboard.press("j");
  await expect(panel(page)).toHaveAccessibleName(`Details for ${SECOND}`);
  await page.keyboard.press("k");
  await expect(panel(page)).toHaveAccessibleName(`Details for ${TOP}`);
  await page.keyboard.press("a");
  await expect(handledList(page).getByText(TOP)).toBeVisible();
  await expect(panel(page)).toHaveAccessibleName(`Details for ${SECOND}`);
  await page.keyboard.press("d");
  await expect(panel(page).getByRole("button", { name: "Not needed" })).toBeVisible();
  await page.keyboard.press("Escape"); // first Esc leaves the reason picker
  await expect(panel(page).getByRole("button", { name: "Not needed" })).toHaveCount(0);
  await page.keyboard.press("d");
  await page.keyboard.press("1");
  await expect(handledList(page).getByText("Dismissed · Not needed")).toBeVisible();
  // typing in a field never triggers a shortcut
  await panel(page).getByRole("button", { name: "Adjust" }).click();
  const input = panel(page).getByRole("spinbutton");
  const name = await panel(page).getAttribute("aria-label");
  await input.press("a");
  await input.press("j");
  await expect(panel(page)).toHaveAttribute("aria-label", name!);
  await expect(handledList(page).getByRole("listitem")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
});

const tabBar = (page: Page) => page.getByRole("navigation", { name: "Sections" });

/** Scroll the section to its end and check its last element sits fully above the floating tab bar. */
async function clearsBar(page: Page, last: ReturnType<Page["locator"]>, what: string) {
  await expect(last, what).toBeAttached();
  await page.locator("main").evaluate((m) => m.scrollTo({ top: m.scrollHeight }));
  await expect(last, what).toBeInViewport();
  const bar = (await tabBar(page).locator("ul").boundingBox())!;
  const box = (await last.boundingBox())!;
  expect(box.y + box.height, what).toBeLessThanOrEqual(bar.y);
}

async function checkBar(page: Page) {
  const bar = tabBar(page);
  await expect(bar).toBeVisible();
  for (const name of ["Team", "Products", "Map", "More"]) await expect(bar.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(bar.getByRole("button", { name: /^Today \d+ to decide$/ })).toHaveAttribute("aria-current", "page");
  const vp = page.viewportSize()!;
  const pill = (await bar.locator("ul").boundingBox())!;
  // floating: inset from the edges and centred
  expect(pill.x).toBeGreaterThan(0);
  expect(pill.y + pill.height).toBeLessThan(vp.height);
  expect(Math.abs(pill.x + pill.width / 2 - vp.width / 2)).toBeLessThanOrEqual(2);
  for (const b of await bar.getByRole("button").all()) {
    const box = (await b.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  // nothing ends behind the bar
  await clearsBar(page, page.getByText("Value in slow stock"), "Today");
  await bar.getByRole("button", { name: "Products", exact: true }).click();
  await clearsBar(page, page.getByTestId("product-list").last(), "Products");
  await bar.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Decisions", exact: true }).click();
  await clearsBar(page, page.getByText(/No decisions yet|Undo$/).last(), "Decisions");
  await bar.getByRole("button", { name: "More", exact: true }).click();
  await clearsBar(page, page.getByText(/^Store data is made up/), "More");
  await page.getByRole("button", { name: /^All suggestions/ }).click();
  await clearsBar(page, page.locator("main li").last(), "All suggestions");
  await bar.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  for (const el of [page.getByRole("button", { name: "Your store" }), page.locator(".maplibregl-ctrl-attrib")]) {
    await expect(el).toBeVisible();
    const box = (await el.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(pill.y);
  }
  await bar.getByRole("button", { name: /^Today/ }).click();
}

test("tab bar: five tabs, badge, More holds settings, nothing hides behind it", async ({ page }) => {
  const bar = tabBar(page);
  await expect(page.getByRole("navigation")).toHaveCount(1); // no sidebar on any screen
  await checkBar(page);
  await page.getByRole("button", { name: `Approve ${TOP}` }).click();
  await expect(bar.getByRole("button", { name: "Today 4 to decide" })).toBeVisible();

  await bar.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("heading", { name: "More", level: 1 })).toBeVisible();
  await expect(page.getByRole("img", { name: "Avrora" })).toBeVisible();
  await page.getByRole("button", { name: /^All suggestions/ }).click();
  await expect(page.getByRole("heading", { name: "All suggestions", level: 1 })).toBeVisible();
  await expect(bar.getByRole("button", { name: "More", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("main").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "AI briefing" }).click();
  await expect(page.getByRole("dialog", { name: "AI briefing" })).toBeVisible();
  await page.getByRole("button", { name: "Close AI briefing" }).click();
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "Products", exact: true }).click();
  await expect(bar.getByRole("button", { name: "Products", exact: true })).toHaveAttribute("aria-current", "page");
});

test("tab bar works on tablet and small desktop widths too", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop project resizes itself");
  for (const size of [{ width: 1024, height: 768 }, { width: 820, height: 1180 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(size);
    await checkBar(page);
  }
  await tabBar(page).getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByTestId("shortcuts")).toBeVisible();
  // keyboard: tab into the bar, focus ring, Enter switches
  const map = tabBar(page).getByRole("button", { name: "Map", exact: true });
  await map.focus();
  await page.keyboard.press("Enter");
  await expect(map).toHaveAttribute("aria-current", "page");
});

test("desktop: an open panel keeps the list and the tab bar clear", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "wide screens only");
  for (const width of [1024, 1180, 1360, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await page.getByText(TOP).click();
    const p = (await panel(page).boundingBox())!;
    const pill = (await tabBar(page).locator("ul").boundingBox())!;
    expect(pill.x + pill.width, `${width} action`).toBeLessThanOrEqual(p.x);
    await page.keyboard.press("Escape");
    await tabBar(page).getByRole("button", { name: "Products", exact: true }).click();
    await page.getByRole("main").getByRole("listitem").first().getByRole("button").click();
    const pp = (await page.getByRole("complementary", { name: /^Product / }).boundingBox())!;
    const list = (await page.getByTestId("product-list").first().boundingBox())!;
    expect(list.x + list.width, `${width} products`).toBeLessThanOrEqual(pp.x);
    const pill2 = (await tabBar(page).locator("ul").boundingBox())!;
    expect(pill2.x + pill2.width, `${width} product bar`).toBeLessThanOrEqual(pp.x);
  }
});

test("phone: the large title folds into the navigation bar", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phones only");
  const compact = page.locator("main .t-headline").first();
  await expect(compact).toHaveCSS("opacity", "0");
  await page.locator("main").evaluate((m) => m.scrollTo({ top: 300 }));
  await expect(compact).toHaveCSS("opacity", "1");
  await expect(compact).toHaveText("Today");
});

test("phone: swipe the detail sheet down to close it", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phones only");
  await page.getByText(TOP).click();
  await expect(panel(page)).toBeVisible();
  await page.waitForTimeout(500);
  const h = (await panel(page).getByRole("heading", { name: TOP }).boundingBox())!;
  await page.mouse.move(h.x + 10, h.y + 5);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(h.x + 10, h.y + 5 + i * 30);
  await page.mouse.up();
  await expect(panel(page)).toHaveCount(0);
});

test("phone: the adjust field and its buttons stay on screen", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "phones only");
  await page.getByText(TOP).click();
  await panel(page).getByRole("button", { name: "Adjust" }).click();
  const vp = page.viewportSize()!;
  for (const el of [panel(page).getByRole("spinbutton"), panel(page).getByRole("button", { name: "Approve", exact: true })]) {
    await expect(el).toBeInViewport({ ratio: 1 });
    const b = (await el.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
  }
});

test("switching sections starts at the top", async ({ page }) => {
  await page.locator("main").evaluate((m) => m.scrollTo({ top: 600 }));
  await openNav(page, "All suggestions");
  expect(await page.locator("main").evaluate((m) => m.scrollTop)).toBe(0);
});

test("layout never scrolls sideways", async ({ page }) => {
  for (const view of ["Today", "Products", "All suggestions", "Decisions", "Map"]) {
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
  await openNav(page, "Today");
  await page.getByRole("button", { name: "Write with AI" }).click();
  await scan("ai sheet");
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
  await openNav(page, "Decisions");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/${info.project.name}-decisions.png` });
  await openNav(page, "Products");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/${info.project.name}-products.png` });
  await openNav(page, "More");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/${info.project.name}-more.png` });
  await openNav(page, "Today");
  await page.locator("main").evaluate((m) => m.scrollTo({ top: 400 }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/${info.project.name}-today-scrolled.png` });
  await todayList(page).getByRole("listitem").first().getByRole("button").nth(1).click();
  await panel(page).getByRole("button", { name: "Dismiss" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/${info.project.name}-detail-dismiss.png` });
  await panel(page).getByRole("button", { name: "Cancel" }).click();
  await panel(page).getByRole("button", { name: "Approve", exact: true }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/${info.project.name}-advance-toast.png` });
  await page.keyboard.press("Escape");
  await page.locator("main").evaluate((m) => m.scrollTo({ top: 0 }));
  await page.getByRole("button", { name: "Write with AI" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/${info.project.name}-ai.png` });
  await page.keyboard.press("Escape");
  await openNav(page, "Notifications");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/${info.project.name}-notifications.png` });
});
