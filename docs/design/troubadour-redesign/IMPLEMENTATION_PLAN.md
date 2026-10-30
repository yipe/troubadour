# Implementation plan (for the coding agent)

Read `README.md` first for the specs. This file says **what order to build things in and how to know each step is done**. The repo's own rules always win: `AGENTS.md`, `web/AGENTS.md` and `backend/AGENTS.md`. Run `yarn check` before every commit, and every new behavior gets a test.

Each phase ships on its own and leaves the app working. Don't start a phase until the previous one passes `yarn check`.

## Phase 0: Theme and shell (no behavior changes)
1. In `web/src/index.css`, remap the shadcn variables in `.dark` to the DPRcalc tokens (README → *Recommended approach to styling*). Make dark the default: add the `dark` class to `<html>` in `web/index.html`.
2. Add font stacks: sans = system stack; add a `--font-heading` serif (Georgia stack) and use it for page titles, card titles and table headers.
3. Replace the header in `App.tsx` with the new nav:
   - Wordmark, campaign switcher, underlined tabs **Home · Sessions · Timeline · Codex · Facts · Ask**.
   - Right side: recording pill, cloud chip (wired to `useCloud`, replacing the `CloudBackupButton` trigger), "On this Mac · AI ready" status (opens `ModelsDialog`), and the account menu.
4. Extend `lib/route.ts` with the views `home`, `timeline` and `facts`. `codex` is today's `campaign` view; keep the old URL as an alias.
5. Player color: add a class field to players (`backend` player model + `lib/types.ts`), defaulting from the current color. Use `--color-class-<class>` for avatars and names. Keep the custom color as an override.

**Done when:** every existing screen renders in the new theme with the new nav, and the routing tests pass with the new views.
Screenshots: any, for the look; `screenshots/1b-home.png` for the nav.

## Phase 1: Home and pre-session
1. **Home (1b):** last session card (the write-up title from `written_up`, the recap from the session page, talk share from `recordTalkTime`), a "waiting for review" banner (count of `needsReview` entries for that session), the players list, and the newest facts.
2. **Ready check (1c):** split `SetupView` and `StartPanel` into:
   - who's here: a new `present_player_ids` saved on the session;
   - the mic card, reusing `MicDetails`/`MicTest`, restyled with a level meter and checklist;
   - model tiles: Whisper and LLM status come from `session.asr` / `session.llm`;
   - the Start card: working title, recording toggle (`TROUBADOUR_RECORD`), cleanup toggle, and a consent checkbox that must be ticked before Start is enabled.
   - The "Previously on…" card uses the last write-up's recap, with `ReadAloud` to read it out.
3. **First-run wizard (1a):** shown when there are no campaigns or no players. Steps: Campaign (name + vault), The table (the players table with **Retrain/Train**, opening `TrainDialog`), Microphone (the 1c mic card), Existing notes (`ImportDialog`), and AI & privacy (`ModelsDialog` content).

**Done when:** a fresh data dir lands on the wizard; finishing it lands on Home; "Prepare session" opens the ready check; Start begins a session exactly as today.
Screenshots: 1a, 1b, 1c.

## Phase 2: Live session (1f, behavior in `Live Prototype.dc.html`)
1. Three-column layout:
   - Left rail: speakers, with the share bar and speaking highlight from `useSpeaking`.
   - Center: transcript, still virtualized with `ChatFeed`/Virtuoso, restyled as a timestamp grid.
   - Right: the notebook.
2. **Pending voice card:** compact quick-assign that replaces the big `VoicesPanel` card. The top suggestion comes from `suggested_player_id`. "Later" hides it until the next new voice. The full `VoicesPanel` moves into a "Voices" popover.
3. **Ask bar:** text ending in "?" calls the existing `api.ask` and shows the answer inline with sources. Any other text calls a new `POST /api/session/pins {t, text}`.
4. **Notebook (backend work):**
   - Add a periodic job (every ~3 min of new speech, never more than one at a time) that runs the memory model over the recent window and produces candidate facts, entries and spellings, **without writing to the vault**.
   - Stream them over the WebSocket as `notebook.updated`.
   - Keep/Dismiss are stored with the session. Kept items are pre-accepted in the post-session review.
   - Spelling fixes already come from cleanup; list them in the Names tab.
