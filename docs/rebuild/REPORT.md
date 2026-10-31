# Rebuild final gate report (X3)

Run on `rebuild/X3` (from `yipe/rebuild` after X2), scratch server on port 8790, seeded demo campaign, no
models, no LLM. Nothing was fixed here; section 6 is the fix list.

## 1. Smoke and checks

| Check | Result |
|---|---|
| `scripts/scratch.sh 8790`, then `smoke --port 8790 --out /tmp/x3` | **18/18 routes clean**, no console errors. |
| `/welcome/table` (extra, via `shot`) | Renders; used for the 1a comparison. |
| `yarn check` | Passes. |
| `cd web && pnpm test` ×5 | 3 green, **2 red, each a different flake** (section 4). |
| basedpyright | 0 new errors. Baseline **523** recorded errors in 40 files, down from **589** when B5 created it; it never grew. |

Smoke gaps (not failures):
- `/sessions/live` needs a running session, which the gate may not start, so 1d, 1f, 1g and 3a are not compared.
- `shot` and `smoke` cannot open dialogs or popovers: 1a's train dialog, 2a, 2b and the F10 dialogs are not compared.
- A fresh checkout fails `yarn build` (missing `generated/` types) until `pnpm -C packages/api gen` has run.
  `yarn check` hides this because `typecheck` runs the generator first.

## 2. Design diff

Seed data differs from the design copy (12 sessions, 15 facts, no LLM, no mic, Cloud not connected), which
explains most content differences.

| Screen | Route | Verdict | Notes |
|---|---|---|---|
| nav | shell | minor | Wordmark, switcher, tabs and pills match. Cloud chip disconnected (design: "Backed up 4 min ago"). "AI loading" (no LLM). Avatar one initial, design two. |
| 1a Setup wizard | `/welcome/table` | matches | Table, class dots, Trained/Retrain match. No library banner (no library in seed). Row "…" menu extra. Step 1 has no design; "Use an existing folder" disabled (backend gap). |
| 1b Home | `/` | minor | Structure matches. Title large white serif, design small accent blue. Some facts show "0:00". No review banner or recap paragraph: latest seeded session isn't written up. |
| 1c Ready check | `/sessions/new` | minor | Same cards. "Previously on" text larger. Button "Read aloud" vs "Read aloud in Alex's voice". Flat meter (no mic); models Loading / Not running. |
| 1d, 1f, 3a, 1g | live | not compared | Needs a live session. |
| 1h Review | `/sessions/:id/review` | minor | Header, progress, pills and buttons match; the seed has few margin cards. |
| 1k Facts | `/facts` | matches | Rail, columns, "Changed once" row match. "Said by" counts 0 except GM (seed attribution). |
| 1n Codex | `/codex/:entry` | minor | Rail, heading, heard-as chips, appearances chart, facts table match. "Connected" empty (no links in seed). |
| 1o History | `/sessions[/:id]` | minor | List, tiles, scenes, who-talked match. No "Review N suggestions" button or recap (not written up); check the "Audio quality" link shows when a report exists. |
| 1p Recap | `/sessions/:id/recap` | minor | Options column matches. Preview card not seen (building needs the LLM). "Review session first" notice is extra. |
| 1q Models & privacy | `/settings/models` | **off** | Eyebrow and h1 both "Models & privacy"; cards show full selects vs one-line summaries; no Appearance rail item; Storage lacks "Delete recordings after review". "What leaves this Mac" matches. |
| 2a, 2b, 2c | dialog, chip, `/settings/cloud` | not compared | Dialog/popover states; seed not connected. |
| 4a Timeline | `/timeline` | minor | Columns, legend, bars match. Travel line flat (seed data). Title larger than design. |
| 1r, 3d | — | — | 1r is X1's icons; 3d deferred by `page-map.md`. |
| 1i, 1j, 1l, 1m, 3b, 3c | — | not built | Alternatives, by design. |

No-design routes (`/ask`, transcript, `/settings/microphone`, `/settings/players`, `/settings/vault`) render
console-clean.

## 3. Audit

**Checked, nothing found:** default exports; `fetch(` in `app`/`ui`; string-literal `/api` URLs;
`toLocale*`/`Intl` without `"en-US"`; zustand outside `api/src/live`; campaign mutations outside
`campaignWrite`; unvalidated LLM output in `recap`, `notebook.propose`, `talk`; `lint-imports` exceptions (none);
`style` colours other than player/class/campaign CSS variables.

