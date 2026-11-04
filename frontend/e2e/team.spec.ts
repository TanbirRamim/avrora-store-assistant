import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// live pass-through routes can still be in flight when a test ends
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

/*
 * Team (workforce agent). GET calls go to the real API when it serves /api/workforce, otherwise
 * to the contract fixtures in e2e/fixtures. Approve, reject and replan are always answered here so
 * the tests never change the store's saved plan.
 */

const API = process.env.BASE_URL ?? "http://127.0.0.1:8000";
const FIX = join(__dirname, "fixtures");
const fx = (name: string) => JSON.parse(readFileSync(join(FIX, name), "utf8"));

type Plan = {
  date: string;
  status: string;
  version: string | number;
  kpis: { coverage_pct: number; labour_hours: number; labour_cost_uah: number };
  gaps: unknown[];
  shifts: { employee_id: string; name: string }[];
  blocks: unknown[];
  changes: unknown[];
  diff?: { name: string }[];
};

let live: boolean | null = null;
async function isLive() {
  if (live === null) live = await fetch(`${API}/api/workforce/plan`).then((r) => r.ok, () => false);
  return live;
}

async function mockWorkforce(page: Page, opts: { draft?: boolean } = {}) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const useLive = await isLive();
  await page.route("**/api/workforce/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "{}");
      calls.push({ path, body });
      if (path.endsWith("/replan")) {
        const plan = fx("workforce-replan-sick.json");
        return route.fulfill({ json: { ...plan, date: body.date } });
      }
      if (path.endsWith("/approve")) return route.fulfill({ json: { status: "approved", at: "2026-11-02T09:20:00+02:00" } });
      if (path.endsWith("/reject")) return route.fulfill({ json: { status: "rejected", at: "2026-11-02T09:21:00+02:00" } });
    }
    if (useLive) {
      const res = await route.fetch();
      if (path.endsWith("/plan") && opts.draft) {
        const json = await res.json();
        return route.fulfill({ json: { ...json, status: "draft" } });
      }
      return route.fulfill({ response: res });
    }
    if (path.endsWith("/plan")) {
      const date = url.searchParams.get("date") ?? "2026-11-02";
      return route.fulfill({ json: { ...fx("workforce-plan.json"), date } });
    }
    if (path.endsWith("/employees")) return route.fulfill({ json: fx("workforce-employees.json") });
    const id = decodeURIComponent(path.split("/").pop()!);
    const profiles = fx("workforce-profiles.json");
    return profiles[id] ? route.fulfill({ json: profiles[id] }) : route.fulfill({ status: 404, json: { detail: "Not found" } });
  });
  return calls;
}

async function expected(): Promise<Plan> {
  if (await isLive()) return (await fetch(`${API}/api/workforce/plan`)).json();
  return fx("workforce-plan.json");
}

const tabBar = (page: Page) => page.getByRole("navigation", { name: "Sections" });
const money = (v: number) => `₴${new Intl.NumberFormat("en-US").format(Math.round(v))}`;

