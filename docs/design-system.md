# Avrora Store Assistant: design system v2 ("Quiet professional")

**Yellow theme (v2.2).** Avrora yellow is the brand theme again, on a fixed set of surfaces: the
summary price tag, the active dock tab, the selected day, the "Moved up" highlight, `.edge-yellow`
rows, the focus ring halo and the Undo action on the ink toast. Yellow always carries ink text
(ink on `#FFDE00` is about 14:1) and never appears as body text on white. Everything else stays in
the calm v2 neutrals below. `e2e/design-qa.spec.ts` allows yellow on exactly these surfaces and
fails it anywhere else; the contrast check still runs on every screen.

v1 used Avrora yellow as large surfaces everywhere (tags, active tab, map halos). v2 follows how serious retail and workforce tools look (Shopify Polaris admin,
Linear, Stripe Dashboard, modern rota apps like Deputy): a calm neutral canvas, crisp 1 px
borders, one primary action colour, colour reserved for meaning. Avrora ownership comes from the
**logo mark, the red accent used with restraint, Onest typography and the precise rota board**,
not from painting things yellow.

## Colour

| Token | Hex | Job |
|---|---|---|
| `--canvas` | `#F6F6F7` | App background. |
| `--surface` | `#FFFFFF` | Cards, lists, sheets. |
| `--surface-2` | `#FAFAFA` | Subtle inset (table headers, hover, inputs). |
| `--border` | `#E4E4E7` | 1 px borders on cards and inputs; dividers `#EDEDEF`. |
| `--text` | `#18181B` | Primary text and primary buttons (zinc-900). |
| `--text-2` | `#52525B` | Secondary text (≥ 4.5:1). |
| `--text-3` | `#71717A` | Tertiary/meta (≥ 4.5:1 on white). |
| `--brand` | `#E30613` | Avrora red. Logo, the active tab indicator, at most ONE small accent per screen (e.g. today's dot). Never large fills. |
| `--critical` | `#DC2626` / bg `#FEF2F2` | Running out, short of staff, alerts. |
| `--warning` | `#B45309` / bg `#FFFBEB` | Late, overstocked, upcoming. |
| `--success` | `#15803D` / bg `#F0FDF4` | Approved, covered, done. |
| `--neutral` | `#3F3F46` / bg `#F4F4F5` | Draft, note, neutral states. |
| `--yellow` | `#FFDE00` | Brand theme: logo, summary price tag, active dock tab, selected day, highlights. Always with ink text. |

Status = soft tinted background + darker text + icon (Polaris badge style), small, never big
blocks. Charts: zinc for bars, `--text` for lines, red only for shortfall. Map: data colours stay;
UI controls are neutral (white cards, zinc borders, near-black selected state). No yellow halos.

## Type

- **Onest** for everything (400/500/600). Scale 13 / 14 / 15 / 17 / 20 / 24 / 30.
  Screen title 26 (phone) / 28 (desktop) semibold, tracking -0.02em. Key figure 30 semibold.
- Unbounded is retired from the UI (too loud).
- Sentence case; no all-caps; minimal "·" strings; proportional figures except in number columns.

## Surfaces and elevation

- Card: white, 1 px `--border`, radius 12, shadow `0 1px 2px rgba(16,24,40,.04)`. Lists inside a
  card use dividers, never nested cards.
- Floating (tab bar, action bar, sheets, map cards, popovers): white, 1 px border, shadow
  `0 8px 24px rgba(16,24,40,.08), 0 2px 6px rgba(16,24,40,.04)`.
- Radius 12 cards, 10 inputs/buttons, 999 only for badges/avatars/segmented thumbs.
- Spacing 4/8/12/16/20/24/32. Phone side padding 16; desktop content max 1120, two columns ≥ 1024.

## Components

- **Buttons:** primary = `--text` fill, white text, radius 10, 44 px (48 on phones); secondary =
  white, 1 px border, `--text`; tertiary = text button. Destructive = `--critical` text.
- **Badges:** 22 px pill, tinted bg + coloured text, 12–13 px medium, with a 6 px dot or icon.
- **Segmented control / tabs:** zinc-100 track, white selected segment with soft shadow. Day
  picker: compact cells "Mon / 2"; selected = yellow fill, ink text; today has a red dot.
- **Summary header** (replaces the yellow tag): no fill, sits on the canvas or in one white card:
  context line, key figure (30 semibold) + short sentence, a row of 2–4 stats, primary action.
- **Tab bar:** white floating bar, border + shadow; icons zinc-500; active = `--text` icon and
  label plus a small red indicator (3×16 bar above the icon). No filled pill.
- **Action bar** (Approve/Reject): white floating bar directly above the tab bar.
- **Inputs:** white, 1 px border, radius 10, 16 px, focus = border `--text` + 3 px ring rgba(24,24,27,.12).
- **Rota board:** shift bars radius 6 in zinc-800 with task segments in a neutral accessible scale
  (zinc-800, zinc-500, zinc-300, white+border; red only for shelter), letters inside; short hours =
  red-tinted column with red figures; current time as a thin red line.

## Writing, motion, quality floor

Plain short copy; motion only in response to touch; reduced motion respected; iPhone SE first;
44 pt targets; 16 px inputs; safe areas; nothing behind the bottom zone; no chip wrapping;
contrast ≥ 4.5:1; no gradients; no card-in-card; no decorative colour; yellow only on the theme surfaces listed at the top.


## Shared building blocks (from v1; restyle to v2 tokens, keep names)

### Screen header usage

`import { ScreenHeader } from "@/components/ScreenHeader"`:
`<ScreenHeader title="Team" date="Monday 2 November" action={<button className="btn-text">Week view</button>} />`.
It renders the 24 px Avrora mark, the `h1` in Unbounded (28/34 phone, 34/40 from 768 px) and the
optional date line above it. `action` sits on its own row under the title on phones and to the
right on wide screens; keep it a `.btn-text` or an icon button, never a filled button.
`back` takes a back link for sub-screens. The phone compact bar appears only after the title has
fully scrolled under it, so the two never overlap.

Shared classes in `globals.css`: `.flat-list` (paper, radius 14, no shadow; rows use `.cell` for
hairlines), `.section-head > h2` (17/22 semibold, sentence case), `.btn-text` (ink text button,
44 px target), `.btn-tag` (small ink pill for use on the yellow tag), `.type-glyph` (10 px coloured
square for an action type; add `data-outline` for Chase delivery), `.tag-bar` (slim ink progress
bar on the tag: `<div class="tag-bar"><span style="width:60%"/></div>`).

### Bottom zone usage

A screen-level action bar (Approve plan / Reject, Save, Order) uses `.action-zone`:

```tsx
<div className="action-zone" role="region" aria-label="Plan actions">
  <span className="t-subhead min-w-0 flex-1 truncate">Draft, 2 gaps</span>
  <button className="btn-ghost min-h-[48px]">Reject</button>
  <button className="btn-ink min-h-[48px]">Approve plan</button>
</div>
```

- It is `position: fixed`, docked directly above the tab bar (`bottom: var(--nav-clear) + 8px`),
  same width rules as the dock (12 px side gutters, max 400 px on phones, 520 px from 768 px),
  paper background, pill radius and the `.float` shadow. Safe areas come through `--nav-clear`.
- Inside: one short status line (optional) and at most two buttons, primary last (`.btn-ink`).
  Labels say what happens. Never put a second action zone on a screen.
- Put `.pb-action` on the screen's root element whenever the action zone is shown, so the last
  row scrolls fully clear of it (padding = tab bar + action zone + 24 px).
- When a side panel is open on desktop (`lg:right-[400px]` on the dock), shift the zone the same
  way, e.g. `lg:right-[412px]`.
- Render it only when there is something to do; hide it while a sheet covers the screen.

### More shared classes

- Figures: `.num` = lining, proportional figures (Onest's tabular "1" leaves gaps). Use `.num-col`
  (tabular) only for right-aligned number columns. `.tag-figure` is proportional.
- `.list-paper`: paper, radius 14, overflow hidden (same as `.flat-list`).
- `.chip` with `aria-pressed="true"` (or `aria-selected`): ink outline chip, ink fill + white
  text when active; 44 px tall, never wraps.
- `.text-filter`: text-only filter; the active one gets a 3 px ink underline.
- `.timeline`: vertical rule with an ink dot per child.
- `.edge-yellow`: 6 px yellow left edge for the one highlighted row.
- `.scroll-row`: horizontal chip scroller (snap, no scrollbar, right-edge fade on phones).

## v2 class reference (globals.css; names kept from v1, restyled)

- `.price-tag`: the summary header. White card, 1 px border, radius 12, xs shadow, 20/24 padding. No fill, no hole.
- `.tag-figure`: key figure, Onest 30/36 semibold, -0.02em. `.tag-bar`: 4 px zinc-200 track, zinc-900 fill.
- `.btn-ink` primary (zinc-900, radius 10, 48 phone / 44 desktop); `.btn-ghost` secondary (white, 1 px border);
  `.btn-text` tertiary; `.btn-tag` small secondary (36 px, white + border) for use inside a summary card;
  `.btn-danger` add-on for destructive text.
- `.card`, `.group-list`, `.flat-list`, `.list-paper`: white, 1 px `--border`, radius 12, xs shadow. Rows use `.cell` (1 px dividers).
- `.float`: 1 px border + floating shadow (`--shadow-float`). Also `--shadow-xs`.
- `.chip` (white + border, radius 10; `aria-pressed/selected="true"` = zinc-900 fill), `.text-filter` (2 px zinc-900 underline when active).
- `.segmented` (zinc-100 track) + `.segmented-thumb` (white, soft shadow).
- `.badge` + `.badge-critical | .badge-warning | .badge-success | .badge-neutral`: 22 px pill, tinted bg, 6 px dot (`data-nodot` hides it).
- `.edge-accent`: 3 px zinc-900 left edge. `.edge-yellow`: 6 px yellow left edge (theme).
- Yellow theme overrides (end of globals.css): `.price-tag` yellow fill with ink text and a floor-coloured hole, `.tag-figure` 44/56 display, `.btn-tag` ink pill, `.dock` ink bar with a yellow active pill.
- `.type-glyph`: 8 px neutral square. `.timeline`: 1 px rule, zinc-400 dots. `.scroll-row` unchanged.
- `.action-zone`: white floating bar (border, radius 14) above the tab bar. `.dock`: white floating bar; put `aria-current="page"` on the active `.dock-item` for the ink colour + red 3x16 indicator.
- `.nowrap`: keep time ranges ("09:00–13:00") on one line.
- `.t-large-title`: 26/32 phone, 28/34 desktop, semibold Onest.
