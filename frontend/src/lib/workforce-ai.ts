/**
 * Workforce agent texts written by the OTH model in the browser, with fixed-rule fallbacks.
 *
 * Integration note (Team UI):
 * - Every function is a plain async function: `await explainPlan(plan, { key: savedKey(), lang })`.
 *   `key` comes from `savedKey()` in ./ai; with an empty key the fixed rules answer at once, offline.
 *   They never throw: a model failure (off the OTH network, bad key, ungrounded answer) returns the
 *   rules result with `error` set to a message you may show quietly.
 * - Show `SOURCE_LABEL[lang][result.source]` next to every text ("Written by AI" / "Fixed rules").
 * - explainPlan(plan): `sentences` (3-5) + `watchOut` list for the plan header.
 * - explainReplan(before, after, diff): `summary` + one ready-to-send `messages[i].text` per affected
 *   employee. Nothing is ever sent: render a Copy button (navigator.clipboard.writeText) per message.
 * - askTeam(question, plan, employees): `answer`; `refused` is true when it can't answer from the data.
 *   `employeeIds` lists the people the answer names, for highlighting rows.
 * - coachingNote(profile): `strengths` (always first), `focus`, `note`. Health and absence are left out.
 * - SWR-friendly: `useSWR(["explain", plan.date, plan.version, lang], () => explainPlan(plan, {key, lang}))`.
 *
 * Checks (same idea as briefing.ts / replan.ts): temperature 0, a JSON schema, every number the model
 * writes must appear in the data it was given (ollama.grounded), every "Name X." it writes must be a
 * real employee, and word limits. Any failure uses the fixed rules for the whole result.
 */
import type { Lang } from "./assist";
import { allowedNumbers, chatJson, grounded } from "./ollama";
import type { DiffRow, Employee, Plan, Profile } from "./workforce";

export type Source = "model" | "rules";

export const SOURCE_LABEL: Record<Lang, Record<Source, string>> = {
  en: { model: "Written by AI", rules: "Fixed rules" },
  uk: { model: "Написано ШІ", rules: "Фіксовані правила" },
};

export interface AiOptions {
  /** Open WebUI key; empty or missing = fixed rules only. */
  key?: string;
  lang?: Lang;
}

interface Result {
  source: Source;
  lang: Lang;
  /** Set when the model was asked but its answer could not be used. */
  error?: string;
}

export interface PlanExplanation extends Result {
  sentences: string[];
  watchOut: string[];
}

export interface ShiftMessage {
  employee_id: string;
  name: string;
  /** Ready to copy into a chat app. Never sent automatically. */
  text: string;
}

export interface ReplanExplanation extends Result {
  summary: string;
  messages: ShiftMessage[];
}

export interface TeamAnswer extends Result {
  answer: string;
  refused: boolean;
  employeeIds: string[];
}

export interface CoachingNote extends Result {
  strengths: string[];
  focus: string[];
  note: string;
}

const LANGUAGE: Record<Lang, string> = { en: "English", uk: "Ukrainian" };
const UNUSABLE = "The AI answer didn't pass the checks, so the fixed rules wrote this.";

/* ---------------------------------------------------------------- checks */

/** Every primitive inside a value, for the number check. */
export function flatValues(v: unknown, out: unknown[] = []): unknown[] {
  if (v === null || v === undefined) return out;
  if (Array.isArray(v)) v.forEach((x) => flatValues(x, out));
  else if (typeof v === "object") Object.values(v as object).forEach((x) => flatValues(x, out));
  else out.push(v);
  return out;
}