async function openTeam(page: Page) {
  await page.goto("/");
  await tabBar(page).getByRole("button", { name: "Team", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();
  await expect(page.getByTestId("plan-hero")).toBeVisible();
}

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("Today shows a staffing card that opens Team", async ({ page }) => {
  await mockWorkforce(page);
  const plan = await expected();
  await page.goto("/");
  const card = page.getByTestId("staffing-today");
  await expect(card).toContainText(`${plan.kpis.coverage_pct}% covered`);
  await card.click();
  await expect(page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();
  await expect(tabBar(page).getByRole("button", { name: "Team", exact: true })).toHaveAttribute("aria-current", "page");
});

test("plan renders and matches the API numbers", async ({ page }, info) => {
  const errors = watchConsole(page);
  await mockWorkforce(page);
  const plan = await expected();
  await openTeam(page);
  await expect(page.getByTestId("kpi-coverage")).toHaveText(`${plan.kpis.coverage_pct}%`);
  await expect(page.getByTestId("kpi-hours")).toHaveText(`${plan.kpis.labour_hours}`);
  await expect(page.getByTestId("kpi-cost")).toHaveText(money(plan.kpis.labour_cost_uah));
  await expect(page.getByTestId("kpi-gaps")).toHaveText(`${plan.gaps.length}`);
  await expect(page.getByTestId("plan-status")).toHaveText(plan.status === "approved" ? "Approved" : "Draft");
  await expect(page.getByTestId("tag-sentence")).toHaveText(plan.gaps.length ? / short \d/ : /enough people/);
  await page.screenshot({ path: `e2e/screens/${info.project.name}-team-top.png` });
  await page.getByTestId("rota-board").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `e2e/screens/${info.project.name}-team-board.png` });
  await expect(page.getByTestId("blocks").getByRole("listitem")).toHaveCount(plan.blocks.length);
  for (const s of plan.shifts) await expect(page.getByRole("button", { name: new RegExp(`^${s.name.replace(".", "\\.")}, `) })).toBeVisible();
  // chart: tap an hour for its numbers
  await page.getByRole("button", { name: /^18:00: need/ }).click();
  await expect(page.getByTestId("chart-readout")).toContainText("18:00–19:00");
  await expect(page.getByText("Demo data").first()).toBeAttached();
  // task allocation: tap a block for the reason, then the station view
  const first = plan.shifts[0] as unknown as { name: string; tasks: { from: string; reason: string }[] };
  const row = page.getByTestId("roster").locator("li", { has: page.getByRole("button", { name: new RegExp(`^${first.name.replace(".", "\\.")}, `) }) });
  if (page.viewportSize()!.width < 768) {
    // phones: shift cards; the slim day bar opens that person's tasks
    await row.getByRole("button", { name: `Tasks for ${first.name}` }).click();
  } else {
    await row.getByRole("button", { name: new RegExp(`^[A-Za-z &/]+ ${first.tasks[0].from} to [\\d:]+$`) }).click();
  }
  await expect(page.getByTestId("task-reason")).toContainText(first.tasks[0].reason);
  await page.waitForTimeout(300);
  await page.getByTestId("task-reason").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `e2e/screens/${info.project.name}-team-roster.png` });
  await page.getByRole("tab", { name: /^By (station|task)$/ }).click();
  await expect(page.getByTestId("stations").getByTestId("station-row").first()).toBeVisible();
  await page.getByTestId("stations").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `e2e/screens/${info.project.name}-team-stations.png` });
  await page.getByRole("tab", { name: "By person" }).click();
  await page.locator("main").evaluate((m) => m.scrollTo({ top: 0 }));
  // date switcher
  await page.getByRole("button", { name: /^Tuesday 3 November/ }).click();
  await expect(page.getByText("Tuesday 3 November").first()).toBeVisible();
  await page.screenshot({ path: `e2e/screens/${info.project.name}-team.png` });
  await page.locator("main").evaluate((m) => m.scrollTo({ top: m.scrollHeight }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `e2e/screens/${info.project.name}-team-end.png` });
  expect(errors).toEqual([]);
});

