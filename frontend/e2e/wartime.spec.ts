import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const THREATS = {
  connected: true,
  source: "mapa.ua",
  fetched_at: "2026-11-03T10:05:00Z",
  // one drone next to Zaporizhzhia, one over the Black Sea far from any site
  threats: [
    { id: "t1", kind: "drone_piston", lat: 47.84, lon: 35.14, amount: 2, seen_at: "2026-11-03T10:03:00Z" },
    { id: "t2", kind: "drone_jet", lat: 44.9, lon: 31.5, amount: 1, seen_at: null },
  ],
};

/** Phones fold the map controls into one bar; open it so the panel can be used. */
async function openMapControls(page: Page) {
  const bar = page.getByRole("button", { name: "Map layers and search" });
  if (await bar.isVisible()) {
    if ((await bar.getAttribute("aria-expanded")) !== "true") await bar.click();
    await expect(bar).toHaveAttribute("aria-expanded", "true");
  }
}

async function openWartime(page: Page, threats: object = { connected: false, reason: "unavailable" }) {
  await page.route("**/api/wartime/threats", (r) => r.fulfill({ json: threats }));
  await page.goto("/");
  await page.getByRole("button", { name: /^Map$/ }).filter({ visible: true }).first().click();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await openMapControls(page);
  // both layers show together by default
  await expect(page.getByRole("checkbox", { name: "Supply network" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("checkbox", { name: "War-time risk" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("heading", { name: "Supply network" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "War-time risk" })).toBeVisible();
}

const stores = (page: Page) => page.getByRole("list", { name: "Stores by risk" }).getByRole("button");

test("war-time mode without an alerts token rates stores by distance only", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/wartime/alerts", (r) => r.fulfill({ json: { connected: false, reason: "no_token" } }));
  await openWartime(page);

  await expect(page.getByText(/not connected/i)).toHaveCount(0);
  await expect(page.getByText("Sample stores. The front line is a hand-drawn sketch", { exact: false })).toBeVisible();
  await expect(stores(page)).toHaveCount(13);
  // closest to the sketched line first, Lviv last
  await expect(stores(page).first()).toContainText("Kherson");
  await expect(stores(page).first()).toContainText("Critical");
  await expect(stores(page).last()).toContainText("Lviv");
  await expect(stores(page).last()).toContainText("Low");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `e2e/screens/${info.project.name}-wartime-list.png` });

  await stores(page).filter({ hasText: "Kherson" }).click();
  const details = page.getByRole("region", { name: "War-time details for Kherson" });
  await expect(details).toBeVisible();
  await expect(details).toContainText("Open, high alert");
  await expect(details).not.toContainText(/not connected|Air-raid alert/i);
  await expect(details).toContainText("Generator, about");
  await page.waitForTimeout(1800); // let the flight land
  await page.screenshot({ path: `e2e/screens/${info.project.name}-wartime-store.png` });

  await details.getByRole("button", { name: "All stores" }).click();
  await expect(stores(page)).toHaveCount(13);
  // narrow to one layer with its checkmark; the last one can't be turned off
  await page.getByRole("checkbox", { name: "War-time risk" }).click();
  await expect(page.getByRole("heading", { name: "War-time risk" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Supply network" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Supply network" })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("checkbox", { name: "War-time risk" }).click();
  await page.getByRole("checkbox", { name: "Supply network" }).click();
  await expect(page.getByRole("heading", { name: "Supply network" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "War-time risk", level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test("war-time mode uses live alerts when the server is connected", async ({ page }) => {
  await page.route("**/api/wartime/alerts", (r) =>
    r.fulfill({
      json: {
        connected: true,
        source: "alerts.in.ua",
        fetched_at: "2026-11-03T10:05:00Z",
        oblasts: ["Львівська область"],
        hromadas: [],
      },
    }),
  );
  await openWartime(page);
  await expect(page.getByText(/Air-raid alerts live from alerts\.in\.ua/)).toBeVisible();
  const lviv = stores(page).filter({ hasText: "Lviv" });
  await expect(lviv).toContainText("Active in the region");
  await lviv.click();
  const details = page.getByRole("region", { name: "War-time details for Lviv" });
  await expect(details).toContainText("Closed, in shelter");
  await expect(details).toContainText("High");
});

test("war-time mode has no accessibility violations", async ({ page }) => {
  await page.route("**/api/wartime/alerts", (r) => r.fulfill({ json: { connected: false, reason: "no_token" } }));
  await openWartime(page);
  await expect(stores(page)).toHaveCount(13);
  await page.waitForTimeout(900);
  const r = await new AxeBuilder({ page }).include("main").exclude(".maplibregl-canvas-container").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(r.violations.map((v) => `${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
});

test("aerial threats and supply sites at risk are shown and labelled as estimates", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/wartime/alerts", (r) => r.fulfill({ json: { connected: false, reason: "no_token" } }));
  await openWartime(page, THREATS);

  await expect(page.getByText(/2 aerial threats reported, mapa\.ua .*Unofficial estimates\./)).toBeVisible();
  const section = page.getByRole("region", { name: "Supply sites at risk" });
  await expect(section).toContainText(/near threats/);
  const sites = page.getByRole("list", { name: "Supply sites by risk" }).getByRole("button");
  await expect(sites).toHaveCount(5);
  await expect(sites.first()).toContainText("Critical");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `e2e/screens/${info.project.name}-wartime-threats.png` });

  await sites.first().click();
  const popup = page.locator(".nm-popup");
  await expect(popup).toContainText("risk");
  await expect(popup).toContainText(/Hold shipments|Expect delays|Deliveries usually run/);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `e2e/screens/${info.project.name}-wartime-site.png` });
  expect(errors).toEqual([]);
});

test("without the threat feed the panel stays quiet", async ({ page }) => {
  await page.route("**/api/wartime/threats", (r) => r.fulfill({ json: { connected: false } }));
  await page.route("**/api/wartime/alerts", (r) => r.fulfill({ json: { connected: false, reason: "no_token" } }));
  await openWartime(page);
  await expect(page.getByText(/not connected/i)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Supply sites at risk" })).not.toContainText("near threats");
});

test("phones: map controls start folded so the map gets the screen", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "the controls are always open on wide screens");
  await page.route("**/api/wartime/threats", (r) => r.fulfill({ json: { connected: false, reason: "unavailable" } }));
  await page.goto("/");
  await page.getByRole("button", { name: /^Map$/ }).filter({ visible: true }).first().click();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  const bar = page.getByRole("button", { name: "Map layers and search" });
  await expect(bar).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("checkbox", { name: "Supply network" })).toBeHidden();
  const folded = await page.locator("#map-controls").evaluate((el) => el.parentElement!.getBoundingClientRect().height);
  expect(folded, "folded bar stays small").toBeLessThan(80);
  await bar.click();
  await expect(page.getByRole("checkbox", { name: "Supply network" })).toBeVisible();
  await bar.click();
  await expect(page.getByRole("checkbox", { name: "Supply network" })).toBeHidden();
});
