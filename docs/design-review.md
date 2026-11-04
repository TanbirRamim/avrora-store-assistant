# Design review: v2 "Quiet professional" → v2.1 (release bar)

Reviewer stance: design lead signing off a product release. Tokens, palette and type stay as in
`design-system.md` v2. This round fixes structure, density, scannability and finish, measured by
`e2e/design-qa.spec.ts` (baseline on the current preview: 9 pass / 15 fail across 6 screens × 4
devices).

## Acceptance criteria (automated, `e2e/design-qa.spec.ts`, all four projects must pass)

1. No sideways page scroll.
2. No clipped or ellipsised text (screen-reader-only text excepted).
3. Yellow only inside the Avrora logo.
4. Phones: every button, link, tab, input ≥ 44×44 (the whole hit area, not just the glyph).
5. Phones: fixed bottom chrome (tab bar + any action bar) ≤ 20 % of the viewport height.
6. axe colour contrast: zero violations.
Plus the existing behaviour specs stay green, and a human screenshot review signs off.

## Benchmarks and what we take from them

- **Shopify admin, resource index (products):** a 40 px bordered thumbnail beside the linked
  name, a status badge, inventory as a plain column, filters as tabs with counts above the table,
  search inline with the filters, and "Showing N of M products". Index tables are for at-a-glance
  scanning and opening the detail page.
  Sources: shopify.dev/docs/api/app-home/patterns/templates/resource-index,
  polaris-react.shopify.com/components/tables.
- **Modern rota apps (Optiq 2026, ShiftWorks, ServiceNow on-call):** on phones, shifts are shown
  as readable cards rather than a cramped grid; managers get a dedicated list of gaps with a
  per-gap action; approval is one clear step.
- **Linear / Stripe:** dense but calm lists, one primary action per view, chrome kept minimal,
  smooth 150–200 ms transitions that answer the user's action.

## Findings and direction per screen

### Products (owner: Products agent)
- Add a **product thumbnail** to every row and the sheet header. No photos exist, so render a
  40 px (48 px in the sheet) neutral tile (zinc-100, 1 px border, radius 8) with a category icon
  (Kitchen, Household, Cosmetics, Seasonal, Stationery, Toys: draw simple 1.5 px stroke icons in
  `icons.tsx`'s style; add them in a NEW file `src/components/CategoryIcon.tsx`).
- **Filters as tabs with counts** (Polaris pattern): All 200 · Needs attention 20 · Running low 9 ·
  Late 2 · Hard to find 3 · Overstocked 6. Underline tabs, 44 px, scrollable on phones with an edge fade.
  Remove the separate status-pill row (no duplicated filters). Sort becomes a compact "Sort" menu
  button (44 px) on phones, segmented on desktop.
- Search: whole field is the 44 px+ hit area.
- **Desktop = a real index table** with column headers: Product (thumb + name + supplier) |
  Status | In stock | Lasts | Price. Right-align numbers, tabular figures in columns.
  **Phone = list rows**: thumb | name / status badge + "7 in stock" | right: "0.9 days" (red when
  short) + chevron. Caption above the list: "Showing 20 of 200 products".
- Product sheet: thumbnail + name + price header; suggestion card's left edge must not look
  clipped (use a 3 px inset edge inside the radius, not a border on a rounded corner).

### Team (owner: Team agent)
- **Header:** title row = logo + "Team" + a right-aligned icon button "Replan" (44 px, with a
  label on desktop) instead of the stacked "Something changed" button. Plan / People segmented
  at 44 px.
- **Approve lives in the summary card** (primary placement: Approve plan + Reject under the
  stats). The floating action bar appears only after the summary card scrolls out of view
  (IntersectionObserver) and must keep total bottom chrome ≤ 20 %; on iPhone SE it is a single
  compact row (Approve plan primary + Reject icon button).
- Summary stats: short labels that never truncate ("Hours", "Cost", "Short windows" → "Gaps").
- **Phones: rota as shift cards** (one per person: avatar, name, role, time range, a slim 08–21
  timeline bar with task segments, task letters legend, tap → profile). The full grid board stays
  from 768 px up. Coverage on phones: a compact need-vs-scheduled bar chart where only the
  short windows are tappable chips (44 px), not 21 px hour cells.
- "Where we're short" becomes the dedicated gap list (per gap: time, missing, reason, action
  "Fix with replan").
- Suggested-question chips in Ask: 44 px.

### Today, shell, sheets (owner: Shell agent)
- "Write with AI" and any button/chip ≥ 44 px on phones.
- **Motion polish (the "nothing abrupt" brief):** a 160 ms cross-fade + 4 px rise when switching
  tabs; sheets slide with a soft spring and the page behind dims smoothly; list items that are
  approved animate their state change (check fills, row fades to "Handled") instead of jumping;
  toasts slide. All disabled under `prefers-reduced-motion`.
- Decision sheet: chips/buttons ≥ 44 px, consistent header with Products sheet.
- Fix all three axe contrast violations wherever they are.

## Process

Each agent: implement → run `e2e/design-qa.spec.ts` + its behaviour specs on all four projects →
read every QA screenshot in `e2e/screens/qa/` for its screens → iterate until the QA spec passes
and the screenshots hold up next to Shopify admin / Linear. Then the design lead reviews all
screenshots before anything goes to production.