const NAME = /\b[A-ZА-ЯІЇЄҐ][a-zа-яіїєґ'’]+ [A-ZА-ЯІЇЄҐ]\./g;

/** True when every "Olena K."-style name in the text is one of the known names. */
export function namesKnown(text: string, known: Iterable<string>): boolean {
  const set = new Set(known);
  return (text.match(NAME) ?? []).every((n) => set.has(n));
}

const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");
const strs = (x: unknown) => (Array.isArray(x) ? x.map(str) : []);

/** One text passes when it is non-empty, grounded in `allowed`, within `maxWords` and names only `names`. */
export function textOk(text: string, allowed: Set<number>, names: Iterable<string>, maxWords: number): boolean {
  return text.length > 0 && grounded(text, allowed, maxWords) && namesKnown(text, names);
}

async function withModel<T extends Result>(opts: AiOptions, rules: () => T, ask: (key: string, lang: Lang) => Promise<T | null>): Promise<T> {
  const key = (opts.key ?? "").trim();
  const lang = opts.lang ?? "en";
  if (!key) return rules();
  try {
    return (await ask(key, lang)) ?? { ...rules(), error: UNUSABLE };
  } catch (e) {
    return { ...rules(), error: e instanceof Error ? e.message : String(e) };
  }
}

const first = (name: string) => name.split(" ")[0];
const hourNum = (hhmm: string) => Number.parseInt(hhmm.slice(0, 2), 10);
const dayLabel = (iso: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${iso}T00:00:00Z`));

/* ---------------------------------------------------------------- explainPlan */

function peak(plan: Plan) {
  return plan.hours.reduce((a, b) => (b.required > a.required || (b.required === a.required && b.customers > a.customers) ? b : a), plan.hours[0]);
}

function planWatchOut(plan: Plan, lang: Lang): string[] {
  const uk = lang === "uk";
  const out = plan.gaps.map((g) => (uk ? `Бракує ${g.missing} ос. ${g.from}-${g.to}` : `Short ${g.missing} ${g.missing === 1 ? "person" : "people"} ${g.from}-${g.to}`));
  for (const c of plan.conditions)
    if (c.kind === "power" || c.kind === "air_alert") out.push(`${c.label} (${c.from}-${c.to})`);
  if (!plan.shifts.some((s) => s.role === "shift_lead")) out.push(uk ? "Немає старшого зміни: керує старший касир" : "No shift lead: a senior cashier leads the floor");
  if (plan.kpis.overtime_hours > 0) out.push(uk ? `Понаднормові: ${plan.kpis.overtime_hours} год` : `Overtime: ${plan.kpis.overtime_hours} h`);
  if (plan.kpis.rule_violations > 0) out.push(uk ? `Порушень правил: ${plan.kpis.rule_violations}` : `Rule violations: ${plan.kpis.rule_violations}`);
  return out;
}

export function explainPlanByRules(plan: Plan, lang: Lang = "en"): PlanExplanation {
  const k = plan.kpis;
  let sentences: string[];
  if (lang === "en" && plan.explain.length >= 3) sentences = plan.explain.slice(0, 5);
  else {
    const p = peak(plan);
    const g = plan.gaps[0];
    sentences =
      lang === "uk"
        ? [
            `Найбільше людей потрібно о ${p.hour}: ${p.required} на приблизно ${p.customers} покупців; у плані ${p.scheduled}.`,
            `${plan.shifts.length} змін, ${k.labour_hours} людино-годин, покрито ${k.coverage_pct}% потрібних годин.`,
            g ? `Бракує ${g.missing} ос. з ${g.from} до ${g.to}: усі доступні вже в графіку або на межі годин.` : "Кожна година має достатньо людей, відкривача й закривача.",
          ]
        : [
            `The most people are needed at ${p.hour}: ${p.required} for about ${p.customers} customers; the plan has ${p.scheduled}.`,
            `${plan.shifts.length} shifts, ${k.labour_hours} labour hours, ${k.coverage_pct}% of required hours covered.`,
            g ? `Short by ${g.missing} from ${g.from} to ${g.to}: everyone available is already scheduled or at their limit.` : "Every open hour has enough people, an opener and a closer.",
          ];
  }
  return { sentences, watchOut: planWatchOut(plan, lang), source: "rules", lang };
}

const PLAN_PROMPT = `You explain a store's staffing plan to its manager, a busy non-technical person.
You receive the plan the scheduling agent drafted: hours with customers, required and scheduled staff, shifts with tasks,
under-staffed gaps, store conditions and KPIs.
Write 3 to 5 plain sentences (at most 30 words each) on what the plan does and why, then a "watch out" list of 0 to 4 short
items (at most 15 words each) for the risks the manager should check. Use only numbers and names that appear in the plan,
written exactly as given; never invent numbers or people. Write in the language given in the request. Return exactly the JSON requested.`;

const PLAN_SCHEMA = {
  type: "object",
  properties: { sentences: { type: "array", items: { type: "string" } }, watch_out: { type: "array", items: { type: "string" } } },
  required: ["sentences", "watch_out"],
};

function planPayload(plan: Plan) {
  return {
    date: plan.date, opening: plan.opening, conditions: plan.conditions, blocks: plan.blocks, gaps: plan.gaps, kpis: plan.kpis,
    hours: plan.hours.map((h) => ({ hour: h.hour, customers: h.customers, required: h.required, scheduled: h.scheduled })),
    shifts: plan.shifts.map((s) => ({
      employee_id: s.employee_id, name: s.name, role: s.role, start: s.start, end: s.end, break_at: s.break_at,
      tasks: s.tasks.map((t) => ({ from: t.from, to: t.to, task: t.task, station: t.station, reason: t.reason })),
    })),
  };
}

/** 3-5 plain sentences and a watch-out list; every number must be in the plan. */
export function explainPlan(plan: Plan, opts: AiOptions = {}): Promise<PlanExplanation> {
  const lang = opts.lang ?? "en";
  return withModel(opts, () => explainPlanByRules(plan, lang), async (key) => {
    const out = await chatJson<{ sentences: unknown; watch_out: unknown }>(
      key, PLAN_PROMPT, JSON.stringify({ language: LANGUAGE[lang], plan: planPayload(plan) }), PLAN_SCHEMA, 120_000,
    );
    const sentences = strs(out.sentences);
    const watchOut = strs(out.watch_out);
    const allowed = allowedNumbers(flatValues(plan));
    const names = plan.shifts.map((s) => s.name);
    const ok =
      sentences.length >= 3 && sentences.length <= 5 && watchOut.length <= 4 &&
      sentences.every((s) => textOk(s, allowed, names, 35)) && watchOut.every((s) => textOk(s, allowed, names, 18));
    return ok ? { sentences, watchOut, source: "model", lang } : null;
  });
}

/* ---------------------------------------------------------------- explainReplan */

function messageByRules(row: DiffRow, date: string, lang: Lang): string {
  const n = first(row.name);
  const day = dayLabel(date, lang);
  if (lang === "uk") {
    if (row.before === row.after) return `Привіт, ${n}! ${day} твоя зміна ${row.after} без змін, але змінюються завдання. Підтвердь, будь ласка.`;
    if (row.before === "off") return `Привіт, ${n}! Чи можеш вийти ${day} ${row.after}? Нам бракує людей. Підтвердь, будь ласка.`;
    if (row.after === "off") return `Привіт, ${n}! ${day} твою зміну ${row.before} скасовано. Дякуємо за розуміння.`;
    return `Привіт, ${n}! ${day} твоя зміна переноситься з ${row.before} на ${row.after}. Підтвердь, будь ласка.`;
  }
  const why = row.why ? ` ${row.why.replace(/\.?$/, ".")}` : "";
  if (row.before === row.after) return `Hi ${n}, your shift on ${day} stays ${row.after}, but your tasks change.${why} Please confirm.`;
  if (row.before === "off") return `Hi ${n}, could you work ${row.after} on ${day}?${why} Please confirm.`;
  if (row.after === "off") return `Hi ${n}, your ${row.before} shift on ${day} is cancelled.${why} Thanks for understanding.`;
  return `Hi ${n}, your shift on ${day} changes from ${row.before} to ${row.after}.${why} Please confirm.`;
}

export function explainReplanByRules(before: Plan, after: Plan, diff: DiffRow[], lang: Lang = "en"): ReplanExplanation {
  const b = before.kpis;
  const a = after.kpis;
  const g = after.gaps[0];
  const summary =
    lang === "uk"
      ? `${diff.length} змін для працівників. Покриття ${b.coverage_pct}% → ${a.coverage_pct}%, людино-години ${b.labour_hours} → ${a.labour_hours}. ` +
        (g ? `Ще бракує ${g.missing} ос. ${g.from}-${g.to}.` : "Прогалин не залишилось.")
      : `${diff.length} ${diff.length === 1 ? "person is" : "people are"} affected. Coverage ${b.coverage_pct}% → ${a.coverage_pct}%, labour hours ${b.labour_hours} → ${a.labour_hours}. ` +
        (g ? `Still short ${g.missing} ${g.from}-${g.to}.` : "No gaps left.");
  return {
    summary,
    messages: diff.map((r) => ({ employee_id: r.employee_id, name: r.name, text: messageByRules(r, after.date, lang) })),
    source: "rules",
    lang,
  };
}

const REPLAN_PROMPT = `You help a store manager tell staff about a changed shift plan. You receive the plan before and after a
re-plan (KPIs, gaps, conditions) and the list of changed shifts (before/after times or "off", and why).
Write a summary of at most 50 words: what changed and why. Then write one short, friendly message per changed person
(at most 50 words), addressed by first name, that the manager can copy and send: the day, the new shift times (or that the
shift is cancelled, or that only tasks change) and a request to confirm. Return one message for every employee_id in the
list and no others. Use only numbers, times and names from the data; never invent them. Write in the language given in
the request. Return exactly the JSON requested.`;

const REPLAN_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    messages: {
      type: "array",
      items: { type: "object", properties: { employee_id: { type: "string" }, text: { type: "string" } }, required: ["employee_id", "text"] },
    },
  },
  required: ["summary", "messages"],
};

/** "08:00-16:00" must appear as times the reader recognises: 08:00 or 8:00. */
const hasTime = (text: string, hhmm: string) => text.includes(hhmm) || text.includes(hhmm.replace(/^0/, ""));

/** What changed and why, plus one ready-to-send message per affected employee (never sent automatically). */
export function explainReplan(before: Plan, after: Plan, diff: DiffRow[], opts: AiOptions = {}): Promise<ReplanExplanation> {
  const lang = opts.lang ?? "en";
  return withModel(opts, () => explainReplanByRules(before, after, diff, lang), async (key) => {
    const payload = {
      language: LANGUAGE[lang], date: after.date, day: dayLabel(after.date, lang),
      before: { kpis: before.kpis, gaps: before.gaps }, after: { kpis: after.kpis, gaps: after.gaps, conditions: after.conditions },
      changes: diff,
    };
    const out = await chatJson<{ summary: unknown; messages: unknown }>(key, REPLAN_PROMPT, JSON.stringify(payload), REPLAN_SCHEMA, 120_000);
    const summary = str(out.summary);
    const names = diff.map((r) => r.name);
    const dayNums = flatValues([after.date, dayLabel(after.date, lang)]);
    if (!textOk(summary, allowedNumbers(flatValues([before.kpis, after.kpis, before.gaps, after.gaps, after.conditions, diff])), names, 55)) return null;
    const raw = Array.isArray(out.messages) ? (out.messages as { employee_id?: unknown; text?: unknown }[]) : [];
    if (raw.length !== diff.length) return null;
    const messages: ShiftMessage[] = [];
    for (const row of diff) {
      const m = raw.find((x) => x.employee_id === row.employee_id);
      const text = str(m?.text);
      const allowed = allowedNumbers([...flatValues(row), ...dayNums]);
      if (!textOk(text, allowed, [row.name], 55)) return null;
      if (row.after !== "off" && !row.after.split("-").every((t) => hasTime(text, t))) return null;
      messages.push({ employee_id: row.employee_id, name: row.name, text });
    }
    return { summary, messages, source: "model", lang };
  });
}

/* ---------------------------------------------------------------- askTeam */

export const TEAM_FALLBACK: Record<Lang, string> = {
  en: "I can't answer that from today's plan and team data.",
  uk: "Я не можу відповісти на це з сьогоднішнього плану й даних команди.",
};

const onAt = (plan: Plan, h: number) => plan.shifts.filter((s) => hourNum(s.start) <= h && h < hourNum(s.end));

export function askTeamByRules(question: string, plan: Plan, employees: Employee[], lang: Lang = "en"): TeamAnswer {
  const uk = lang === "uk";
  const q = question.toLowerCase();
  const refuse: TeamAnswer = { answer: TEAM_FALLBACK[lang], refused: true, employeeIds: [], source: "rules", lang };
  const named = employees.find((e) => q.includes(first(e.name).toLowerCase()));
  const hourMatch = q.match(/\b([01]?\d|2[0-3])(?::00|\s*(?:h|год))?\b/);
  if (named && /why|чому/.test(q)) {
    const s = plan.shifts.find((x) => x.employee_id === named.employee_id);
    if (!s) {
      const status = String(named.status_today).replace("_", " ");
      return { answer: uk ? `${named.name} сьогодні не в плані (${status}).` : `${named.name} is not on today's plan (${status}).`, refused: false, employeeIds: [named.employee_id], source: "rules", lang };
    }
    const lines = s.tasks.map((t) => `${t.from}-${t.to} ${t.station ?? t.task}: ${t.reason}`);
    return { answer: `${s.name} ${s.start}-${s.end}. ${lines.join("; ")}.`, refused: false, employeeIds: [s.employee_id], source: "rules", lang };
  }
  if (hourMatch && /who|cover|хто|підмін|free|available|вільн/.test(q)) {
    const h = Number(hourMatch[1]);
    const row = plan.hours.find((x) => hourNum(x.hour) === h);
    if (!row) return refuse;
    const on = onAt(plan, h);
    const wantsCheckout = /checkout|till|кас/.test(q);
    const task = (s: (typeof on)[number]) => s.tasks.find((t) => hourNum(t.from) <= h && h < hourNum(t.to));
    const onShift = on.map((s) => `${s.name} (${task(s)?.station ?? task(s)?.task ?? s.role})`).join(", ");
    const scheduled = new Set(plan.shifts.map((s) => s.employee_id));
    const spare = employees.filter((e) => !scheduled.has(e.employee_id) && e.status_today === "available" && (!wantsCheckout || e.skills.includes("checkout")));
    const spareText = spare.length
      ? (uk ? ` Не в графіку, але доступні: ${spare.map((e) => e.name).join(", ")}.` : ` Off the plan but available: ${spare.map((e) => e.name).join(", ")}.`)
      : (uk ? " Вільних доступних людей немає." : " No one else is available.");
    const answer = uk
      ? `О ${row.hour} потрібно ${row.required}, у плані ${row.scheduled}: ${onShift}.${spareText}`
      : `At ${row.hour} the plan needs ${row.required} and has ${row.scheduled}: ${onShift}.${spareText}`;
    return { answer, refused: false, employeeIds: [...on.map((s) => s.employee_id), ...spare.map((e) => e.employee_id)], source: "rules", lang };
  }
  return refuse;
}

