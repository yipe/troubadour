# Design system

The look is DPRcalc's dark theme, rebuilt on Tailwind v4 and `@base-ui/react`. The specs are in
`docs/design/troubadour-redesign/README.md`. This file says how they become code and where each piece lives.

## Shared with DPRcalc (`@yipe/tokens`)

The handoff's token table matches DPRcalc's dark theme value for value
(`~/src/dpr/packages/ui/src/theme/tokens.css`: canvas `#14151e`, surface `#1a202c`, accent `#90cdf4`, the
class colours `color-mix(in oklch, <base> 70%, white)`…). So the two apps should share one source of colour
truth instead of keeping two copies in sync by eye.

**What is shared:** things with no UI framework in them.
- `tokens.css`: the CSS custom properties, using DPRcalc's exact names (`--color-bg-canvas`,
  `--color-fg-muted`, `--color-class-bard`, `--color-rarity-legendary`…). It covers all three themes
  (`:root`/`[data-theme='dark']`, `light`, `midnight`). It includes only the generic groups: gray/blue/
  red/green/orange/purple primitives, bg, fg, border, accent, status (success/danger/warning/info),
  rarity, chart series, tooltip, subtle badge, skeleton, class base and class resolved colours (SRD classes only). It leaves
  out DPRcalc-only groups (charsheet, marketing, editor, box, stat, damage, json-code-input).
- `classes.ts`: `CLASS_NAMES` (the 12 SRD classes), `CLASS_BASE_COLORS`, `classColorVar(cls)` →
  `"var(--color-class-bard)"`. DPRcalc also has an artificer colour; the sync drops it, because the artificer
  isn't in the SRD and this repo commits only SRD names (AGENTS.md rule 5). Instead, classes are a list the app
  loads (C1): the SRD ones built in, plus any the user adds in the app (stored in their data dir, like the local
  `dnd_terms.json`). A custom class carries its own colour, picked from the same swatch palette.
- `rarity.ts`: rarity names → `var(--color-rarity-*)`.
- `palette.ts`: the swatch palette (DPRcalc's `POST_CHART_PALETTE`: hues × light/medium/dark, with
  names). Troubadour uses it for a player's custom colour.

**How (now):** `web/packages/tokens` is a workspace package named `@yipe/tokens`. Its files are
**generated** from a DPRcalc checkout by `pnpm -C web/packages/tokens sync` (reads `$DPR_DIR`, default
`~/src/dpr`). The script keeps the allow-listed groups, drops comments, and writes `SOURCE.md` with the
DPRcalc commit it came from. A test checks that every token Troubadour uses exists in all three themes,
and that `CLASS_BASE_COLORS` equals the `--class-*-base` values in `tokens.css`. CI never needs DPRcalc:
the generated files are committed.

**Later (owner, outside this DAG):** publish it the way `@yipe/dice` is published:
1. New public repo `yipe/tokens`. Move the generated files there as the source, then publish `@yipe/tokens`.
2. DPRcalc: `tokens.css` does `@import "@yipe/tokens/tokens.css"` and keeps only its app-only groups.
   `classColors.ts` and `postChartPalette.ts` re-export from the package.
3. Troubadour: replace the workspace package with the npm dependency and delete the sync script.

**Not shared, on purpose: React components.** DPRcalc is Chakra v3 (style props, `system.ts`).
Troubadour is Tailwind + base-ui. A component shared between them would have to drag one stack into the
other. The one real candidate is the swatch picker: both apps have one (DPRcalc's chart rail, Troubadour's
player colour). When the package is published, add a stack-free `SwatchGrid` to it: plain React, inline
styles, `var(--color-*)` only, with the popover left to the host. Until then, Troubadour's
`ColorSwatchPicker` (U2) reads the same palette data, so both pickers offer the same colours.

**Public repo note:** this repo is public. The generated files carry values only. No comments naming
where a colour came from, and class names are the SRD ones.

## Tailwind mapping (`@troubadour/ui/theme.css`)

`theme.css` imports `@yipe/tokens/tokens.css` and registers short utility names with `@theme inline`, so
utilities resolve to the shared variables at runtime. The short keys must not reuse a `--color-*` name
from `tokens.css`; reusing one would make the variable refer to itself.

