# Workforce agent: shared contract

The brief's core case (AI Workforce Agent): expected traffic + historical sales + employee
availability + store workload + opening hours + promotions + local conditions
→ optimal staffing plan → manager approval. Plus task allocation per employee, recalculation
every 1-2 hours, and continuity scenarios (air-raid alert, power outage).

Flow: DATA → AGENT → ANALYSIS → RECOMMENDATION → HUMAN APPROVAL → ACTION → KPI FEEDBACK.
Governance: the agent recommends (level 1) and prepares (level 2); the manager approves. Every
plan change is logged (audit trail).

Store #417 opens 08:00-21:00 (13 hours). Demo "today" is 2026-11-02 (Monday).
Times are local "HH:MM" strings; dates ISO.

## Data (backend/data, generated with the existing seed)

- `employees.csv`: employee_id (E01..), name (Ukrainian first name + initial, e.g. "Olena K."),
  role (`senior_cashier|cashier|stocker|merchandiser|shift_lead`), skills (`;` list of
  `checkout|receiving|replenishment|merchandising|customer_service|inventory`),
  contract_hours_week, hourly_cost_uah, start_date, can_open (bool), can_close (bool).
  About 14 people, enough to be tight, not abundant.
- `availability.csv`: date, employee_id, available_from, available_to, status
  (`available|day_off|sick|vacation|unavailable`), note. Covers history + 7 days ahead.
- `shifts.csv`: past worked shifts: date, employee_id, start, end, tasks (`;`).
- `performance.csv` (per employee per week): week_start, employee_id,
  items_scanned_per_hour, cases_received_per_hour, shelves_replenished_per_hour,
  scan_error_rate, punctuality_pct, absences, customer_rating (1-5).
- `traffic.csv`: date, hour (8..20), customers, transactions. Derived consistently from
  sales.csv daily totals with a realistic intraday curve (morning, lunch, evening peak),
  weekday effect, promotion uplift, outage and air-alert dips (events.csv).
- `performance.csv` also has station skills: heavy_lifting (1-100, receiving dock),
  audit_accuracy (%, inventory count), facing_neatness (1-100, promo & facing).
- `store_calendar.csv` (added): date, kind (`delivery|power|promotion`), from, to, label, value: the
  known conditions ahead (Monday DC delivery of 120 cases, Wednesday 12:00-16:00 scheduled power cut
  at 0.6x traffic, Fri-Sun promotion at 1.2x). `disruption_windows.csv` (added): the hour window of
  each past outage / alert day in events.csv, used to shape traffic.csv and excluded from the forecast.
- All other existing CSVs are byte-identical (the staff data uses its own random stream).
- `labour_rules` live in config (`avrora.config.RULES`): max 8 h/shift, max 40 h/week (contract caps), min 11 h rest,
  30 min break for shifts > 6 h, at least 1 opener with can_open, 1 closer with can_close,
  a shift_lead or senior_cashier on site at all open hours, min 2 people on site at all times.

## Workload model (per hour)

Labour-hours needed per task per hour:
- checkout = forecast transactions / (team avg items-scanned rate → transactions per hour)
- receiving = units on deliveries expected that day (deliveries.csv) / cases_received rate,
  scheduled in the delivery window (default 08:00-11:00)
- replenishment = forecast units sold that hour / shelves_replenished rate
- merchandising = promotion setups + markdown/move-to-front actions from today's actions
- customer_service = share of traffic
Required staff per hour = ceil(sum of labour-hours / 0.85 utilisation), min 2.

## API (FastAPI + identical Cloudflare Worker rebuild from snapshot)

