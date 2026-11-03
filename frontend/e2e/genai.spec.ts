import { expect, type Page, type Route, test } from "@playwright/test";

const OTH = "https://im-kigs-openwebui.oth-regensburg.de/ollama/api/chat";
const TOP = "Ceramic mug Black"; // ORDER: 120 units from KitchenLine, delivery takes 6 days

// A service worker would bypass page.route for the OTH mock.
test.use({ serviceWorkers: "block" });

const panel = (page: Page) => page.getByRole("complementary", { name: /Details for/ });

/** Answers for the OTH server, chosen by which prompt the browser sent. */
async function mockModel(page: Page, answer: (kind: "ask" | "draft", body: { messages: { content: string }[] }) => object) {
  const calls: { kind: string; user: unknown }[] = [];
  await page.route(OTH, async (route: Route) => {
    const body = JSON.parse(route.request().postData()!);
    const kind = body.messages[0].content.includes("supplier") && body.format.properties.subject ? "draft" : "ask";
    calls.push({ kind, user: JSON.parse(body.messages[1].content) });
    await route.fulfill({ json: { message: { content: JSON.stringify(answer(kind, body)) } } });
  });
  return calls;
}

async function openTop(page: Page, withKey = true) {
  await page.addInitScript((k) => {
    if (k) localStorage.setItem("avrora.webuiKey", "sk-test-key");
    (window as unknown as { __copied: string }).__copied = "";
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (t: string) => void ((window as unknown as { __copied: string }).__copied = t) },
    });
  }, withKey);
  await page.goto("/");
  await page.getByText(TOP).first().click();
  await expect(panel(page)).toBeVisible();
}

test("ask: a grounded answer is shown and kept in the history", async ({ page }) => {
  const calls = await mockModel(page, () => ({ in_scope: true, answer: "Sales are about 7.9 a day and delivery takes 6 days, so 120 units cover the wait." }));
  await openTop(page);
  const ask = panel(page).getByRole("region", { name: "Ask about this" });
  await ask.getByRole("button", { name: "Why this quantity?" }).click();
  await expect(ask.getByTestId("ask-answer")).toHaveText(/120 units cover the wait/);
  const sent = calls[0].user as { action: { proposal: { order_qty: number } }; product: { history: unknown[] }; question: string };
  expect(sent.action.proposal.order_qty).toBe(120);
  expect(sent.product.history.length).toBeGreaterThan(0);
  expect(sent.question).toBe("Why this quantity?");

  await ask.getByLabel("Question about this item").fill("What if I order less?");
  await ask.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(ask.getByTestId("ask-answer")).toHaveCount(2);
});

test("ask: an invented number is replaced by the fallback", async ({ page }) => {
  await mockModel(page, () => ({ in_scope: true, answer: "Order 450 units because demand will grow by 38% next month." }));
  await openTop(page);
  const ask = panel(page).getByRole("region", { name: "Ask about this" });
  await ask.getByRole("button", { name: "What happens if I do nothing?" }).click();
  await expect(ask.getByTestId("ask-answer")).toHaveText("I can't answer that from the store data.");
  await expect(ask.getByText(/450/)).toHaveCount(0);
});

test("ask: questions outside the store are refused", async ({ page }) => {
  await mockModel(page, () => ({ in_scope: false, answer: "" }));
  await openTop(page);
  const ask = panel(page).getByRole("region", { name: "Ask about this" });
  await ask.getByLabel("Question about this item").fill("Write me a poem");
  await ask.getByLabel("Question about this item").press("Enter");
  await expect(ask.getByTestId("ask-answer")).toHaveText(/only help with this store/);
});

test("supplier draft in Ukrainian and English, copy and mailto", async ({ page }) => {
  const calls = await mockModel(page, (_k, body) => {
    const { language } = JSON.parse(body.messages[1].content);
    return language === "Ukrainian"
      ? { subject: "Замовлення: Ceramic mug Black", body: "Добрий день, KitchenLine! Просимо поставити 120 шт. Дякуємо.\nAvrora store, Vinnytsia" }
      : { subject: "Order: Ceramic mug Black", body: "Hello KitchenLine, please deliver 120 units. Thank you.\nAvrora store, Vinnytsia" };
  });
  await openTop(page);
  const sec = panel(page).getByRole("region", { name: "Draft message to supplier" });
  await expect(sec.getByRole("radio", { name: "Українська" })).toHaveAttribute("aria-checked", "true");
  await sec.getByRole("button", { name: "Write draft" }).click();
  await expect(sec.getByTestId("supplier-draft")).toContainText("Просимо поставити 120 шт.");
  expect((calls[0].user as { language: string }).language).toBe("Ukrainian");

  await sec.getByRole("radio", { name: "English" }).click();
  await sec.getByRole("button", { name: "Write draft" }).click();
  await expect(sec.getByTestId("supplier-draft")).toContainText("please deliver 120 units");

  await sec.getByRole("button", { name: "Copy" }).click();
  await expect(sec.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toContain("please deliver 120 units");
  const href = await sec.getByRole("link", { name: "Open in Mail" }).getAttribute("href");
  expect(href).toMatch(/^mailto:\?subject=/);

  // switching back keeps the Ukrainian draft
  await sec.getByRole("radio", { name: "Українська" }).click();
  await expect(sec.getByTestId("supplier-draft")).toContainText("KitchenLine");
  expect(calls).toHaveLength(2);
});

test("supplier draft with an invented number is not shown", async ({ page }) => {
  await mockModel(page, () => ({ subject: "Order", body: "Please deliver 999 units by Friday." }));
  await openTop(page);
  const sec = panel(page).getByRole("region", { name: "Draft message to supplier" });
  await sec.getByRole("button", { name: "Write draft" }).click();
  await expect(sec.getByRole("alert")).toContainText("not in the store data");
  await expect(sec.getByText(/999/)).toHaveCount(0);
});

test("without a key the sections ask for one; unreachable server shows the VPN hint", async ({ page }) => {
  await openTop(page, false);
  await expect(panel(page).getByText("Add your Open WebUI key to ask questions and draft messages.")).toHaveCount(2);

  await page.route(OTH, (route) => route.abort("failed"));
  await page.evaluate(() => localStorage.setItem("avrora.webuiKey", "sk-test-key"));
  await page.reload();
  await page.getByText(TOP).first().click();
  const ask = panel(page).getByRole("region", { name: "Ask about this" });
  await ask.getByRole("button", { name: "Why this quantity?" }).click();
  await expect(ask.getByText(/connect to the OTH VPN/)).toBeVisible();
});

test("screenshots of the AI sections", async ({ page }, info) => {
  await mockModel(page, (kind) =>
    kind === "ask"
      ? { in_scope: true, answer: "Sales are about 7.9 a day and delivery takes 6 days, so 120 units cover the wait." }
      : { subject: "Замовлення: Ceramic mug Black", body: "Добрий день, KitchenLine! Просимо поставити 120 шт. Дякуємо.\nAvrora store, Vinnytsia" });
  await openTop(page);
  const p = panel(page);
  await p.getByRole("button", { name: "Why this quantity?" }).click();
  await expect(p.getByTestId("ask-answer")).toBeVisible();
  await p.getByRole("button", { name: "Write draft" }).click();
  await expect(p.getByTestId("supplier-draft")).toBeVisible();
  await p.getByRole("region", { name: "Ask about this" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `e2e/tmpshots/genai-${info.project.name}.png` });
  await p.getByRole("region", { name: "Draft message to supplier" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `e2e/tmpshots/genai-${info.project.name}-draft.png` });
});
