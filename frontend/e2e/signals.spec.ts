import { expect, type Page, test } from "@playwright/test";

const OTH = "https://im-kigs-openwebui.oth-regensburg.de/ollama/api/chat";
const MIN = 60_000;

test.use({ serviceWorkers: "block" });

const at = (ms: number) => new Date(Math.floor(Date.now() / MIN) * MIN + ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const kyiv = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

function power(simulated = true) {
  const starts = at(90 * MIN + 30_000);
  const ends = at(330 * MIN);
  return {
    id: "sim:power-test", kind: "power", severity: "high",
    title: `Power cut ${kyiv(starts)}–${kyiv(ends)}`,
    detail: "Scheduled power cut for outage queue 3.1. Tills, lights and card terminals need backup power.",
    starts_at: starts, ends_at: ends,
    source: simulated ? "Simulated for the demo" : "Vinnytsiaoblenergo schedule", simulated,
  };
}
const alert = () => ({
  id: "sim:alert-test", kind: "air_alert", severity: "high", title: "Air-raid alert",
  detail: "Vinnytsia oblast, since 11:46. Staff and shoppers go to shelter; the floor work waits.",
  starts_at: at(-5 * MIN), ends_at: at(40 * MIN), source: "Simulated for the demo", simulated: true,
});
const frost = {
  id: "weather:frost:2026-11-04", kind: "weather", severity: "low", title: "Frost down to −7 °C",
  detail: "Wednesday. Clear ice at the entrance; deliveries may run late on icy roads.",
  starts_at: at(14 * 60 * MIN), ends_at: at(38 * 60 * MIN), source: "Open-Meteo (CC BY 4.0)", simulated: false,
};
const FEEDS = [
  { kind: "power", source: "Vinnytsiaoblenergo schedule", live: true },
  { kind: "air_alert", source: "not connected yet, simulated only", live: false },
  { kind: "weather", source: "Open-Meteo (CC BY 4.0)", live: true },
];

async function mockSignals(page: Page, signals: object[] | null) {
  await page.route("**/api/signals", (route) =>
    signals === null
      ? route.fulfill({ status: 500, json: { detail: "down" } })
      : route.fulfill({ json: { updated_at: new Date().toISOString(), signals, feeds: FEEDS } }),
  );
}

type Body = { messages: { content: string }[] };
async function mockModel(page: Page, answer: (kind: "replan" | "briefing", user: Record<string, unknown>) => object) {
  const calls: { kind: string; user: Record<string, unknown> }[] = [];
  await page.route(OTH, async (route) => {
    const body = JSON.parse(route.request().postData()!) as Body;
    const kind = body.messages[0].content.includes("outside event") ? "replan" : "briefing";
    const user = JSON.parse(body.messages[1].content);
    calls.push({ kind, user });
    await route.fulfill({ json: { message: { content: JSON.stringify(answer(kind, user)) } } });
  });
  return calls;
}

async function open(page: Page, opts: { key?: boolean; lang?: "uk" | "en" } = {}) {
  await page.addInitScript(({ key, lang }) => {
    if (key) localStorage.setItem("avrora.webuiKey", "sk-test-key");
    if (lang) localStorage.setItem("avrora.lang", lang);
  }, opts);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Approve / }).first()).toBeVisible();
}

const live = (page: Page) => page.getByRole("region", { name: "Live conditions" });
const rowNames = (page: Page) =>
  page.getByRole("button", { name: /^Approve / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.slice(8)));

test("all clear is a quiet line; a failing feed hides the card", async ({ page }) => {
  await mockSignals(page, []);
  await open(page);
  await expect(page.getByTestId("all-clear")).toHaveText(/All clear: no power cuts or severe weather ahead\. Air.raid alerts are not connected\./);
  await expect(live(page)).toHaveCount(0);

  await page.unroute("**/api/signals");
  await mockSignals(page, null);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Approve / }).first()).toBeVisible();
  await expect(page.getByTestId("all-clear")).toHaveCount(0);
  await expect(live(page)).toHaveCount(0);
});