`GET /api/workforce/plan?date=YYYY-MM-DD` (default today) →
```
{
  date, generated_at, status: "draft"|"approved", version,
  opening: {open:"08:00", close:"21:00"},
  conditions: [{kind:"power"|"air_alert"|"promotion"|"delivery", label, from, to}],
  hours: [{hour:"08:00", customers, transactions, required, scheduled,
           workload:{checkout, receiving, replenishment, merchandising, customer_service}}],
  blocks: [{from:"08:00", to:"10:00", required, scheduled}],   // brief's "Example staffing plan"
  shifts: [{employee_id, name, role, start, end, break_at|null, hours,
            tasks:[{from, to, task, reason}]}],                 // task allocation
  gaps: [{from, to, missing, reason}],                          // under-staffed windows
  kpis: {labour_hours, labour_cost_uah, coverage_pct, sales_per_labour_hour_uah,
         overtime_hours, rule_violations},
  explain: [string],          // 3-5 plain sentences from fixed rules (AI may rewrite)
  changes: [{at, by:"agent"|"manager", summary}]   // audit trail
}
```
Contract refinements (implemented in FastAPI and the Worker):
- `version` is a string: `"base"` for the agent's draft, or the replan key `sick-E05`,
  `air_alert-12`, `power-12`, `traffic_spike-12` (kind + start hour). Approve/reject take it back.
- Plans exist for today..today+6 only (other dates: 404 `{detail}`); bad date: 422.
- Every plan carries `demo_data: true`. `GET /plan` returns the latest *approved* version for the date
  (status `approved`), otherwise the base draft (a reject returns it to the base draft).
- `changes` = the agent's "Drafted plan" entry + workforce_audit rows for that date (replan drafted by
  agent, approved/rejected by manager), oldest first.
- Each `tasks[]` block: `{from, to, task, station, priority, match, reason}`. task is one of
  `checkout|receiving|replenishment|merchandising|customer_service|inventory|shelter`. Stations:
  `Lead checkout` (Critical, scan speed), `Checkout 2 & returns` (High, customer rating),
  `Receiving dock` (Critical, lifting + cases/h), `Priority restock aisles` (High, units/h),
  `Promo & facing` (Standard, facing), `Shift lead / float` (Standard, rating), `Inventory count`
  (Standard, audit accuracy), `Shelter` (air-raid alert window). `match` 0-100 = the person's
  metric vs the best in store; `reason` cites the metric vs store average
  ("139 items/h, store average 106").
- Replan events are presets: `from` is a whole hour 08:00-20:00 (default 12:00); the length is
  fixed per kind (air_alert 2 h, power 4 h, traffic_spike 3 h, clipped at 21:00); `to` may be
  omitted or must equal that end, else 422. `sick` needs `employee_id` and covers the whole day;
  from/to are ignored. Every replan is written to the audit trail as an agent "drafted" entry.
  Effects: air_alert = 0 customers in the window, min staff, everyone on `shelter`, 1.3x rebound
  the hour after; power = 0.6x traffic and 0.7x till speed; traffic_spike = 1.5x traffic.
  Replans keep everyone's shift (extend or call in; a shift is only moved when a hard rule
  needs it) and come with `diff: [{employee_id, name, before, after, why}]` (before/after
  "08:00-16:00" or "off"; task-only changes have equal before/after).
- `POST /plan/approve` → `{status:"approved", at, date, version}`; `POST /plan/reject` body
  `{date, version, reason (1-200 chars)}` → `{status:"rejected", at, date, version, reason}`.
- Employees: each row also has `strength` (one of "Fast checkout", "Fast restock", "Receiving lead",
  "Accurate counter", "Merchandising eye", "Customer favourite"). `next_shift` is
  `{date, start, end}`; `hours_this_week` = planned paid hours Mon-Sun. The profile adds
  hourly_cost_uah, start_date, can_open, can_close, demo_data, `planned_shifts` (this week),
  `availability: [{date, status, from, to, note}]`, `recent_shifts: [{date, start, end, tasks[]}]`.
- Score = 30% productivity vs team median, 20% scan accuracy, 20% punctuality, 15% customer
  rating, 15% attendance (last 4 weeks); trend compares with the 4 weeks before (±3 points).
- Worker: plans and all 371 replans (7 days × (14 sick + 13 starts × 3 kinds)) are precomputed into
  the snapshot; approvals/audit live in D1 table `workforce_audit` (migration 0004).

`GET /api/workforce/employees` → `{employees:[{employee_id,name,role,skills,contract_hours_week,
  hours_this_week, status_today, next_shift|null, score (0-100), trend:"up"|"flat"|"down"}]}`
