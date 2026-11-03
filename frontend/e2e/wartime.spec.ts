import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function openWartime(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Map$/ }).filter({ visible: true }).first().click();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await page.getByRole("button", { name: "War-time" }).click();
  await expect(page.getByRole("heading", { name: "War-time risk" })).toBeVisible();
}

const stores = (page: Page) => page.getByRole("list", { name: "Stores by risk" }).getByRole("button");

test("war-time mode without an alerts token rates stores by distance only", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/wartime/alerts", (r) => r.fulfill({ json: { connected: false, reason: "no_token" } }));
  await openWartime(page);

  await expect(page.getByText("Air-raid alerts not connected. Risk uses distance only.")).toBeVisible();
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
  await expect(details).toContainText("Not connected");
  await expect(details).toContainText("Generator, about");
  await page.waitForTimeout(1800); // let the flight land
  await page.screenshot({ path: `e2e/screens/${info.project.name}-wartime-store.png` });

  await details.getByRole("button", { name: "All stores" }).click();
  await expect(stores(page)).toHaveCount(13);
  await page.getByRole("button", { name: "Network", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Supply network" })).toBeVisible();
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