test("approve the plan", async ({ page }, info) => {
  const calls = await mockWorkforce(page, { draft: true });
  const plan = await expected();
  await openTeam(page);
  await page.getByRole("button", { name: "Approve plan" }).click();
  await expect(page.getByTestId("plan-status")).toHaveText("Approved");
  await expect(page.getByTestId("plan-actions")).toContainText("Plan approved");
  // after approval the only action left is Replan, in the header
  await expect(page.getByRole("button", { name: "Replan", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve plan" })).toHaveCount(0);
  await expect(page.getByTestId("audit")).toContainText("Approved: ");
  expect(calls).toEqual([{ path: "/api/workforce/plan/approve", body: { date: plan.date, version: plan.version } }]);
  await page.waitForTimeout(3800);
  await page.locator("main").evaluate((m) => m.scrollTo({ top: 0 }));
  await page.screenshot({ path: `e2e/screens/${info.project.name}-team-approved.png` });
});

test("reject the plan with a reason", async ({ page }, info) => {
  const calls = await mockWorkforce(page, { draft: true });
  await openTeam(page);
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Reject plan" });
  await expect(sheet.getByRole("button", { name: "Reject plan" })).toBeDisabled();
  await sheet.getByRole("button", { name: "Cost too high" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `e2e/screens/${info.project.name}-team-reject.png` });
  await sheet.getByRole("button", { name: "Reject plan" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("plan-status")).toHaveText("Rejected");
  await expect(page.getByTestId("audit")).toContainText("Rejected: Cost too high");
  expect(calls[0].path).toBe("/api/workforce/plan/reject");
  expect(calls[0].body.reason).toBe("Cost too high");
});

test("replan for a sick call shows a diff and applies only on approve", async ({ page }, info) => {
  const calls = await mockWorkforce(page, { draft: true });
  const plan = await expected();
  const proposal = fx("workforce-replan-sick.json") as Plan;
  await openTeam(page);
  await page.getByRole("button", { name: "Replan", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Something changed" });
  await sheet.getByText("Someone's off sick").click();
  const who = plan.shifts[0];
  await sheet.getByLabel("Who called in sick?").selectOption(who.employee_id);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `e2e/screens/${info.project.name}-team-replan.png` });
  await sheet.getByRole("button", { name: "Show new plan" }).click();
  const diff = page.getByRole("dialog", { name: "Proposed plan" });
  await expect(diff.getByTestId("replan-proposal")).toBeVisible();
  for (const d of proposal.diff!) await expect(diff.getByText(d.name, { exact: true })).toBeVisible();
  expect(calls[0].body).toEqual({ date: plan.date, event: { kind: "sick", employee_id: who.employee_id } });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `e2e/screens/${info.project.name}-team-diff.png` });
  // nothing applied yet
  expect(calls.some((c) => c.path.endsWith("/approve"))).toBe(false);
  await diff.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(diff).toBeHidden();
  expect(calls[1]).toEqual({ path: "/api/workforce/plan/approve", body: { date: proposal.date, version: proposal.version } });
  await expect(page.getByTestId("plan-status")).toHaveText("Approved");
  await expect(page.getByTestId("kpi-hours")).toHaveText(`${proposal.kpis.labour_hours}`);
});

test("keep current leaves the plan unchanged", async ({ page }) => {
  const calls = await mockWorkforce(page, { draft: true });
  await openTeam(page);
  await page.getByRole("button", { name: "Replan", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Something changed" });
  await sheet.getByText("Power cut").click();
  await sheet.getByRole("button", { name: "Show new plan" }).click();
  await page.getByRole("button", { name: "Keep current" }).click();
  await expect(page.getByTestId("plan-status")).toHaveText("Draft");
  expect(calls.filter((c) => c.path.endsWith("/approve"))).toEqual([]);
  expect(calls[0].body.event).toEqual({ kind: "power", from: "12:00" });
  await expect(page.getByTestId("plan-status")).toBeVisible();
});

test("a gap's Fix with replan opens Replan prefilled for that window", async ({ page }, info) => {
  const calls = await mockWorkforce(page, { draft: true });
  const plan = (await expected()) as unknown as { gaps: { from: string; to: string }[] };
  test.skip(!plan.gaps.length, "no gaps in today's plan");
  await openTeam(page);
  const gaps = page.getByTestId("gap-list").getByTestId("gap");
  await expect(gaps).toHaveCount(plan.gaps.length);
  const last = gaps.last();
  await expect(last).toContainText(`${plan.gaps.at(-1)!.from}–${plan.gaps.at(-1)!.to}`);
  await last.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `e2e/screens/${info.project.name}-team-gaps.png` });
  await last.getByRole("button", { name: "Fix with replan" }).click();
  const sheet = page.getByRole("dialog", { name: "Something changed" });
  const from = `${plan.gaps.at(-1)!.from.slice(0, 2)}:00`;
  await expect(sheet.getByRole("radio", { name: /Busier than expected/ })).toBeChecked();
  await expect(sheet.getByLabel("Starts at")).toHaveValue(from);
  await sheet.getByRole("button", { name: "Show new plan" }).click();
  await expect(page.getByTestId("replan-proposal")).toBeVisible();
  expect(calls[0].body.event).toEqual({ kind: "traffic_spike", from });
});

test("profile sheet and the people list", async ({ page }, info) => {
  await mockWorkforce(page);
  const plan = await expected();
  await openTeam(page);
  const s = plan.shifts[0];
  await page.getByRole("button", { name: new RegExp(`^${s.name.replace(".", "\\.")}, `) }).click();
  const sheet = page.getByRole("dialog", { name: s.name });
  await expect(sheet.getByText("Last 12 weeks")).toBeVisible();
  for (const m of ["Scan speed", "Receiving speed", "Scan errors", "On time", "Rating"]) await expect(sheet.getByText(m, { exact: true })).toBeVisible();
  await expect(sheet.getByText("Next 7 days")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `e2e/screens/${info.project.name}-team-profile.png` });
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();

  await page.getByRole("tab", { name: "People" }).click();
  const list = page.getByTestId("people-list");
  await expect(list.getByRole("listitem").first()).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `e2e/screens/${info.project.name}-team-people.png` });
  await list.getByRole("button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("no accessibility violations on Team, the sheets and the people list", async ({ page }) => {
  await mockWorkforce(page, { draft: true });
  await openTeam(page);
  const scan = async (label: string) => {
    await page.waitForTimeout(900);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
  };
  await scan("team");
  await page.getByRole("button", { name: "Replan", exact: true }).click();
  await page.getByText("Someone's off sick").click();
  await scan("replan");
  await page.getByRole("button", { name: "Show new plan" }).click();
  await expect(page.getByTestId("replan-proposal")).toBeVisible();
  await scan("diff");
  await page.getByRole("button", { name: "Keep current" }).click();
  await page.getByTestId("plan-actions").getByRole("button", { name: "Reject", exact: true }).click();
  await scan("reject");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "People" }).click();
  await scan("people");
  await page.getByTestId("people-list").getByRole("button").first().click();
  await expect(page.getByText("Last 12 weeks")).toBeVisible();
  await scan("profile");
});