| Utility key | Token | Dark value |
|---|---|---|
| `canvas` / `surface` / `sunken` / `elevated` | `--color-bg-canvas` / `-surface` / `-subtle` / `-elevated` | `#14151e` / `#1a202c` / `#171923` / `#2d3748` |
| `ink` / `ink-muted` / `ink-subtle` / `ink-on-accent` | `--color-fg-default` / `-muted` / `-subtle` / `-on-accent` | `#edf2f7` / `#cbd5e0` / `#a0aec0` / `#fff` |
| `line` / `line-subtle` / `line-strong` | `--color-border-default` / `-subtle` / `-strong` | `#2d3748` / `#171923` / `#4a5568` |
| `accent` / `accent-strong` / `accent-soft` | `--color-accent-fg` / `-emphasis` / `-subtle` | `#90cdf4` / `#3182ce` / `rgba(66,153,225,.15)` |
| `success` / `success-soft` / `success-faint` | `--color-success-fg` / `-bg` / `-subtle` | `#68d391` / 12% / 6% |
| `warning` / `warning-soft` / `warning-faint` | `--color-warning-*` | `#f6ad55` / 12% / 6% |
| `danger` / `danger-soft` / `danger-faint` | `--color-danger-*` | `#fc8181` / 12% / 6% |
| `info` / `info-soft` / `info-faint` | `--color-info-*` | `#63b3ed` / 12% / 6% |
| `badge` / `badge-ink` | `--color-subtle-badge-bg` / `-fg` | `#2d3748` / `#e2e8f0` |
| `popover` / `popover-line` | `--color-tooltip-bg` / `-border` | `#181d28` / `#4a5568` |
| `legendary` / `very-rare` / `rare` / `uncommon` | `--color-rarity-*` | `#ffb62a` / `#c364e7` / `#41a9f2` / `#7ebe15` |

Examples: `bg-surface border border-line rounded-card`, `text-ink-subtle`, `bg-success-soft text-success`.
Class and player colours are data, not utilities. Pass them as a CSS variable:
`style={{ "--player": playerColor(p) }}` with `text-(--player)` and `bg-(--player)/22`.