`GET /api/workforce/employees/{id}` → profile + `performance` weekly series (12 weeks) +
  `strengths` / `watch` (plain strings) + `recent_shifts` + `availability` (next 7 days).
`POST /api/workforce/replan` body `{date, event:{kind:"sick"|"air_alert"|"power"|"traffic_spike",
  employee_id?, from?, to?}}` → a new draft plan (same shape) with `diff: [{employee_id, name,
  before, after, why}]`. Deterministic, never auto-approves.
`POST /api/workforce/plan/approve` body `{date, version}` → `{status:"approved", at}`; stored in
  D1 (Worker) / sqlite (local) with the audit entry. `POST /api/workforce/plan/reject` likewise
  with a reason.

Honesty: all employee, performance and traffic data is synthetic (label it "Demo data").
No personal data beyond first name + initial.

## KPI feedback and staffing signals (FastAPI + Worker)

`GET /api/workforce/kpis` → the brief's KPI FEEDBACK step:
```
{
  demo_data: true, today: "2026-11-02",
  weeks: [ // the 4 full weeks before this one, oldest first, from shifts/traffic/sales history
    {week_start, week_end, source:"history", required_hours, planned_hours, coverage_pct,
     labour_hours, sales_uah, sales_per_labour_hour_uah}],
  this_week: {...same fields, source:"plan"},   // the agent's base drafts for today..today+6
  decisions: {since, approved, rejected, replans, approval_rate_pct|null,
              by_week:[{week_start, approved, rejected, replans}]}  // workforce_audit, last 28 days
}
```
- required_hours / planned_hours are person-hours over open hours (08-21); required uses the
  planner's workload model on the traffic that actually happened; `coverage_pct` =
  sum(min(required, planned)) / required. Labour hours are paid hours (breaks removed).
- weeks + this_week are precomputed into the snapshot (`workforce.kpis`, checked by the export);
  `decisions` is counted live from sqlite / D1 (replans = agent "drafted" rows).

`GET /api/signals/staffing` → `{updated_at, date, signals:[{key, kind, severity, title, body, url, priority}]}`.
The Worker's cron pushes the same signals (`staffing` source in cloudflare/src/signals.ts).
- kind `unapproved` (high): today's plan not approved and Kyiv time ≥ 07:00, before closing.
- kind `gap`: each gap today (not yet over) and tomorrow, title "Short 1 person 17:00-20:00"
  ("Tomorrow: short …"); high when it starts within 2 h (or is running), else medium.
- kind `sick`: sick in availability today (medium) or a sick re-plan drafted today (high, "called in sick").
- kind `no_lead` (medium): no `shift_lead` on today's / tomorrow's plan in force.
- Keys: `staffing:unapproved:DATE`, `staffing:gap:DATE:FROM-TO:MISSING`, `staffing:sick:DATE:EID`,
  `staffing:no_lead:DATE`. url `/?view=team&date=YYYY-MM-DD`. The plan in force = the last approved
  version, else the base draft. When the Kyiv date has no plan, "today" is the first plan date.

## Browser AI texts (frontend/src/lib/workforce-ai.ts)

`explainPlan(plan, {key, lang})`, `explainReplan(before, after, diff, opts)`, `askTeam(question, plan,
employees, opts)`, `coachingNote(profile, opts)`: never throw; each returns `source: "model"|"rules"`
(label with `SOURCE_LABEL[lang][source]`), plus `error` when the model answer was not usable. Shift
messages are text to copy, never sent. See the note at the top of the file.

`key` is the AI route from `aiRoute()` in `frontend/src/lib/ai.ts`: `"server"` sends the chat to
`POST /api/ai/chat` (body `{messages:[{role,content}], schema?, max_tokens?}` → `{content, model}`; the
server adds `AI_API_KEY` and forwards to the OpenAI-compatible `AI_BASE_URL`), `"own"` calls the
provider saved on this device, `""` means rules only. `GET /api/ai/status` → `{configured, model}`.
Proxy errors: 503 not set up, 413 body over 64 KB, 422 bad body, 429 over 20 requests a minute per
client, 502 provider failed. `max_tokens` is capped at 1500.