test("nothing hides behind the tab bar or the decision bar, no sideways scroll", async ({ page }) => {
  await mockWorkforce(page, { draft: true });
  await openTeam(page);
  const vp = page.viewportSize()!;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const main = page.locator("main");
  expect(await main.evaluate((m) => m.scrollWidth - m.clientWidth)).toBeLessThanOrEqual(0);
  await page.waitForTimeout(600); // chart measures itself and settles the height
  await main.evaluate((m) => m.scrollTo({ top: m.scrollHeight }));
  await page.waitForTimeout(300);
  await main.evaluate((m) => m.scrollTo({ top: m.scrollHeight }));
  await page.waitForTimeout(400);
  const bar = page.getByTestId("plan-actions-bar");
  await expect(bar).toBeVisible();
  const dock = (await tabBar(page).locator("ul").boundingBox())!;
  const actions = (await bar.boundingBox())!;
  expect(actions.y + actions.height).toBeLessThanOrEqual(dock.y);
  const last = page.getByText(/^Demo data: staff/);
  await expect(last).toBeInViewport();
  const box = (await last.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(actions.y);
  // primary action within thumb reach: bottom third of the screen
  const approve = (await bar.getByRole("button", { name: "Approve plan" }).boundingBox())!;
  expect(approve.height).toBeGreaterThanOrEqual(44);
  expect(approve.y).toBeGreaterThan(vp.height * 0.6);
  // every control in the roster and switcher is at least 44pt
  for (const b of await page.getByRole("group", { name: "Day" }).getByRole("button").all()) {
    const r = (await b.boundingBox())!;
    expect(r.height).toBeGreaterThanOrEqual(44);
  }
  // nothing wider than the screen (chip rows scroll on their own)
  const wide = await page.evaluate(() =>
    [...document.querySelectorAll("main *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.parentElement?.closest(".overflow-x-auto")).map((el) => el.className.toString().slice(0, 60)),
  );
  expect(wide).toEqual([]);
  // bottom chrome (tab bar + action bar) stays within a fifth of the screen
  expect(vp.height - actions.y).toBeLessThanOrEqual(vp.height * 0.2);
  await page.screenshot({ path: `e2e/screens/${test.info().project.name}-team-bar.png` });
  // back at the top the bar steps aside: Approve lives in the summary card
  await main.evaluate((m) => m.scrollTo({ top: 0 }));
  await expect(bar).toBeHidden();
  await expect(page.getByTestId("plan-actions").getByRole("button", { name: "Approve plan" })).toBeVisible();
  // inputs at 16px so iOS doesn't zoom
  await page.getByTestId("plan-actions").getByRole("button", { name: "Reject", exact: true }).click();
  expect(await page.locator("#reject-reason").evaluate((e) => getComputedStyle(e).fontSize)).toBe("16px");
});

const AI = "**/api/ai/chat";
/** The store server reports its AI as set up (or not). */
const storeAi = (page: Page, on = true) =>
  page.route("**/api/ai/status", (r) => r.fulfill({ json: on ? { configured: true, model: "test-model" } : { configured: false, model: null } }));


/** Answers the store AI by prompt: plan explanation, replan messages, team question, coaching. */
async function mockModel(page: Page) {
  const asked: string[] = [];
  await page.route(AI, async (route) => {
    const body = JSON.parse(route.request().postData()!);
    const system: string = body.messages[0].content;
    const user = JSON.parse(body.messages[1].content);
    let answer: object;
    if (/question about today's staffing/i.test(system)) {
      asked.push("ask");
      answer = { answer: "Model answer: the evening team can cover it.", employee_ids: [] };
    } else if (/tell staff about a changed shift/i.test(system)) {
      asked.push("replan");
      const ids: string[] = JSON.stringify(user).match(/E\d\d/g) ?? [];
      answer = { summary: "Model summary: cover is arranged.", messages: [...new Set(ids)].map((id) => ({ employee_id: id, text: "Model message: please confirm your shift." })) };
    } else if (/development note/i.test(system)) {
      asked.push("coach");
      answer = { strengths: ["Model strength: calm at the till"], focus: ["Model focus: double-check scans"], note: "Model note: keep it up." };
    } else {
      asked.push("explain");
      answer = { sentences: ["Model sentence one about the plan.", "Model sentence two about the peak.", "Model sentence three about cover."], watch_out: [] };
    }
    await route.fulfill({ json: { content: JSON.stringify(answer) } });
  });
  await storeAi(page);
  return asked;
}

test("AI texts: plan explanation, ask, replan messages and coaching, labelled", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await mockWorkforce(page, { draft: true });
  await mockModel(page);
  await openTeam(page);
  const why = page.getByTestId("why");
  await expect(why).toContainText("Model sentence one about the plan.");
  await expect(page.locator("section", { has: page.locator("#why-h") }).getByText("Written by AI")).toBeVisible();

  await page.getByLabel("Question about the team").fill("Who can cover the evening?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByTestId("ask-answer")).toContainText("Model answer: the evening team can cover it.");

  await page.getByRole("button", { name: "Replan", exact: true }).click();
  await page.getByText("Someone's off sick").click();
  await page.getByRole("button", { name: "Show new plan" }).click();
  await expect(page.getByTestId("replan-summary")).toContainText(/summary|cover/i);
  const copy = page.getByRole("button", { name: /^Copy message to / }).first();
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(page.getByRole("button", { name: /^Copy message to / }).first()).toHaveText(/Copied|Copy message/);
  await page.getByRole("button", { name: "Keep current" }).click();

  await page.getByRole("tab", { name: "People" }).click();
  await page.getByTestId("people-list").getByRole("button").first().click();
  await expect(page.getByTestId("coaching")).toBeVisible();
  await expect(page.getByTestId("coaching").getByText(/Written by AI|Fixed rules/)).toBeVisible();
});

test("without a key the fixed rules write the texts", async ({ page }) => {
  // pin "store AI off" whatever the server running the tests has configured
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { configured: false, model: null } }));
  await page.route("**/api/ai/chat", (route) => route.fulfill({ status: 503, json: { detail: "AI is not set up" } }));
  await mockWorkforce(page);
  const plan = await expected();
  await openTeam(page);
  await expect(page.locator("section", { has: page.locator("#why-h") }).getByText("Fixed rules")).toBeVisible();
  await expect(page.getByTestId("why")).toContainText((plan as unknown as { explain: string[] }).explain[0]);
  await expect(page.getByTestId("kpi-card")).toBeVisible();
});

test("push link opens Team on that date", async ({ page }) => {
  await mockWorkforce(page);
  await page.goto("/?view=team&date=2026-11-04");
  await expect(page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Wednesday 4 November/ })).toHaveAttribute("aria-pressed", "true");
});
