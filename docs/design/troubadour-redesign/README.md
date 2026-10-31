# Handoff: Troubadour redesign (DPRcalc style)

## Overview
A full redesign of the Troubadour web UI (`yipe/troubadour`, `web/src/`) covering the whole campaign lifecycle: first-run setup, pre-session checklist, the live session, asking questions in a session, post-session review, the codex, facts (with sources, confidence and history), session history, the campaign timeline, a recap to share with players, models and privacy, and Troubadour Cloud backup plus a read-only player view. The visual language comes from **DPRcalc UI** (`@yipe/ui-design`, Chakra v3, dark theme).

## About the design files
The files in this bundle are **design references built in HTML**: prototypes that show the intended look and behavior. They are not production code to copy. The task is to **recreate these designs in the existing Troubadour web app** (React 19, Vite, Tailwind v4, shadcn/ui, lucide-react), following its patterns (`AGENTS.md`, `web/AGENTS.md`): API contract in `lib/types.ts`, the campaign write queue in `lib/campaignStore.ts`, virtualized transcripts, and so on.

Open `Troubadour Redesign.dc.html` in a browser to see every screen on one pannable canvas. Each `Screen *.dc.html` also opens on its own at 1440×900. The `.dc.html` files need `support.js`, `data.js` and the `_ds/` folder next to them, and an internet connection for icons (lucide-static from unpkg).

## Fidelity
**High fidelity.** Colors, type, spacing, radii and copy are final. Recreate them closely using the codebase's own primitives (shadcn components restyled to these tokens). Mock data (The Sunken Crown, Pip, Orsa Vell…) is illustrative only.

### Recommended approach to styling
Keep shadcn/Tailwind. Remap the CSS variables in `web/src/index.css` (`.dark` block) to the DPRcalc tokens listed under *Design tokens* below, and make dark the default. Do **not** introduce Chakra unless you decide to adopt `@yipe/ui-design` wholesale. Mapping:
- `--background` → bg.canvas `#14151e`; `--card`, `--popover` → bg.surface `#1a202c`; `--muted`, `--secondary` → bg.subtle `#171923`; `--accent` → bg.elevated `#2d3748`
- `--foreground` → fg.default `#edf2f7`; `--muted-foreground` → fg.subtle `#a0aec0` (secondary text uses fg.muted `#cbd5e0`)
- `--border`, `--input` → border.default `#2d3748`; `--ring` → accent.emphasis `#3182ce`
- `--primary` → accent.emphasis `#3182ce` with white text; links use accent.fg `#90cdf4`
- `--destructive` → danger.fg `#fc8181`
- `--radius` → 6px (cards 8px, dialogs 10–12px, pills 999px)

## Information architecture
Top nav (`Troubadour Nav.dc.html`, replaces the header in `App.tsx`), 56px tall, bottom border border.default:
- Left: feather icon (accent.fg) + "Troubadour" wordmark (Georgia 18px bold), then the campaign switcher (a 32px button on bg.surface with a class-colored square, campaign name, chevrons-up-down).
- Tabs: **Home · Sessions · Timeline · Codex · Facts · Ask**. Underlined-tab style: 14px; active is fg.default, weight 600, with a 2px accent.emphasis underline; inactive is fg.subtle. Sessions shows a red dot while recording.
- Right: a recording pill when live (danger.bg, "RECORDING" 12px bold with 0.06em tracking, plus tabular elapsed time); the cloud backup chip (see 2b); "On this computer · AI ready" status (opens Models); account avatar.

Player identity: **each player's color is their D&D class color** (`--color-class-*`), and the GM uses `class-paladin`. Avatars are 30–36px circles: a 22% tint of the color with a 1.5px inset ring and initials in the color. The same color is used for transcript names, talk-share bars, facts' "said by", and recaps.

Fact model (new): every fact carries **about** (an entry), **said by** (player or NPC voice), a **source** (session + timestamp, clickable to play or jump), **how sure** (`GM stated` success, `Party theory` warning, `Heard once` neutral), and a **history** (older versions struck through).

