import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// These tests exercise the service worker itself; the config blocks it elsewhere.
test.use({ serviceWorkers: "allow" });

// The push service and /api/push/* exist only on the Cloudflare Worker, so both are faked here:
// PushManager returns a fixed subscription and the API calls are answered and recorded.
async function fakePush(page: Page) {
  await page.addInitScript(() => {
    if (!("PushManager" in window)) return;
    const w = window as unknown as { __sub: unknown };
    w.__sub = null;
    const sub = {
      endpoint: "https://push.example/device-1",
      toJSON: () => ({ endpoint: sub.endpoint, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } }),
      unsubscribe: async () => ((w.__sub = null), true),
    };
    PushManager.prototype.getSubscription = async () => w.__sub as PushSubscription | null;
    PushManager.prototype.subscribe = async () => ((w.__sub = sub), sub as unknown as PushSubscription);
  });
  const calls: string[] = [];
  await page.route("**/api/push/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    calls.push(`${req.method()} ${path}`);
    if (path === "/api/push/key") return route.fulfill({ json: { publicKey: "BMBwgn1PASUjf5SzOLqsrnSra7hZzhmb4QzcBYyxmkXfthwlacvp8J-N5am1CJraXNN1pBMRK3IPnT5JEisCu2A" } });
    if (req.method() === "DELETE") return route.fulfill({ status: 204 });
    return route.fulfill({ json: {} });
  });
  return calls;
}

async function openNotifications(page: Page) {
  await page.getByRole("button", { name: "Notifications" }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Notifications" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("desktop: turn notifications on, send a test, turn them off", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop", "Push permission can be granted only in Chromium");
  await context.grantPermissions(["notifications"], { origin: new URL(info.project.use.baseURL ?? "http://localhost:3000").origin });
  const calls = await fakePush(page);
  await page.goto("/");
  const dialog = await openNotifications(page);

  const toggle = dialog.getByRole("switch", { name: "Urgent alerts" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(dialog.getByRole("button", { name: "Send test notification" })).toHaveCount(0);
  // polled: the sheet fades in, and half-faded text fails the contrast check
  await expect
    .poll(async () => (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations.map((v) => v.id))
    .toEqual([]);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(calls).toContain("POST /api/push/subscribe");

  await dialog.getByRole("button", { name: "Send test notification" }).click();
  await expect(dialog.getByRole("status")).toHaveText(/Sent/);
  expect(calls).toContain("POST /api/push/test");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(calls).toContain("DELETE /api/push/subscribe");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("desktop: a server error is shown and the switch stays off", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop", "Push permission can be granted only in Chromium");
  await context.grantPermissions(["notifications"], { origin: new URL(info.project.use.baseURL ?? "http://localhost:3000").origin });
  await fakePush(page);
  await page.route("**/api/push/key", (route) => route.fulfill({ status: 503, json: { detail: "Notifications are not set up" } }));
  await page.goto("/");
  const dialog = await openNotifications(page);
  await dialog.getByRole("switch", { name: "Urgent alerts" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Notifications are not set up on this server.");
  await expect(dialog.getByRole("switch")).toHaveAttribute("aria-checked", "false");
});

test("iPhone in Safari: explains Add to Home Screen instead of a toggle", async ({ page }, info) => {
  test.skip(info.project.name !== "iphone", "iPhone only");
  await page.goto("/");
  const dialog = await openNotifications(page);
  await expect(dialog.getByText("Add to Home Screen first")).toBeVisible();
  await expect(dialog.getByText("Choose Add to Home Screen.")).toBeVisible();
  await expect(dialog.getByRole("switch")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close notifications" }).click();
  await expect(dialog).toBeHidden();
});

test("a notification link opens the app at its action", async ({ page }) => {
  await page.goto("/?action=ORDER-P043");
  await expect(page.getByRole("complementary", { name: /Details for Ceramic mug Black/ })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("PWA files are served", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.display).toBe("standalone");
  for (const icon of manifest.icons as { src: string }[]) expect((await request.get(icon.src)).ok()).toBe(true);
  const sw = await request.get("/sw.js");
  expect(sw.ok()).toBe(true);
  expect(await sw.text()).toContain("notificationclick");
});