5. **Scene breadcrumb:** start as just the current scene title from a pause or place-name heuristic, or hide it until Phase 5.
6. **End session** opens the summary modal, then starts the write-up job (today's `writeUp`).

**Done when:**
- a live session shows streaming lines;
- naming a voice relabels its past lines;
- a question returns an answer with sources;
- a note pins at the current time;
- notebook cards appear and Keep/Dismiss persist across a reload;
- End triggers the write-up.

Screenshots: 1f, 3a.

## Phase 3: Post-session review (1h)
1. A new route `/sessions/:id/review`. Left: the transcript (from the saved record). Right: on the same row as the line it came from, the suggestion anchored to that line.
2. Suggestions need a **source line id** (`message_id` or `t_start`). Extend the write-up and suggestion output so each suggested fact, spelling or entry carries `source: {session_id, t}`.
3. Actions map to the existing atomic endpoints: `reviewEntity` (accept/reject facts and spellings), `ignoreWord`, `rejectMisheard`, `createEntity`. Add **Accept all GM-stated**, which runs them one after another through the write queue.
4. Progress bar and filter pills. **Finish review** marks the session reviewed, which the Home banner and the History status read.

**Done when:** every suggestion type can be accepted, edited and rejected from beside its line; the progress count is correct; the session shows "Reviewed" in History.
Screenshots: 1h (chosen); 1i and 1j are alternatives, don't build them.

## Phase 4: Facts, codex and history
1. **Fact model migration (backend):**
   - `Fact {text, about, said_by, source{session,t}, confidence: gm|theory|once, history[]}`.
   - In Obsidian notes, write each fact as a bullet with a trailing source link, e.g. `- The tide turns at the second bell. ([[2026-10-22 The Drowned Abbey#1:38:02|S12 1:38]] · GM)`, so the notes still read well. Parse old plain bullets as `{text, confidence: "once"}` with no source.
   - Updates: a suggestion of kind `update` with `replaces` moves the old text into `history` when accepted.
2. **Facts view (1k):** the left rail (filters About / How sure / Said by, with counts), a table, a source link that opens the session viewer at that time, and a history row that expands under the fact.
3. **Codex (1n):** restyle `CampaignView` + `EntityEditor` into the entry page: header, heard-as chips (existing review buttons), an appearances chart (mentions per session), a facts table, connected entries (from wiki links), and "Open in Obsidian".
4. **History (1o):** restyle `HistoryView`. Add a status badge per session (needs review / reviewed / not written up), stat tiles and a scenes table. Move the merge tools behind the "Merge with another session" link.

**Done when:** facts show their source and confidence and open the exact line; editing a fact through an update keeps its history; old vault notes still load.
Screenshots: 1k, 1n, 1o.

## Phase 5: Timeline (4a)
1. Backend `GET /api/campaign/timeline` returns, per session: `{id, n, date, title, places[], talk_by_player, new_entities[], facts_accepted}`. Places come from Place-type entities mentioned most in each scene, or from the scene title.
2. UI: a vertical, scrolling table, newest first, with the travel-line column (README 4a spec). It should hold up past 50 sessions; virtualize if needed.

**Done when:** the timeline matches `screenshots/4a-timeline-vertical.png` with real data and scrolls smoothly at 50 or more sessions.

## Phase 6: Recap, settings, cloud
1. **Recap (1p):** a recap generator built from **reviewed** facts only. Voice and length options. "Copy for Discord" (Markdown), "Save image" (render the card to PNG), and `ReadAloud`.
2. **Models & privacy (1q):** move `ModelsDialog` content into a settings page and add the "What leaves this Mac" summary and storage usage.
3. **Cloud (2a–2c):** keep `cloudStore`/the API as they are, and add:
   - a **main device** field. A backup from a different device shows "newest backup wins" and makes that device the main Mac;
   - backups paused while a session is live;
   - a backup history list with restore points (a snapshot list from the service);
   - the first-connect modal (2a), the nav popover (2b) and the settings page (2c).
4. **Player view (3d, cloud service, separate repo or later):**
   - a read-only vault browser with **generated meta pages per sync**: Campaign overview, Session log, People and places, Facts by session, The journey;
   - generate them as Markdown files in a `_Overview/` folder of the vault during backup, so they also work in Obsidian.

## Phase 7: App icon
Redraw the Listening die (1r spec) as SVG and replace `web/public/favicon.svg` and `site/favicon.svg`. Add 32px and 64px variants without the facets or the "20".

## Out of scope / don't build
- Shared table-screen mode (removed by the user).
- Saving Ask answers as facts (removed; Ask only answers with sources).
- Multi-device editing or sync conflict resolution. The cloud is backup only, and the newest backup wins.
- The alternative options: 1d, 1i, 1j, 1l, 1m, 3b, 3c are kept only as references.