**Dead code and rule of two:**
- Dead: `app/src/lib/record.ts` (`loadRecord`, `PLAYER_PALETTE`, raw hex) used only by its test;
  `components/people/SpeakerName.tsx` has no importer.
- knip on `app`: unused exports `LOCAL_LABEL`, `jobActive`, `jobCount`, `PENDING_CAP`, `CAMPAIGN_FACTS`,
  `LANE_START`, `LANE_STEP`, `laneX`; unused types `MicCardMode`, `ViewerPlayer`, `ViewerLine`, `AboutFilter`;
  unused dependency `zustand` in `app/package.json`. (`openapi-typescript` in `api` is a false positive.)
- One-user shared components: `@troubadour/ui` `slider` (recap) and `table` (FactsTable);
  `components/entity/TypeBadge.tsx` (codex).
- Duplicated helpers: `plural` (`pages/home/ReviewBanner.tsx`, `pages/review/index.tsx`); `elapsed`
  (`shell/RecordingPill.tsx`, `components/jobs/progress.ts`); `settings/sections/cloud/attempts.ts` repeats
  `lib/format.ts`; the files/changed summary (`shell/CloudChip.tsx`, `settings/sections/cloud/index.tsx`).

**Conventions and sizes:**
- Raw hex: `components/players/AddClassDialog.tsx:11` (and dead `lib/record.ts`).
- Web files over ~250 lines: `ModelsSettings.tsx` 325, `VoiceCloneDialog.tsx` 304, `PlayerRow.tsx` 280,
  `api/campaign/mutations.ts` 264, `ImproveDialog.tsx` 263, `EditEntryDialog.tsx` 253.
- Python over ~600 lines: `lore/memory.py` 1169, `lore/campaign.py` 856, `cloud/backup.py` 730,
  `core/providers.py` 664, `engine/_pipeline.py` 651, `sound/tts.py` 612.
- `os.environ` outside `config`: `engine/core.py:100-101` (HF token alias), `server/openapi.py:27-33`
  (schema export isolation).
- Input models without caps: `CloudRestoreIn` (`routers/cloud.py`), `ModelsIn` (`routers/llm.py`).
- About 52 routes lack `response_model`; the web `api` package still hand-writes ~80 interfaces.
- Test sleeps: `TranscriptList.test.tsx` (3×), `settings/sections/cloud/index.browser.test.tsx`,
  `api/query/query.test.tsx`.

## 4. Flaky web tests (5 runs of `pnpm test`)

| Run | Result | Test |
|---|---|---|
| 1 | 1 failed | `FactsTable.browser.test.tsx` › "renders the last rows when its scrolling column … is scrolled to the end": `getByText('Fact number 400')` not found. |
| 2 | 1 failed | `ModelsSettings.test.tsx` › "lists what OpenRouter offers, with prices": `Target cannot be null or undefined`. |
| 3–5 | green | 104 files, 577 tests. |

