# Avrora Store Assistant: design system ("Shop floor")

The app belongs to Avrora, not to Apple and not to a SaaS template. Its look comes from the store
itself: the **yellow fascia** with the red logo, the **yellow shelf price tag** with a big black
figure, and the **shift rota board** in the back office. A manager on the shop floor reads it
at arm's length, one-handed, in a hurry, sometimes in a blackout on a dim phone.

## Palette (only these; no blue, no purple, no gradients)

| Token | Hex | Job |
|---|---|---|
| `--yellow` Avrora yellow | `#FFDE00` | The fascia. Hero tag surface, active tab, the one highlight per screen. Never text. |
| `--ink` Ink | `#000000` | Text, icons, primary buttons (black fill, white text), the tab bar. |
| `--red` Signal red | `#D9140E` | Brand red, used ONLY for urgency: running out, short of staff, alerts, gaps. Never decoration. |
| `--green` Stock green | `#0A7A3A` | Done / approved / covered. |
| `--floor` Floor | `#F2F2EE` | App background (shop-floor tile, neutral, not cream). |
| `--paper` Paper | `#FFFFFF` | Sheets and lists. |
| `--rule` Rule | `#E2E2DC` | Hairlines between rows. |
| `--muted` Muted ink | `#5C5C57` | Secondary text (≥ 4.5:1 on paper and floor). |
| `--orange` Late | `#B54708` | Warnings that are not urgent (late, overstocked). Text-safe on paper. |

Status always pairs a colour with an icon and a word. Action types: Reorder = red, Mark down =
orange, Move to front = ink, Chase delivery = ink outline. Categories on the map keep their own
colours (that's data, not chrome).

## Type

- **Onest** (Cyrillic + Latin, 400/500/600/700): all UI text. Body 17/24, secondary 15/20, small 13/18.
- **Unbounded** (700, wide): only for *figures that matter* (the hero number on a tag, prices in
  a product header, the hour labels of the rota board's big times) and the screen title.
  Never for paragraphs, never more than one Unbounded figure group per view region.
- Sentence case everywhere. No ALL-CAPS labels, no tracked-out eyebrows. Day pickers read
  "Mon 2", not "MON". Avoid "A · B · C" strings; use two lines or a real separator of meaning.
- Tabular numbers for every figure (`font-variant-numeric: tabular-nums`).

## Shape and elevation

- Radius: 14 px for sheets/lists, 999 px for buttons, chips and the tab bar, 6 px for small tags.
- **Only things that float have a shadow**: the tab bar, bottom action bar, sheets, map cards.
  Lists and sections sit flat on the floor (paper + hairline rules), no drop shadow, no border.
- One spacing scale: 4 / 8 / 12 / 16 / 24 / 32. Screen side padding 16 (phone), 24 (≥ 768).

## The signature: the price tag

Each main screen opens with **one yellow tag**: a yellow block (radius 14) with a small punched
hole at the top-left (8 px circle in `--floor`), the key figure big in Unbounded black, a one-line
plain sentence under it, and at most one black action button. It answers "what matters now":
- Today: "5 to decide · ₴19,191 at stake" (figure: 5) + progress of decisions.
- Team: coverage of the day ("90%" figure, "2 gaps: 09–11 and 17–20"), status Draft/Approved, Approve.
- Products: "20 need attention" figure.
Everything else on the screen is quiet: paper lists with hairlines, ink text.

## Navigation and bottom zone

- Tab bar: **black pill** (`--ink`), icons/labels white at 70% opacity; the active tab is a
  **yellow pill** with black icon + label. This is the brand mark of the app in daily use.
- One bottom zone: a screen-level action bar (e.g. Approve plan / Reject) docks **directly above**
  the tab bar as one stacked unit, never floating over content. Scroll padding = tab bar +
  action bar + 16 px, so nothing ever ends behind them.
- Screen header: Avrora mark (24 px) + screen title in Unbounded 28/32 (phone), secondary actions
  as an icon button or a text button on its own line under the title — never crowding the title.

## Rota board (Team)

The Team screen's main visual is a shift board, not a chart in a card: rows = people
(initials avatar + name + role), x = hours 08–21 with hour ticks, each shift a black bar with
task segments in tints of ink and yellow, gaps shown as red hatched cells in a "Short" row on
top, and a "Need vs on shift" step strip above the rows. Tapping a bar opens the person.

## Motion

Only in answer to touch: tab pill slides, sheets rise, an approved row ticks green. No entrance
animations on load. Respect `prefers-reduced-motion`.

## Writing

Plain, short, the manager's words: "Approve plan", "Someone's off sick", "2 people short at 17:00".
Buttons say what happens. Errors say how to fix it. "Demo data" appears once per screen, small.

## Quality floor (check every screen, iPhone SE 375×667 first, then 1440)

- 44 pt targets, 16 px+ inputs, safe areas, nothing behind the bottom zone, no horizontal scroll
  except chip rows, no text wrapping inside chips, no truncated names that matter.
- Contrast ≥ 4.5:1 for text (never text on yellow lighter than ink; never red text on yellow).
- No blue anywhere. No purple anywhere. No card-in-card. No shadow on flat lists.

## Screen header usage

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

## Bottom zone usage

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

## More shared classes

- Figures: `.num` = lining, proportional figures (Onest's tabular "1" leaves gaps). Use `.num-col`
  (tabular) only for right-aligned number columns. `.tag-figure` is proportional.
- `.list-paper`: paper, radius 14, overflow hidden (same as `.flat-list`).
- `.chip` with `aria-pressed="true"` (or `aria-selected`): ink outline chip, ink fill + white
  text when active; 44 px tall, never wraps.
- `.text-filter`: text-only filter; the active one gets a 3 px ink underline.
- `.timeline`: vertical rule with an ink dot per child.
- `.edge-yellow`: 6 px yellow left edge for the one highlighted row.
- `.scroll-row`: horizontal chip scroller (snap, no scrollbar, right-edge fade on phones).