test("card lists power, alert and weather with simulated badges and sources", async ({ page }) => {
  await mockSignals(page, [alert(), power(), frost]);
  await open(page);
  const card = live(page);
  await expect(card.getByTestId("signal")).toHaveCount(3);
  await expect(card.getByText("Simulated, not real", { exact: true })).toHaveCount(2);
  await expect(card.getByText(/^Now · ends in \d+ min$/)).toBeVisible();
  await expect(card.getByText(/^Starts in 1 h 30 min$/)).toBeVisible();
  await expect(card.getByText("Frost down to −7 °C")).toBeVisible();
  // sources sit behind a quiet disclosure
  await card.getByText("Sources", { exact: true }).click();
  await expect(card.getByText(/Weather: Open.Meteo \(CC BY 4\.0\)\./)).toBeVisible();
  await expect(card.getByText(/Air.raid alerts: not connected yet, simulated only\./)).toBeVisible();
  // the card sits above the store note
  const cardBox = (await card.boundingBox())!;
  const noteBox = (await page.getByText("Store note", { exact: true }).boundingBox())!;
  expect(cardBox.y).toBeLessThan(noteBox.y);
});

test("weather alone gives no re-plan button", async ({ page }) => {
  await mockSignals(page, [frost]);
  await open(page);
  await expect(live(page).getByTestId("signal")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Re-plan for this/ })).toHaveCount(0);
});

test("without a key the re-plan uses the rules and can be reverted", async ({ page }) => {
  await mockSignals(page, [power(false)]);
  await open(page);
  const before = await rowNames(page);
  await expect(live(page).getByText("Simulated, not real", { exact: true })).toHaveCount(0);
  await live(page).getByRole("button", { name: /Re-plan for this/ }).click();
  await expect(live(page).getByText("Sorted by fixed rules, not AI.")).toBeVisible();
  await expect(page.getByTestId("replan-note")).toContainText("Orders and price changes first");
  const after = await rowNames(page);
  expect(after).toEqual(["Ceramic mug Black", "Bubble wand 100 pcs", "Frying pan Set of 3", "Vacuum bags White", "Bath mat S"]);
  await expect(page.getByTestId("moved-up")).toHaveCount(1);
  await live(page).getByRole("button", { name: "Revert" }).click();
  await expect(page.getByTestId("moved-up")).toHaveCount(0);
  expect(await rowNames(page)).toEqual(before);
});

test("with a key the OTH model reorders and explains, numbers checked", async ({ page }) => {
  const calls = await mockModel(page, (_k, user) => {
    const ev = user.event as { starts: string; ends: string };
    return {
      order: ["ORDER-P121", "ORDER-P043", "DISCOUNT-P055", "MOVE_TO_FRONT-P027", "MOVE_TO_FRONT-P031"],
      note: `Power is off ${ev.starts}–${ev.ends}: place both orders first while the tills work.\nShelf moves can wait for the cut.`,
    };
  });
  await mockSignals(page, [power()]);
  await open(page, { key: true });
  await live(page).getByRole("button", { name: /Re-plan for this/ }).click();
  await expect(live(page).getByText("Reordered by AI. Numbers checked against store data.")).toBeVisible();
  await expect(page.getByTestId("replan-note")).toContainText("place both orders first");
  expect((await rowNames(page))[0]).toBe("Bubble wand 100 pcs");
  await expect(page.getByTestId("moved-up")).toHaveCount(1);
  const sent = calls[0].user as { event: { kind: string }; priorities: { id: string }[]; language: string };
  expect(sent.event.kind).toBe("power");
  expect(sent.priorities).toHaveLength(5);
  expect(sent.language).toBe("English");
});