Likely causes: FactsTable sets `scrollTop` once before the virtualizer has measured; ModelsSettings captures
a `select` that is replaced on re-render, so `waitFor` reads a detached node (probably the unnamed "waitFor
under load" failure F1 and S10 saw). The `useContext` null error from the F22 merge did not reproduce.

## 5. Owner-run: real local LLM round trip

With LM Studio on `:1235` and the real app idle:
- [ ] `scripts/scratch.sh 8790 --llm`, open http://127.0.0.1:8790, check the chip says "AI ready".
- [ ] `/sessions/new`: "Previously on…" shows.
- [ ] Replay a seeded session. Notebook items arrive; keep or dismiss two; add a pin.
- [ ] Ask from the live bar. The answer cites sources; a transcript chip does not leave the live page (known gap F5).
- [ ] End session. A write-up job starts, shows steps and tokens, and finishes.
- [ ] `/sessions/:id/review`: accept, edit, reject a suggestion; add an entry; "Finish review" works.
- [ ] `/sessions/:id/recap`: build with each voice, check the card, Copy for Discord, Save image (compare 1p).
- [ ] `/codex/<entry>`: "Look for more facts", accept a heard-as, merge two entries.
- [ ] `/facts` and the vault show the new structured bullets.
- [ ] Stop the server; `lsof -ti :8790` is empty.

## 6. Fix list

Each item fits one Sonnet task. Items from `NOTES.md` are folded in.

**Build and tests**
1. Run the API type generator before the app build (`prebuild` in `web/app/package.json`).
2. FactsTable flake: poll the scroll in `components/facts-table/FactsTable.browser.test.tsx`.
3. ModelsSettings flake: query the select inside `waitFor` in `components/models/ModelsSettings.test.tsx` (check the file's other tests).
4. Remove the test sleeps listed in section 3.
5. If the `useContext` null error recurs, add `optimizeDeps.include` for react in `web/app/vitest.browser.config.ts`.
6. Extend `scripts/shot.ts`/`smoke.ts` to open dialogs and popovers, cover `/welcome/table`, and add a live-session fixture route.
7. `setupFiles` with `afterEach(cleanup)` in `web/packages/ui/vitest.config.ts`; a `clearToasts` helper in the app test setup; `renderWithProviders.rerender` re-wraps providers.

**Dead code and duplication (web)**
8. Delete `lib/record.ts` (+ test) and `components/people/SpeakerName.tsx`; remove the knip-listed exports/types and `zustand` from `app/package.json`.
9. Share `plural` (to `lib/format.ts`), one `elapsed`, `lib/format.ts` in `cloud/attempts.ts`, and the files/changed summary in `components/cloud/status.ts`.
10. Replace the hex default in `AddClassDialog.tsx` with the first palette swatch.
11. Decide whether `slider` and `table` stay in `@troubadour/ui` (owner decision; record in `design-system.md`).
12. Split `ModelsSettings.tsx`, `VoiceCloneDialog.tsx`, `PlayerRow.tsx`, `ImproveDialog.tsx`, `EditEntryDialog.tsx` (one task each).

**Backend structure**
13. Caps and tests for `CloudRestoreIn` and `ModelsIn`.
14. Move the HF token alias from `engine/core.py` into `core.config`; document `server/openapi.py` as the one exception.
15. Split `lore/memory.py` (two tasks: extraction and prompts, then merge and apply).
16. Split `lore/campaign.py`, `cloud/backup.py`, `core/providers.py`, `engine/_pipeline.py`, `sound/tts.py` (one each).
17. `response_model` + `Schemas["X"]` per router: `players`, `session`/`sessions`, `audio`, `clones`, `llm`, `campaign`, `cloud`.

**Backend gaps**
18. `GET /api/campaigns` so `useCampaigns` stops being cache-only.
19. ~~Dedupe `norm`; `_session_index` uses `pages.session_numbers`~~ (done during the build, `d918bf7`).
20. An id on the live `Session` and in the stop response (F5, F7).
21. Adopt an existing vault folder, then enable the welcome option (F3).
22. Cloud status: pending files (S12), vault device and last backup (F22), "retried" history info, a push when `paused_live` clears (C12).
23. A type on unknown-word accepts (F8); record which session suggested an entry (F14).
24. Class level ("Bard 6") and origin campaign on library players (F1, S8).
25. Improve and Retranscribe update `talk` in `meta.json` (C2).
26. Recap sees more than the wrap-up's first paragraph (C10).
27. A final notebook pass for lines transcribed after Stop (C4).
28. Move the shared response models out of `routers/campaign.py` (C8); declare `troubadour-cloud`'s `lore` dependency (C13).
29. Vary the seed: places per session, a write-up for S12, more attributed facts, a connected-cloud variant, a suggestion-rich session.

**Web polish**
30. Models page: one heading, compact summaries, "Delete recordings after review", Appearance item (F18).
31. `PageHeading` size prop; accent title on Home and Timeline (F1, F12).
32. Hide the time when a fact source has none (`NewestFacts.tsx`, `FactsTable.tsx`).
33. "Read aloud in {GM}'s voice" on the ready check and recap.
34. `onJump` override in `AskAnswer`/`TimestampLink` (F5); a click-only timestamp hook in `SuggestionCard` (F6).
35. Widen `TalkShareBar` to `RecordPlayer` (F11); a per-row class in `TranscriptList` (F8).
36. Codex: replace `openLater` in `pages/codex/index.tsx` (F15); pick the first entry by sorted name (F14).
37. Use C8's open-suggestion count in Sessions (F9).
38. Export `buttonVariants`; consistent `role="link"`/`nativeButton={false}` for button-styled links.
39. Spelling count on `SuggestionCard` (F6); `aria-label` on `Progress` (S6).
40. Gallery `import.meta.glob` typing (S1); split `notify` from `Toaster` (U3).
41. Players whose class was deleted (C1); note 422 vs 400 in the contract.
42. A browser `shot()` test for the recap states (F16).

**Docs**
43. Correct "22 server events" in `docs/architecture.md` (21).

**Owner decisions:** merging `yipe/rebuild` to `main` after section 5 is signed off; item 11.
