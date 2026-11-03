import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HOST } from "../src/lib/ollama";
import {
  askTeam,
  coachingNote,
  explainPlan,
  explainReplan,
  namesKnown,
  SOURCE_LABEL,
  TEAM_FALLBACK,
} from "../src/lib/workforce-ai";
import type { Employee, Plan, Profile } from "../src/lib/workforce";

/*
 * The workforce AI texts (src/lib/workforce-ai.ts) run in Node here with fetch mocked as the OTH
 * Ollama endpoint, so every validator path is tested without a browser or the university network.
 * Data: the real plans and profiles from the Worker snapshot.
 */

const snap = JSON.parse(readFileSync(join(__dirname, "../../cloudflare/src/snapshot.json"), "utf8")).workforce;
const PLAN = snap.plans["2026-11-02"] as Plan;
const EMPLOYEES = snap.employees.employees as Employee[];
const row = EMPLOYEES.find((e) => e.employee_id === "E05")!;
const PROFILE = { ...row, ...snap.profiles.E05 } as Profile;
const KEY = { key: "test-key" };

/** Answers the next Ollama calls with these JSON bodies; records the requests. */
function mockOllama(...answers: (object | number)[]) {
  const calls: { url: string; body: { format: object; options: { temperature: number } } }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    const a = answers.shift();
    if (typeof a === "number") return new Response("", { status: a });
    return Response.json({ message: { content: JSON.stringify(a) } });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

let restore = () => {};
test.afterEach(() => restore());

test.describe("workforce AI texts", () => {
  // pure Node test: run it once, not per device
  test.beforeEach(({ browserName }, info) => test.skip(info.project.name !== "desktop" || browserName !== "chromium", "runs once"));

  test("no key: fixed rules, no request", async () => {
    const m = mockOllama();
    restore = m.restore;
    const r = await explainPlan(PLAN);
    expect(m.calls).toHaveLength(0);
    expect(r.source).toBe("rules");
    expect(r.sentences).toEqual(PLAN.explain.slice(0, 5));
    expect(r.watchOut).toContain("Short 1 person 17:00-20:00");
    expect(SOURCE_LABEL.en[r.source]).toBe("Fixed rules");
    const uk = await explainPlan(PLAN, { lang: "uk" });
    expect(uk.sentences.length).toBeGreaterThanOrEqual(3);
    expect(uk.watchOut[0]).toBe("Бракує 1 ос. 09:00-11:00");
  });

  test("explainPlan: grounded answer is used, temperature 0 and schema sent", async () => {
    const good = {
      sentences: [
        "The plan covers 90.4% of the hours the store needs.",
        "The busiest hour is 10:00, when 6 people are needed and 5 are planned.",
        "Olena K. opens and leads the morning.",
      ],
      watch_out: ["Short 1 person 17:00-20:00"],
    };
    const m = mockOllama(good);
    restore = m.restore;
    const r = await explainPlan(PLAN, KEY);
    expect(r.source).toBe("model");
    expect(r.sentences).toEqual(good.sentences);
    expect(m.calls[0].url).toBe(`${HOST}/api/chat`);
    expect(m.calls[0].body.options.temperature).toBe(0);
    expect(m.calls[0].body.format).toMatchObject({ required: ["sentences", "watch_out"] });
  });

  test("explainPlan: invented number, invented person, too few sentences all fall back", async () => {
    for (const bad of [
      { sentences: ["Coverage is 412.6%.", "Fine.", "Good."], watch_out: [] },
      { sentences: ["Mykola Z. opens the store.", "Fine.", "Good."], watch_out: [] },
      { sentences: ["Only one sentence."], watch_out: [] },
    ]) {
      const m = mockOllama(bad);
      restore = m.restore;
      const r = await explainPlan(PLAN, KEY);
      expect(r.source).toBe("rules");
      expect(r.error).toContain("checks");
      m.restore();
    }
  });

  test("model unreachable or key refused: rules with the error message", async () => {
    const m = mockOllama(401);
    restore = m.restore;
    const r = await explainPlan(PLAN, KEY);
    expect(r.source).toBe("rules");
    expect(r.error).toMatch(/key/);
  });

  test("explainReplan: one ready-to-send message per changed person, times must match", async () => {
    const after = { ...PLAN, ...snap.replans["2026-11-02"]["sick-E02"] } as Plan;
    after.kpis = { ...PLAN.kpis, ...after.kpis };
    after.gaps = after.gaps ?? PLAN.gaps;
    const diff = [
      { employee_id: "E03", name: "Andriy P.", before: "off", after: "13:00-21:00", why: "Covers for a sick colleague" },
      { employee_id: "E04", name: "Iryna S.", before: "08:00-14:00", after: "08:00-16:00", why: "Extended to cover checkout" },
    ];
    const rules = await explainReplan(PLAN, after, diff);
    expect(rules.source).toBe("rules");
    expect(rules.messages.map((x) => x.employee_id)).toEqual(["E03", "E04"]);
    expect(rules.messages[0].text).toContain("13:00-21:00");
    expect(rules.messages[0].text).toMatch(/^Hi Andriy, could you work 13:00-21:00 on Mon 2 Nov\?/);

    const good = {
      summary: "Two people change shifts to cover a sick colleague.",
      messages: [
        { employee_id: "E04", text: "Hi Iryna, on Monday 2 Nov your shift runs 08:00 to 16:00. Please confirm." },
        { employee_id: "E03", text: "Hi Andriy, could you come in 13:00-21:00 on Mon 2 Nov? Please confirm." },
      ],
    };
    let m = mockOllama(good);
    restore = m.restore;
    const ok = await explainReplan(PLAN, after, diff, KEY);
    expect(ok.source).toBe("model");
    expect(ok.messages.map((x) => x.employee_id)).toEqual(["E03", "E04"]);
    m.restore();

    const wrongTime = { ...good, messages: [good.messages[0], { employee_id: "E03", text: "Hi Andriy, could you come in 14:00-21:00? Please confirm." }] };
    const missing = { ...good, messages: [good.messages[0]] };
    for (const bad of [wrongTime, missing]) {
      m = mockOllama(bad);
      restore = m.restore;
      expect((await explainReplan(PLAN, after, diff, KEY)).source).toBe("rules");
      m.restore();
    }
  });

  test("askTeam: rules answer the brief's questions and refuse the rest", async () => {
    const cover = await askTeam("Who should cover checkout at 18:00?", PLAN, EMPLOYEES);
    expect(cover.refused).toBe(false);
    expect(cover.answer).toMatch(/^At 18:00 the plan needs \d+ and has \d+:/);
    expect(namesKnown(cover.answer, EMPLOYEES.map((e) => e.name))).toBe(true);
    const lead = PLAN.shifts[0];
    const why = await askTeam(`Why is ${lead.name.split(" ")[0]} on ${lead.tasks[0].task}?`, PLAN, EMPLOYEES);
    expect(why.employeeIds).toEqual([lead.employee_id]);
    expect(why.answer).toContain(lead.tasks[0].reason);
    const off = await askTeam("What's the weather in Lviv?", PLAN, EMPLOYEES);
    expect(off).toMatchObject({ refused: true, answer: TEAM_FALLBACK.en });
  });

  test("askTeam: model refusal, grounded answer, invented person", async () => {
    let m = mockOllama({ answer: "CANNOT_ANSWER", employee_ids: [] });
    restore = m.restore;
    expect(await askTeam("Tell me a joke", PLAN, EMPLOYEES, KEY)).toMatchObject({ refused: true, source: "model" });
    m.restore();

    const name = EMPLOYEES.find((e) => e.status_today === "available")!;
    m = mockOllama({ answer: `${name.name} is available today and has the checkout skill.`, employee_ids: [name.employee_id, "E99"] });
    restore = m.restore;
    const ok = await askTeam("Who should cover checkout at 18:00?", PLAN, EMPLOYEES, KEY);
    expect(ok).toMatchObject({ source: "model", refused: false, employeeIds: [name.employee_id] });
    m.restore();

    m = mockOllama({ answer: "Mykola Z. should cover checkout at 18:00.", employee_ids: [] });
    restore = m.restore;
    expect((await askTeam("Who should cover checkout at 18:00?", PLAN, EMPLOYEES, KEY)).source).toBe("rules");
  });

  test("coachingNote: strengths first, never health or absence", async () => {
    const rules = await coachingNote(PROFILE);
    expect(rules.strengths.length).toBeGreaterThan(0);
    expect(rules.note.startsWith(`${PROFILE.name.split(" ")[0]}'s clearest strength`)).toBe(true);
    expect([...rules.focus, rules.note].join(" ")).not.toMatch(/sick|absen/i);

    let m = mockOllama({ strengths: ["Fast restock"], focus: ["Practise scanning accuracy"], note: "Strong restocking pace; keep building scan accuracy." });
    restore = m.restore;
    expect((await coachingNote(PROFILE, KEY)).source).toBe("model");
    const sent = JSON.stringify((m.calls[0].body as unknown as { messages: { content: string }[] }).messages[1].content);
    expect(sent).not.toMatch(/absences|sick days/);
    m.restore();

    for (const bad of [
      { strengths: ["Fast restock"], focus: ["Fewer sick days"], note: "Good work." },
      { strengths: ["Fast restock"], focus: [], note: "Lazy at the till." },
      { strengths: [], focus: ["Scan accuracy"], note: "Needs work." },
    ]) {
      m = mockOllama(bad);
      restore = m.restore;
      expect((await coachingNote(PROFILE, KEY)).source).toBe("rules");
      m.restore();
    }
  });
});