test("a model note with an invented number or a new action falls back to the rules", async ({ page }) => {
  await mockModel(page, () => ({
    order: ["ORDER-P121", "ORDER-NEW", "DISCOUNT-P055", "MOVE_TO_FRONT-P027", "MOVE_TO_FRONT-P031"],
    note: "Order 450 extra units before the cut.",
  }));
  await mockSignals(page, [alert()]);
  await open(page, { key: true });
  await live(page).getByRole("button", { name: /Re-plan for this/ }).click();
  await expect(live(page).getByText("Sorted by fixed rules, not AI.")).toBeVisible();
  await expect(page.getByText(/450/)).toHaveCount(0);
  await expect(page.getByTestId("replan-note")).toContainText("floor work waits for the all-clear");
});

test("Ukrainian briefing and re-plan note, language kept in this browser", async ({ page }) => {
  const calls = await mockModel(page, (kind, user) =>
    kind === "briefing"
      ? {
          summary: "Сьогодні 5 пріоритетів; найбільше під загрозою 6 041,22 ₴ на кухлях.",
          priorities: [{ action_id: "ORDER-P043", reason: "Залишилось 7 шт., продаємо 7,9 на день, а доставка йде 6 днів." }],
        }
      : {
          order: ["ORDER-P043", "ORDER-P121", "DISCOUNT-P055", "MOVE_TO_FRONT-P027", "MOVE_TO_FRONT-P031"],
          note: `Світла не буде з ${(user.event as { starts: string }).starts}: спершу замовлення.\nПолиці після відключення.`,
        },
  );
  await mockSignals(page, [power()]);
  await open(page);
  await page.getByRole("button", { name: "Write with AI" }).click();
  const sheet = page.getByRole("dialog", { name: "AI briefing" });
  await expect(sheet.getByRole("radio", { name: "English" })).toHaveAttribute("aria-checked", "true");
  await sheet.getByRole("radio", { name: "Українська" }).click();
  await sheet.getByLabel("Open WebUI key").fill("sk-test-key");
  await sheet.getByRole("button", { name: "Save and write briefing" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("summary")).toHaveText("Сьогодні 5 пріоритетів; найбільше під загрозою 6 041,22 ₴ на кухлях.");
  await expect(page.getByTestId("summary")).toHaveAttribute("lang", "uk");
  await expect(page.getByText("Залишилось 7 шт.", { exact: false })).toBeVisible();
  expect((calls[0].user as { language: string }).language).toBe("Ukrainian");
  expect(await page.evaluate(() => localStorage.getItem("avrora.lang"))).toBe("uk");

  await live(page).getByRole("button", { name: /Re-plan for this/ }).click();
  await expect(page.getByTestId("replan-note")).toContainText("спершу замовлення");
  await expect(page.getByTestId("replan-note")).toHaveAttribute("lang", "uk");
  expect((calls[1].user as { language: string }).language).toBe("Ukrainian");
});

test("Ukrainian rules note without a key", async ({ page }) => {
  await mockSignals(page, [alert()]);
  await open(page, { lang: "uk" });
  await live(page).getByRole("button", { name: /Re-plan for this/ }).click();
  await expect(page.getByTestId("replan-note")).toContainText("Повітряна тривога");
});

test("screenshots of live conditions", async ({ page }, info) => {
  const settle = () => page.waitForTimeout(1200);
  await mockSignals(page, [power(), frost]);
  await open(page);
  await expect(live(page)).toBeVisible();
  await settle();
  await page.screenshot({ path: `e2e/tmpshots/signals-${info.project.name}.png` });
  await live(page).getByRole("button", { name: /Re-plan for this/ }).click();
  await expect(page.getByTestId("replan")).toBeVisible();
  await settle();
  await page.getByTestId("replan").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `e2e/tmpshots/signals-${info.project.name}-replan.png` });
  await page.getByRole("heading", { name: "To decide" }).evaluate((e) => e.scrollIntoView({ block: "start" }));
  await settle();
  await page.screenshot({ path: `e2e/tmpshots/signals-${info.project.name}-list.png` });
  await page.unroute("**/api/signals");
  await mockSignals(page, []);
  await page.reload();
  await expect(page.getByTestId("all-clear")).toBeVisible();
  await settle();
  await page.screenshot({ path: `e2e/tmpshots/signals-${info.project.name}-clear.png` });
});