const ASK_PROMPT = `You answer a store manager's question about today's staffing plan and team. You receive the plan (hours,
shifts with tasks and reasons, gaps, KPIs) and the employee list (skills, status today, hours this week, score).
Answer in at most 60 words, plainly, using only people, numbers and times from the data, with names written exactly as given.
If someone is suggested for cover, prefer people whose status today is "available", who are not on the plan, and have the
needed skill. If the data does not answer the question, or it is not about this store's staffing, set "answer" to exactly
"CANNOT_ANSWER". List the employee_id of everyone you name. Write in the language given in the request. Return exactly the JSON requested.`;

const ASK_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" }, employee_ids: { type: "array", items: { type: "string" } } },
  required: ["answer", "employee_ids"],
};

/** A grounded answer about the plan and team; refuses rather than invent people or numbers. */
export function askTeam(question: string, plan: Plan, employees: Employee[], opts: AiOptions = {}): Promise<TeamAnswer> {
  const lang = opts.lang ?? "en";
  const q = question.trim().slice(0, 300);
  return withModel(opts, () => askTeamByRules(q, plan, employees, lang), async (key) => {
    const team = employees.map((e) => ({
      employee_id: e.employee_id, name: e.name, role: e.role, skills: e.skills, status_today: e.status_today,
      hours_this_week: e.hours_this_week, contract_hours_week: e.contract_hours_week, score: e.score, strength: e.strength,
    }));
    const out = await chatJson<{ answer: unknown; employee_ids: unknown }>(
      key, ASK_PROMPT, JSON.stringify({ language: LANGUAGE[lang], question: q, plan: planPayload(plan), team }), ASK_SCHEMA, 120_000,
    );
    const answer = str(out.answer);
    if (answer === "CANNOT_ANSWER") return { answer: TEAM_FALLBACK[lang], refused: true, employeeIds: [], source: "model", lang };
    const ids = new Set(employees.map((e) => e.employee_id));
    const employeeIds = strs(out.employee_ids).filter((id) => ids.has(id));
    const allowed = allowedNumbers([...flatValues(planPayload(plan)), ...flatValues(team), ...flatValues(q)]);
    if (!textOk(answer, allowed, employees.map((e) => e.name), 65)) return null;
    return { answer, refused: false, employeeIds, source: "model", lang };
  });
}