## Screens
IDs match the badges on the canvas.

| ID | File | Screen | Builds on |
|---|---|---|---|
| 1a | Screen Setup | New-campaign wizard, step 2 "Who's at the table?" | setup/SetupView, PlayerCard, CampaignSwitcher |
| 1b | Screen Home | Campaign hub | new |
| 1c | Screen Lobby | Pre-session ready check | setup/StartPanel, audio/MicTest, MicDetails |
| 1d | Screen Live A | Live, balanced (alternative) | session/* |
| 1f / 3a | Screen Live C / **Live Prototype** | Live with "Tonight's notebook" (**chosen**) | session/*, VoicesPanel, AskPanel |
| 1g | Screen Ask Overlay | Asking a question mid-game | campaign/AskPanel |
| 1h | Screen Review A | **Chosen** review: notes beside each transcript line | SuggestionsCard, EntityEditor, WriteUpButton, SessionViewer |
| 1i, 1j | Screen Review B / C | Review alternatives | same |
| 1k | Screen Facts A | Facts table with left filter rail and history | FactList, CampaignFacts |
| 1l, 1m | Screen Facts B / C | Facts timeline, facts by entry | same |
| 1n | Screen Codex | Codex entry page | CampaignView, GlossaryList, EntityEditor |
| 1o | Screen History | Session history | history/HistoryView, SavedSessionRow |
| 1p | Screen Recap | Recap to share with players | WriteUpButton, clone/ReadAloud |
| 1q | Screen Settings | Models & privacy | ModelsDialog |
| 1r | App Icons | Icons; **Listening die (d20) chosen** | site/favicon.svg |
| 2a | Screen Cloud Connect | First connect to Troubadour Cloud | CloudBackupButton |
| 2b | Screen Cloud Popover | Everyday cloud status popover | CloudBackupButton |
| 2c | Screen Cloud Settings | Cloud settings, history, restore | CloudBackupButton, cloudStore |
| 3b, 3c | Screen Timeline A / B | Timeline alternatives | new |
| **4a** | Screen Timeline C | **Chosen** timeline: "The story so far", vertical | new |
| 3d | Screen Cloud Player | Troubadour Cloud player web view | new (cloud service) |

Decisions from the user: one person runs the app on a laptop (no shared table screen). The live session is **1f** and the review is **1h**. The timeline is the **vertical story so far (4a)**. The app icon is the **Listening die**. The cloud is **backup only**, from one main computer, and the newest backup wins. Changed facts are **updated and keep their history**. Ask only **answers with sources** (no saving answers as facts).

### Common page shell
- Page: bg.canvas. Body text is the system sans stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`) at 14px with line-height 1.45.
- Headings, titles and table headers use the DPRcalc heritage serif `Georgia, 'Iowan Old Style', 'Palatino Linotype', Palatino, serif` in bold. Page titles use `PageHeading` styling (in the DS, 24px accent-blue serif).
- Section labels: 12px, weight 700, uppercase, 0.08em tracking, fg.subtle.
- Cards and panels: bg.surface, 1px border.default, radius 8px, padding 12–20px.
- Rails: 250–380px wide, border-right border.default. Selected item: bg.surface plus `inset 0 0 0 1px` accent.emphasis, radius 6px, padding 8–10px 12px.
- Buttons: 32–38px tall, radius 6px, 13px weight 600. Primary: accent.emphasis with white text. Secondary: transparent or bg.surface with a border.default border. Destructive: danger.bg with danger.fg text.
- Badges: 12px, weight 600, padding 1–2px 7–8px, radius 4px, in the status bg/fg pair.
- Timestamps: `ui-monospace, Menlo, monospace` 12px, fg.subtle; as links, accent.fg.

### 1a Setup wizard
Left 300px step rail (Campaign ✓, The table [current], Microphone, Existing notes, AI & privacy), each with a 24px numbered circle: done is success.bg ✓, current is accent.emphasis, upcoming has a border.strong ring. Footer note: "Everything here stays on this computer unless you choose a hosted model in step 5."

Main area (padding 36px 56px): a "STEP 2 OF 5" label, H1 "Who's at the table?" (Georgia 30px), and an explainer. An info banner (accent.subtle bg, accent border at 40%) reads "3 players from Lantern Road already have trained voices." with an "Add Sam, Jo and Rin" button.

Player table, columns `52px 1.1fr 1.3fr 1fr 80px 220px`: avatar | Player input | Character input | Class select (with a class color dot) | Role (GM in paladin color) | Voice. The Voice cell shows a status icon and label (circle-check "Trained" in success.fg, or circle-dashed "Learns in play"), then a 28px outline button with audio-waveform labelled **Retrain** (or **Train** if untrained). The table ends with a dashed "+ Add player" row. Footer: Back / "Continue to microphone →".

### 1b Home
PageHeading with the campaign name, a stats line (sessions, hours, entries/facts, vault path), and the buttons "Ask the campaign" and primary "Prepare session 13".

Three columns (1.35fr / 1fr / 1fr):
- **Last session card:** Georgia 24px title, recap paragraph, a talk-share bar (8px, segment per player), legend, and "Open transcript" / "Previously on… recap" buttons. Below it, a **review banner** (warning.subtle bg): "Session 12 is waiting for review · 6 facts · 5 spellings · 3 new entries" with a "Start review" button (warning.fg bg, black text).
- **The table:** players with avatars and voice status.
- **Newest facts:** each fact with who, session/time and its confidence badge.

### 1c Pre-session ready check
Left column, three check cards each with a ✓/! status circle:
1. **Who's here tonight:** pill toggles per player (absent players at 50% opacity, "away tonight"), plus a dashed "+ Guest".
2. **Microphone:** device select, a 48-bar live level meter (success, warning when hot), and a checklist (omnidirectional, level, noise, heard all seats). This replaces MicDetails/MicTest.
3. **Models:** three tiles (Speech to text, Voices, Notes & answers), each with a status dot.

Right 400px column:
- **Start the session** card: working title input; toggles for "Keep the audio recording" and "Fix names as it goes"; a consent checkbox "Everyone here knows they're being recorded."; a 48px primary "Start session" button.
- **Previously on…** card: a Georgia 16px recap with an Edit button.

The current red-check "start anyway?" dialog (StartPanel) still applies.

### 1f / 3a Live session (chosen). See `Live Prototype.dc.html` for working behavior.
Three columns below the nav.

**Left rail (250px):**
- "Session 13" and a status line: "Listening · Jabra Speak 710" in danger.fg, or "Paused · not listening" in warning.fg.
- Speaker list: 30px avatar, name, player, share %, and a 3px share bar. The current speaker's row gets bg.surface and an inset ring in their color.
- A pending voice card (dashed border): "Voice 3 · 4 s heard · who is it?" with quick picks: the top suggestion as an accent chip ("Alex as NPC"), other players, and "Later". Assigning a voice relabels all its past lines (existing `assignVoice`) and shows a toast.
- Bottom: Pause/Resume and End session (danger).

**Center:**
- A 44px scene breadcrumb ("1:12 Saltreach docks › 1:36 Entering the abbey", with the current scene in accent.subtle).
- The transcript, bottom-anchored: a grid with a 64px timestamp column, then **name** (bold, player color), an "as NPC" note in fg.subtle 13px, and the text at 15px with line-height 1.55. Lines from an unnamed voice are italic fg.subtle. Highlighted lines use accent.subtle with an accent inset ring for 2.5s. A "X is speaking…" line sits at the bottom.
- An ask bar, 44px with a border.strong border (accent on focus). Placeholder: "Ask a question (end with ?) or type a note to pin at the current time". Enter submits. Text ending in "?" opens an inline answer panel above the bar: question, a searching state ("Searching 13 transcripts and 214 notes on this computer…"), then the answer with numbered citations and source rows ("1 · quote · Orsa · S13 1:39:30"); clicking a source highlights its line. Anything else is saved as a **Pin** at the current timestamp, the Pins tab opens, and a toast confirms.

**Right "Tonight's notebook" (440px, bg.subtle):**
- Tabs Facts / Names / Pins, each with a count.
- Cards on bg.surface, each with: fact text; said-by dot and name; a timestamp button that jumps to the line; a confidence badge; and **Keep** / **Dismiss** buttons. Dismiss shows a toast with Undo; Keep shows "✓ Kept".
- **Update cards**: an info-colored header "Updates a fact", the old text struck through, then the new text, with a "Keep update" button.
- The Names tab holds new entries ("Add to codex") and spelling fixes ("OK").
- Kept items feed the post-session review.

End session opens a modal: "Session 13 saved", a summary (duration, facts kept, pins), and "Review later from Home". The live view should stay virtualized (react-virtuoso) as it is today.

### 1g Ask during a session
A centered modal (900px) over the live view. Header: the question (20px) and "asked by Sam · 1:42". Answer in Georgia 24px, with quoted phrases highlighted in accent.subtle and superscript citation numbers. Source rows: number, avatar, "who · Session N · time", the quote, and "▶ Play line". Footer: "Answered on this computer in 4 s from 13 transcripts and 214 notes" and "Ask a follow-up". **Answers are not turned into facts.**

### 1h Post-session review (chosen)
Header: "Review · Session 12 · date", title in Georgia 22px, a progress bar ("5 of 14 reviewed", success fill), filter pills (All / Facts / Spellings / New entries with counts), "Accept all GM-stated (3)", and primary "Finish review".

Body: two aligned columns. Left is the transcript (timestamp, name, text at 15px). Right (460px) holds the suggestion for that line, on the same row. A line with an open suggestion gets an accent.subtle background and a 3px accent left border; an accepted one gets a success left border.

Suggestion card:
- Kind label (Fact in accent, Spelling in info, New entry in rarity.veryrare) and "→ Entry name".
- A confidence badge, or "Fixed in N lines" for spellings.
- The text.
- Actions: Accept / Add to codex (primary), Edit, Reject.
- Fact updates follow the same pattern as 3a (old version struck through).

Map onto the existing atomic endpoints: `POST …/review`, `…/ignore`, accept/reject spellings and facts, `NewEntryForm`.

### 1k Facts (table, chosen pattern)
- **Left rail (380px, same styling as 1o):** a top bar with a search input and primary "+ Add fact", then grouped filters, each item showing a count:
  - **About:** Everything, NPCs, Places, Items, Factions, PCs
  - **How sure:** GM stated, Party theory, Heard once (status dots)
  - **Said by:** one per player, class-colored dots
- **Main:** title "Facts", subtitle "389 things that stay true between sessions. Every one links to the moment it was said.", and "Sort: newest session first".
- **Table** (columns `1fr 160px 150px 140px 110px`, Georgia header): Fact | About (name, with type below) | Said by (avatar + name) | Source ("▶ S12 · 1:40:31", plays or opens the line) | How sure (badge). Rows alternate shades.
- **History:** a fact with history shows "Changed once · history open" (history icon, accent). Under it, a bg.subtle block lists versions, current first; older versions are fg.subtle with a strike-through and show who and the session/time.

1l (one entry's facts as a timeline) and 1m (facts grouped by entry, 3 columns) are alternatives. 1m shares the same rail.

### 1n Codex entry
- **Left rail (320px):** search, type chips, a "Needs review N" chip (warning), and an entry list. Items get a legendary color, and a warning dot when they need review.
- **Main:**
  - Georgia 32px name with a type badge, description, aliases, and "Heard as" chips. A pending spelling is a dashed accent chip with ✓/×.
  - Buttons: "Look for more facts", Edit.
  - An appearances bar chart (mentions per session).
  - A facts table: text | said by | source | how sure, plus an add input.
- **Right (300px):** Connected entries with a short reason each, then the vault path and "Open in Obsidian".

### 1o Session history
- **Left rail (380px):** primary "Prepare session 13", "Import audio", and a list of sessions: "S12", title, duration (mono), date, and a status badge (Needs review in warning, Reviewed in success, Not written up in neutral). The selected session uses the standard selected style.
- **Main:**
  - Header with date/time, Georgia 32px title, and the buttons Export / Transcript / "Review 9 suggestions" (warning).
  - Five stat tiles: Recorded, Lines, New facts, New entries, Names fixed.
  - Recap (Georgia 17px).
  - "Who talked" bar with legend.
  - Scenes table (timestamp, scene, length).
  - Footer: an audio-quality dot, "Improve transcript", "Merge with another session".

The existing merge-sessions logic moves behind that merge link.

### 1p Recap to share
- **Left (440px) settings:**
  - Voice: Narrator / In-world chronicle / Bullet notes (segmented).
  - Length slider (~45 s read aloud).
  - Include: What happened, One quote of the night, A moment for each player, Open questions.
  - Info note: "Party theories are worded as theories. Nothing from unreviewed suggestions is included."
  - Buttons: "Read aloud in Alex's voice" (existing ReadAloud), "Copy for Discord", full-width primary "Save image".
- **Right: the 620px recap card:** campaign/session label, a Georgia 34px "Previously, at the Drowned Abbey…", paragraph, pull quote (3px left border in the speaker's class color), a 2×2 grid of per-player highlights, and a footer "Next: … · Made with Troubadour".

### 1q Models & privacy
- **Settings rail (260px):** Models & privacy, Microphone, Players & voices, Obsidian vault, Troubadour Cloud, Appearance.
- **Fixed local rows:** Speech to text and Who's speaking, each with a "Local only" success badge and lock icon.
- **"Notes, write-ups and answers":** radio cards for LM Studio on this computer (Connected), ChatGPT plan, OpenRouter, Anthropic or DeepSeek key.
- **Right:**
  - "What leaves this computer" checklist: Audio never; Voiceprints never; Transcripts & notes and Questions never with a local model; Cloud backup Off/On.
  - Storage bar with "Delete recordings after review: Never".

### 1r App icon: Listening die (chosen)
- **Tile:** rounded square (rx 50 on 220), blue-800 `#2a4365`.
- **Die:** a d20 in `#ebf8ff` strokes: pointy-top hexagon (96,46 149.7,77 149.7,139 96,170 42.3,139 42.3,77), an upward front triangle (96,72 130,130 62,130), and nine facet edges joining the triangle to the hexagon. "20" in Georgia bold, `#90cdf4`, on the large size only.
- **Sound waves:** two arcs on the right in `#90cdf4`.
- **Small sizes:** at 64px, one arc; at 32px, outline only with no facets. The wordmark version is the outline die in accent.fg.

Final artwork should be redrawn as a proper SVG/ICNS by a designer. Replace `web/public/favicon.svg` and `site/favicon.svg`.

### 2a–2c Troubadour Cloud (backup only)
The behavior matches today's `CloudBackupButton`: opt-in; automatic backup a couple of minutes after notes change, at most every 10 min; transcripts optional; restore with replaced files moved to `.trash`.

New rules:
- **One main computer per campaign.** If another computer backs up the same campaign, **the newest backup wins**. Show "Main computer: Alex's MacBook Pro (this one)".
- No backups during a live session.
- Audio and voiceprints never go up.

Screens:
- **2a First connect** (modal over Home, 640px): "Back up The Sunken Crown". Two columns: "Goes up" (notes, codex, facts; write-ups and recaps; 90-day history; plus an "Also transcripts" toggle, off by default) and "Stays on this computer" (audio, voiceprints, the AI model and your questions). Buttons: Not now / "Connect ↗" (sign-in happens in the browser).
- **2b Nav chip and popover (380px, tooltip bg):**
  - The chip reads "Backed up 4 min ago" (cloud icon), or "Cloud backup" with cloud-off when not connected; accent styling while open.
  - Popover: Up to date status; files and changes; "This computer is the main copy · players see it at troubadour.cloud".
  - A waiting-files box ("in about 2 min").
  - Toggles: auto backup, include transcripts.
  - Buttons: Back up now, Restore…, "All settings".
- **2c Settings page:**
  - Status card with "Back up now" and "Open player view ↗".
  - "What goes up" list: fixed badges Always/Never, transcripts toggle.
  - Main computer row.
  - Auto backup toggle.
  - Right column: **Backup history** (90 days; rows with time, change summary, failures in danger; "Restore…" on hover) and "Other campaigns in your cloud" with "Bring to this computer" (this makes it the main computer).
  - Footer: "Signed in as…", Disconnect.

### 3d Troubadour Cloud player view (web, read-only)
Keep it simple for now; it doesn't need to match the app.
- **Header:** brand, campaign, a "Read only" badge, "Synced from Alex's MacBook Pro · 4 min ago", search, user avatar.
- **Left sidebar:**
  - **Overview** pages, **generated on each sync**: Campaign overview, Session log, People and places, Facts by session, The journey.
  - The full **Vault** as a folder tree: NPCs, Places, Items, Factions, Sessions, Party, each with counts.
- **Campaign overview page:** last session card, open threads, party cards, recently learned facts, each linking to its note.

The meta pages are Markdown generated from reviewed data only, so they also work in Obsidian.

### 4a Timeline: "The story so far", vertical (chosen)
- Header: PageHeading "The story so far", subtitle, and a player color legend.
- The table scrolls; **one 60px row per session, newest first**. Columns `200px 300px 280px 1fr 90px`:
  1. Session: "S12" (Georgia bold), date, title.
  2. **Where:** a travel line. Each place gets a fixed horizontal lane position. A 3px border.strong vertical line runs through rows, with a horizontal hop at the bottom of a row when the place changes. Each session gets a 12px dot: accent.fg where a new place starts (labelled with the place name), accent.emphasis for the current session, border.strong otherwise.
  3. **Who talked:** a 10px stacked horizontal bar of each player's share, with "Top player: Pip 17% · 3:12" (excluding the GM).
  4. **New faces:** entity chips introduced that session (legendary color for legendary items).
  5. **Facts learned:** an accent bar (length scales with count) and the count.
- The current session's row uses an accent.subtle background.

Data needed per session: place(s) visited (from scene detection or entity mentions of type Place), talk seconds per player (`talkTime.ts` already computes this), entities first seen, facts accepted.

## Interactions & behavior summary
- Clicking any timestamp plays audio from that point or jumps to the transcript line (highlight for 2.5s). Never autoplay.
- Toasts (sonner, bottom center or right) for undoable actions: Dismiss, Ignore, voice assigned, Pinned.
- Voice assignment relabels past and future lines.
- Every review action uses the existing atomic endpoints and the campaign write queue.
- Facts: accepting an update replaces the current text and pushes the old one onto `history`.
- Live notebook updates every few minutes, from an LLM pass over recent lines. Nothing is written to the vault until the post-session review, except pins and kept items, which are stored with the session.

## State and data additions (backend + `lib/types.ts`)
- `Fact`: `{ text, about: entityName, said_by: { player_id | voice_id, character? }, source: { session_id, t }, confidence: "gm" | "theory" | "once", history: { text, source, replaced_at }[] }`. Today facts are plain strings on entities and the campaign, so this needs a migration that keeps Obsidian notes readable, for example a bullet list with an inline source link.
- `FactSuggestion` gains `kind: "new" | "update"` and `replaces?: string`.
- Session: `scenes: { t, title, place? }[]`, `pins: { t, text }[]`, `present_player_ids`, and a working title.
- Timeline endpoint: per-session `{ place, talk_by_player, new_entities, facts_accepted }`.
- Cloud: `main_device`, last-writer-wins policy, and meta-page generation on sync.

## Design tokens (DPRcalc dark, from `_ds/.../_ds_bundle.css`)
- Background: canvas `#14151e`, surface `#1a202c`, subtle `#171923`, elevated `#2d3748`
- Text: default `#edf2f7`, muted `#cbd5e0`, subtle `#a0aec0`, on-accent `#ffffff`
- Borders: default `#2d3748`, subtle `#171923`, strong `#4a5568`
- Accent: fg `#90cdf4`, emphasis `#3182ce`, subtle `rgba(66,153,225,0.15)`
- Success: fg `#68d391`, bg `rgba(104,211,145,0.12)`, subtle `rgba(104,211,145,0.06)`
- Warning: fg `#f6ad55`, bg `rgba(246,173,85,0.12)`, subtle `rgba(246,173,85,0.06)`
- Danger: fg `#fc8181`, bg `rgba(252,129,129,0.12)`
- Info: fg `#63b3ed`, bg `rgba(99,179,237,0.12)`
- Badge: bg `#2d3748`, fg `#e2e8f0`
- Tooltip/popover: bg `#181d28`, border `#4a5568`
- Rarity: legendary `#ffb62a`, very rare `#c364e7`, rare `#41a9f2`, uncommon `#7ebe15`
- Class colors: base mixed 70% with white in oklch (`color-mix(in oklch, base 70%, white)`). Bases: barbarian `#e7623e`, bard `#ab6dac`, cleric `#91a1b2`, druid `#7a853b`, fighter `#7f513e`, monk `#51a5c5`, paladin `#b59e54`, ranger `#507f62`, rogue `#555752`, sorcerer `#992e2e`, warlock `#7b469b`, wizard `#2a50a1`, artificer `#8c6040`
- Type:
  - Sans: system stack, 14px base. Sizes used: 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 30, 32, 34px. Weights 500/600/700.
  - Serif: Georgia stack for headings.
  - Mono: ui-monospace for timestamps and paths.
- Spacing: 4px grid. Common values: 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 40px.
- Radius: 4 (badges), 6 (buttons, inputs, list items), 8 (cards), 10–12 (dialogs, popovers), 999 (pills, avatars)
- Shadows: popovers `0 24px 60px -16px rgba(0,0,0,0.75)`; the live speaker glow `0 0 18px -4px <player color>`

## Assets
- Icons: lucide (the app already uses `lucide-react`). Names used include feather, mic, pause, play, square, flag, message-circle-question, notebook-pen, spell-check, history, search, plus, cloud, cloud-off, cloud-upload, circle-check, circle-dashed, audio-waveform, lock, laptop, external-link, refresh-cw, scroll-text, megaphone, inbox, users, user-plus, chevrons-up-down, chevron-down, chevron-right, info, arrow-right, monitor, eye-off, volume-2, copy, image-down, shield-check, book-open, palette, audio-lines, fingerprint, notebook-text, messages-square, layout-dashboard, calendar-days, list-checks, map, folder, folder-open, file-text, download, git-merge, x, loader.
- App icon: see 1r; the SVG source is in `App Icons.dc.html`.
- No raster images.

## Files in this bundle
- `AGENT_PROMPT.md`: a ready-made prompt to paste into your coding agent.
- `IMPLEMENTATION_PLAN.md`: build phases, the existing files each phase touches, what "done" means for each, and what's out of scope.
- `screenshots/*.png`: one image per screen, named by canvas ID, e.g. `1h-review-margin-notes.png` or `4a-timeline-vertical.png`. They were captured scaled down from 1440×900. Small text wrapping in the images comes from the capture, so take exact sizes from the `.dc.html` files.
- `Troubadour Redesign.dc.html`: the canvas with every screen and its ID.
- `Live Prototype.dc.html`: the working live-session prototype (logic is in the `<script data-dc-script>` block).
- `Screen *.dc.html`: one file per screen (see the table above).
- `Troubadour Nav.dc.html`: the shared top nav. `Icon.dc.html`: icon loader.
- `data.js`: mock data (players, transcript lines, facts).
- `support.js`, `_ds/`: runtime and the DPRcalc design system, needed to open the files.
- `github.md`: maps each screen to the repo files it was based on.