Other theme values:
- **Type:** `--font-sans` system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial,
  sans-serif`); `--font-serif` `Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, serif` (page,
  card and table titles); `--font-mono` `ui-monospace, Menlo, monospace` (timestamps, paths). Size scale
  in px, replacing Tailwind's: `text-11 12 13 14 15 16 18 20 22 24 26 30 32 34`. Body `text-14`, line
  height 1.45. Weights 500/600/700.
- **Radius:** `rounded-badge` 4, `rounded-control` 6 (buttons, inputs, list items), `rounded-card` 8,
  `rounded-dialog` 12, `rounded-full` (pills, avatars).
- **Shadow:** `shadow-popover` `0 24px 60px -16px rgba(0,0,0,.75)`. The live speaker glow
  `0 0 18px -4px var(--player)` is the one inline shadow.
- **Spacing:** Tailwind's 4px grid as is.
- **Dark only.** `<html data-theme="dark">`. The tokens carry light and midnight, but the app ships
  neither until an Appearance setting exists (deferred).

## Component catalogue

**Rule of two:** a component is shared only once two pages use it. Everything below has two or more users.
The *Page-local* list names things that look reusable but have one user. They stay in their page folder
until a second user appears; the task that adds that second user moves the component and says so.

### `@troubadour/ui` (no domain knowledge)

| Component | Task | API sketch | Users |
|---|---|---|---|
| `Button` | U1 | `variant: primary\|secondary\|ghost\|danger\|warning\|link`, `size: sm(28)\|md(32)\|lg(38)\|xl(48)`, `icon` | everywhere |
| `Badge` | U1 | `tone: neutral\|accent\|success\|warning\|danger\|info\|legendary` | confidence, status, types, cloud |
| `StatusDot` | U1 | `tone`, `pulse` | nav, live, history, cloud, models |
| `Card`, `CardHeader`, `CardBody` | U1 | header: `title` (serif), `meta`, `action` | home, ready, settings, sessions, cloud |
| `PageHeading` | U1 | `eyebrow` (link-coloured), `title` (serif), `subtitle`, `actions` | every page |
| `SectionLabel` | U1 | 12px, 700, uppercase, 0.08em | rails, settings, review |
| `Avatar` | U1 | `initials`, `color` (CSS value), `size: 24\|30\|36\|44`, `src` | via `PlayerAvatar` |
| `Spinner` | U1 | | jobs, ask, buttons |
| `Input`, `Textarea`, `SearchInput`, `NativeSelect`, `Switch`, `Checkbox`, `Slider`, `Field` | U2 | `Field`: `label`, `hint`, `error` | forms everywhere |
| `ColorSwatchPicker` | U2 | `value`, `onChange`, `palette` from `@yipe/tokens/palette` | players table (wizard + settings); the DPRcalc pair |
| `Dialog` | U3 | `size: md(640)\|lg(900)` | connect, end session, tools, train, edit |
| `ConfirmDialog` | U3 | `title`, `body`, `confirm`, `tone` | start anyway, delete, merge, disconnect, restore |
| `Popover`, `Tooltip`, `DropdownMenu`, `Command` | U3 | | cloud chip, voices, export, account, entity picker |
| `Toaster`, `notify()` | U3 | `notify(text, { undo?, tone? })` | dismiss, ignore, voice assigned, pinned |
| `RailLayout` | U4 | `rail` (width 250–380), `main`, `aside?` | facts, codex, sessions, settings, live, review, recap |
| `NavItem` | U4 | `selected`, `count`, `icon`, `dot`, `sub` | rails everywhere, wizard steps |
| `UnderlineTabs` | U4 | `items: {id,label,count?,dot?}[]` | top nav, notebook |
| `PillGroup` | U4 | `items: {id,label,count}[]`, single-select | review filters, codex type chips |
| `SegmentedBar`, `SegmentedLegend` | U4 | `segments: {value,color,label}[]`, `height` | talk share (home, sessions, timeline), storage |
| `Chip` | U4 | `tone`, `dashed`, `onClick`, `onRemove` | heard-as, aliases, new faces, guests |
| `Table`, `THead`, `TH`, `TR`, `TD` | U4 | zebra rows, serif headers | facts, codex facts, scenes, timeline, players |
| `Progress` | U4 | `value`, `tone` | review, jobs, train |
| `EmptyState` | U4 | `icon`, `title`, `body`, `action` | every list |
| `IconTile` | U4 | rounded square with an icon | settings rows, cloud, review banner |

### `app/src/components/` (Troubadour domain, two or more pages)

| Component | Task | Users |
|---|---|---|
| `PlayerAvatar`, `SpeakerName` (name in player colour + "as NPC") | S3 | home, live, review, transcript, facts, codex, ask, recap, ready, players |
| `TalkShareBar` (+ legend; from `talk` seconds) | S3 | home, sessions, timeline |
| `ConfidenceBadge`, `TypeBadge`, `EntityLink`, `FactText` (renders `[[links]]`) | S3 | home, live, review, facts, codex, timeline, ask |
| `TimestampLink`, `useSessionAudio` | S3 | home, facts, codex, ask, review, live, transcript |
| `TranscriptLine`, `TranscriptList` (virtualized, `renderAside`, highlight) | S4 | live, review, transcript |
| `SuggestionCard` (kind label, badge, text, struck old text, who/time, action slot) | S5 | live notebook, review |
| `AskAnswer` (serif answer, citation marks, numbered source rows) | S5 | live ask bar, ask page |
| `FactsTable` (fact, about?, said by, source, how sure, history row) | S5 | facts, codex |
| `JobStatus` (bar, steps, live tokens, error) | S6 | sessions (write-up), import notes, codex (look for facts), recap, players (clones) |
| `MicCard` (device, 48-bar meter, checklist, test) | S7 | ready, wizard, settings › microphone |
| `PlayersTable`, `TrainDialog` | S8 | wizard, settings › players |
| `ModelsSettings` | S9 | wizard (AI & privacy), settings › models |
| `ImportNotes` | S10 | wizard (existing notes), settings › vault |
| `ConnectDialog`, cloud status helpers | S12 | cloud chip, settings › cloud |
| `ReadAloud` | S14 | ready (Previously on…), recap |

### Page-local (one user: don't share)

`StatTile` (sessions), `ModelTiles` and `WhoIsHere` (ready), `StepRail` (wizard), `Kbd` and `PendingVoiceCard`
(live), `TravelLine` (timeline), `AppearancesChart` and `ConnectedList` (codex), `RecapCard` (recap),
`WhatLeavesList` and `StorageBar` (settings › models), `BackupHistory` (settings › cloud), `ScenesTable`
(sessions).