/* ---------------------------------------------------------------- coachingNote */

/** Health, absence and personal-life topics are never part of a development note. */
const PRIVATE = /sick|\bill(ness)?\b|health|absen|medical|doctor|pregnan|family|хвор|здоров|відсутн|лікар|сімейн/i;
const JUDGEMENT = /\b(lazy|bad|poor|weak|terrible|unreliable|slow worker|failure)\b|лінив|поган|слабк|ненадійн/i;

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const r1 = (x: number) => Math.round(x * 10) / 10;

export function coachingNoteByRules(profile: Profile, lang: Lang = "en"): CoachingNote {
  const uk = lang === "uk";
  const recent = profile.performance.slice(-4);
  const punct = r1(avg(recent.map((w) => w.punctuality_pct)));
  const rating = r1(avg(recent.map((w) => w.customer_rating)));
  const strengths = profile.strengths.filter((s) => !PRIVATE.test(s));
  if (profile.strength && !strengths.includes(profile.strength)) strengths.unshift(profile.strength);
  if (punct >= 95) strengths.push(uk ? `Пунктуальність ${punct}%` : `On time ${punct}% of shifts`);
  if (rating >= 4.5) strengths.push(uk ? `Оцінка покупців ${rating} з 5` : `Customer rating ${rating} of 5`);
  if (strengths.length === 0) strengths.push(uk ? "Стабільна робота на змінах" : "Steady work across shifts");
  const focus = profile.watch.filter((w) => !PRIVATE.test(w));
  const n = first(profile.name);
  const note = uk
    ? `${n} найсильніше в: ${strengths[0]}. ` + (focus.length ? `Над чим попрацювати разом: ${focus[0]}.` : "Варто продовжувати в тому ж дусі.")
    : `${n}'s clearest strength: ${strengths[0]}. ` + (focus.length ? `One thing to work on together: ${focus[0]}.` : "Keep doing what works.");
  return { strengths: strengths.slice(0, 3), focus: focus.slice(0, 2), note, source: "rules", lang };
}

