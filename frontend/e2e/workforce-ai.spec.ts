import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
 * The workforce AI texts (src/lib/workforce-ai.ts) run in Node here with fetch mocked as the store AI
 * endpoint (/api/ai/chat), so every validator path is tested without a browser or a real model.
 * Data: the real plans and profiles from the Worker snapshot.
 */

const snap = JSON.parse(readFileSync(join(__dirname, "../../cloudflare/src/snapshot.json"), "utf8")).workforce;
const PLAN = snap.plans["2026-11-02"] as Plan;
const EMPLOYEES = snap.employees.employees as Employee[];
const row = EMPLOYEES.find((e) => e.employee_id === "E05")!;
const PROFILE = { ...row, ...snap.profiles.E05 } as Profile;
const KEY = { key: "server" };

/** Answers the next store AI calls with these JSON bodies; records the requests. */
function mockAi(...answers: (object | number)[]) {
  const calls: { url: string; body: { schema: object; messages: unknown[] } }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    const a = answers.shift();
    if (typeof a === "number") return new Response("", { status: a });
    return Response.json({ content: JSON.stringify(a), model: "test-model" });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

let restore = () => {};
test.afterEach(() => restore());

test.describe("workforce AI texts", () => {
  // pure Node test: run it once, not per device
  test.beforeEach(({ browserName }, info) => test.skip(info.project.name !== "desktop" || browserName !== "chromium", "runs once"));

  test("no key: fixed rules, no request", async () => {
    const m = mockAi();
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

  test("explainPlan: grounded answer is used, sent to the store AI with its schema", async () => {
    const good = {
      sentences: [
        "The plan covers 90.4% of the hours the store needs.",
        "The busiest hour is 10:00, when 6 people are needed and 5 are planned.",
        "Olena K. opens and leads the morning.",
      ],
      watch_out: ["Short 1 person 17:00-20:00"],
    };
    const m = mockAi(good);
    restore = m.restore;
    const r = await explainPlan(PLAN, KEY);
    expect(r.source).toBe("model");
    expect(r.sentences).toEqual(good.sentences);
    expect(m.calls[0].url).toBe("/api/ai/chat");
    expect(m.calls[0].body.schema).toMatchObject({ required: ["sentences", "watch_out"] });
  });

  test("explainPlan: invented number, invented person, too few sentences all fall back", async () => {
    for (const bad of [
      { sentences: ["Coverage is 412.6%.", "Fine.", "Good."], watch_out: [] },
      { sentences: ["Mykola Z. opens the store.", "Fine.", "Good."], watch_out: [] },
      { sentences: ["Only one sentence."], watch_out: [] },
    ]) {
      const m = mockAi(bad);
      restore = m.restore;
      const r = await explainPlan(PLAN, KEY);
      expect(r.source).toBe("rules");
      expect(r.error).toContain("checks");
      m.restore();
    }
  });

  test("model refuses the call: rules with a plain error message", async () => {
    const m = mockAi(401);
    restore = m.restore;
    const r = await explainPlan(PLAN, KEY);
    expect(r.source).toBe("rules");
    expect(r.error).toMatch(/problem/);
    expect(r.error).not.toMatch(/key/);
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
    let m = mockAi(good);
    restore = m.restore;
    const ok = await explainReplan(PLAN, after, diff, KEY);
    expect(ok.source).toBe("model");
    expect(ok.messages.map((x) => x.employee_id)).toEqual(["E03", "E04"]);
    m.restore();

    const wrongTime = { ...good, messages: [good.messages[0], { employee_id: "E03", text: "Hi Andriy, could you come in 14:00-21:00? Please confirm." }] };
    const missing = { ...good, messages: [good.messages[0]] };
    for (const bad of [wrongTime, missing]) {
      m = mockAi(bad);
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
    let m = mockAi({ answer: "CANNOT_ANSWER", employee_ids: [] });
    restore = m.restore;
    expect(await askTeam("Tell me a joke", PLAN, EMPLOYEES, KEY)).toMatchObject({ refused: true, source: "model" });
    m.restore();

    const name = EMPLOYEES.find((e) => e.status_today === "available")!;
    m = mockAi({ answer: `${name.name} is available today and has the checkout skill.`, employee_ids: [name.employee_id, "E99"] });
    restore = m.restore;
    const ok = await askTeam("Who should cover checkout at 18:00?", PLAN, EMPLOYEES, KEY);
    expect(ok).toMatchObject({ source: "model", refused: false, employeeIds: [name.employee_id] });
    m.restore();

    m = mockAi({ answer: "Mykola Z. should cover checkout at 18:00.", employee_ids: [] });
    restore = m.restore;
    expect((await askTeam("Who should cover checkout at 18:00?", PLAN, EMPLOYEES, KEY)).source).toBe("rules");
  });

  test("explainPlan: real model wording with plan figures, absent staff and one-item paragraphs is used", async () => {
    const good = {
      sentences: [
        "The plan for 2026-11-02 schedules 46.5 labour hours with a coverage percentage of 90.4 and 0 rule violations.",
        "Olena K. and Serhiy T. handle 10 supplier deliveries due (91 cases) from 08:00 to 11:00; labour cost is 4,202 UAH.",
        "The evening from 5 pm to 21:00 is run by the late shift.",
      ],
      watch_out: ["Gap 17:00–20:00 missing 1 because Oksana V. is sick and Kateryna Z. is on vacation."],
    };
    let m = mockAi(good);
    restore = m.restore;
    let r = await explainPlan(PLAN, KEY);
    expect(r).toMatchObject({ source: "model", sentences: good.sentences });
    expect(r.error).toBeUndefined();
    m.restore();

    // whole paragraph in one array item: split into sentences, still checked
    m = mockAi({ sentences: [good.sentences.join(" ")], watch_out: [] });
    restore = m.restore;
    r = await explainPlan(PLAN, KEY);
    expect(r).toMatchObject({ source: "model", sentences: good.sentences });
    m.restore();

    for (const bad of [
      { ...good, sentences: [...good.sentences.slice(0, 2), "Coverage rises to 97.5% after 12 supplier deliveries."] },
      { ...good, watch_out: ["Gap 17:00–20:00 missing 23 staff."] },
      { ...good, sentences: [...good.sentences.slice(0, 2), "The coverage_pct is 90.4."] },
    ]) {
      m = mockAi(bad);
      restore = m.restore;
      expect((await explainPlan(PLAN, KEY)).source).toBe("rules");
      m.restore();
    }
  });

  test("askTeam: every suggested question gets the data it needs and is not refused by the prompt", async () => {
    for (const q of ["Who can cover the evening?", "Who is fastest on the till?", "Why are we short at 18:00?"]) {
      const m = mockAi({ answer: "Taras M. is on a day off and could cover 17:00-20:00.", employee_ids: ["E02"] });
      restore = m.restore;
      const r = await askTeam(q, PLAN, EMPLOYEES, KEY);
      expect(r).toMatchObject({ source: "model", refused: false, employeeIds: ["E02"] });
      const body = m.calls[0].body as unknown as { messages: { content: string }[] };
      expect(body.messages[0].content).toContain('only when the question is not about');
      const sent = JSON.parse(body.messages[1].content);
      expect(sent.question).toBe(q);
      expect(sent.day_parts.evening).toEqual({ from: "17:00", to: "21:00" });
      expect(sent.plan.gaps.length).toBeGreaterThan(0);
      for (const e of sent.team) {
        expect(e).toHaveProperty("status_today");
        expect(e).toHaveProperty("shift_today");
        expect(e).toHaveProperty("hours_left_this_week");
        expect(e).toHaveProperty("skills");
        expect(e).toHaveProperty("strength");
      }
      const onPlan = PLAN.shifts[0];
      expect(sent.team.find((e: { employee_id: string }) => e.employee_id === onPlan.employee_id).shift_today).toMatchObject({ start: onPlan.start, end: onPlan.end });
      expect(sent.team.some((e: { status_today: string; shift_today: unknown }) => e.status_today === "day_off" && e.shift_today === null)).toBe(true);
      m.restore();
    }
    // a number the data doesn't hold is still rejected
    const m = mockAi({ answer: "Taras M. has 412.6 hours left and could cover the evening.", employee_ids: ["E02"] });
    restore = m.restore;
    expect((await askTeam("Who can cover the evening?", PLAN, EMPLOYEES, KEY)).source).toBe("rules");
  });

  test("coachingNote: strengths first, never health or absence", async () => {
    const rules = await coachingNote(PROFILE);
    expect(rules.strengths.length).toBeGreaterThan(0);
    expect(rules.note.startsWith(`${PROFILE.name.split(" ")[0]}'s clearest strength`)).toBe(true);
    expect([...rules.focus, rules.note].join(" ")).not.toMatch(/sick|absen/i);

    let m = mockAi({ strengths: ["Fast restock"], focus: ["Practise scanning accuracy"], note: "Strong restocking pace; keep building scan accuracy." });
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
      m = mockAi(bad);
      restore = m.restore;
      expect((await coachingNote(PROFILE, KEY)).source).toBe("rules");
      m.restore();
    }
  });
});