const COACH_PROMPT = `You help a store manager write a short, neutral and respectful development note for one team member,
for a one-to-one conversation. You receive their weekly performance (items scanned, cases received, shelves replenished per
hour, scan error rate, punctuality, customer rating, station skills), their score and trend, and strengths and points to watch.
Start with strengths: 1 to 3 short items. Then 0 to 2 concrete, supportive focus points phrased as things to practise.
Then a note of at most 50 words. Describe work behaviour only, never the person's character. Never mention health,
sickness, absences or private life, and never guess reasons. Use only numbers and the name from the data. Write in the
language given in the request. Return exactly the JSON requested.`;

const COACH_SCHEMA = {
  type: "object",
  properties: {
    strengths: { type: "array", items: { type: "string" } },
    focus: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
  required: ["strengths", "focus", "note"],
};

/** Strengths first, then supportive focus points; no judgement on health or absence. */
export function coachingNote(profile: Profile, opts: AiOptions = {}): Promise<CoachingNote> {
  const lang = opts.lang ?? "en";
  return withModel(opts, () => coachingNoteByRules(profile, lang), async (key) => {
    // absences, availability and notes are left out so the model cannot comment on them
    const data = {
      name: profile.name, role: profile.role, skills: profile.skills, score: profile.score, trend: profile.trend,
      strength: profile.strength ?? null, strengths: profile.strengths.filter((s) => !PRIVATE.test(s)),
      watch: profile.watch.filter((w) => !PRIVATE.test(w)),
      performance: profile.performance.map((w) => Object.fromEntries(Object.entries(w).filter(([k]) => k !== "absences"))),
    };
    const out = await chatJson<{ strengths: unknown; focus: unknown; note: unknown }>(
      key, COACH_PROMPT, JSON.stringify({ language: LANGUAGE[lang], employee: data }), COACH_SCHEMA, 120_000,
    );
    const strengths = strs(out.strengths);
    const focus = strs(out.focus);
    const note = str(out.note);
    const allowed = allowedNumbers(flatValues(data));
    const all = [...strengths, ...focus, note];
    const ok =
      strengths.length >= 1 && strengths.length <= 3 && focus.length <= 2 &&
      all.every((t) => textOk(t, allowed, [profile.name], t === note ? 55 : 20)) &&
      !all.some((t) => PRIVATE.test(t) || JUDGEMENT.test(t));
    return ok ? { strengths, focus, note, source: "model", lang } : null;
  });
}
