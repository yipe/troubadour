# Architecture after the rebuild

## Layout

```
backend/                         uv workspace (virtual root: dev deps, ruff, pytest, import-linter)
  packages/
    core/    troubadour-core     troubadour.core    config, settings, providers (LLM accounts + wire formats), transcript, fsutil
    sound/   troubadour-sound    troubadour.sound   audio, segment, levels, mics, asr, voices, tts            (mlx, torch, sounddevice)
    lore/    troubadour-lore     troubadour.lore    campaign (vault), obsidian, memory (jobs), writeup, ask, cleanup, talk,
                                                    dnd_terms + srd_terms.json; new: facts, pages, notebook, review, timeline, recap
    cloud/   troubadour-cloud    troubadour.cloud   backup (was cloud.py); new: overview (_Overview/ pages)
    engine/  troubadour-engine   troubadour.engine  the live engine split into modules, improve, cloning, sim  (entry: troubadour-sim)
    server/  troubadour-server   troubadour.server  FastAPI app, one router per domain, deps, static files     (entry: troubadour)
  tests/                         one test suite for all packages (fixtures in conftest.py)
  spike/                         research scripts; spike/seed/ + seed_demo.py build the demo data dir
web/                             pnpm workspace
  packages/
    tokens/  @yipe/tokens        colour tokens + class/rarity/swatch data, copied from DPRcalc (see design-system.md)
    ui/      @troubadour/ui      domain-free components on Tailwind v4 + @base-ui/react, styled from the tokens
    api/     @troubadour/api     the API contract: types, HTTP, WebSocket, live store, TanStack Query hooks, test kit
  app/       @troubadour/app     the Troubadour web app: routes, shell, pages, shared domain components
  legacy/                        the old app, parked for reference and deleted by X2 (not built, not tested)
  dist/                          app build output, served by the backend (unchanged path)
docs/design/troubadour-redesign/ the design handoff (screens, prototypes, README with the specs)
shared/test-vectors/             JSON cases both Python and TypeScript implementations must pass
docs/adr/                        architecture decision records (X2 seeds them from Decisions below)
docs/rebuild/                    this plan
```

### Backend layering (enforced)

```
server  ->  engine  ->  cloud  ->  lore | sound  ->  core
```

A package may import only from the packages to its right. `lore` and `sound` don't import each other.
A pytest test (`tests/test_layers.py`) runs import-linter with these contracts, so `yarn check` fails on a
violation. Why this split:
- **`lore` has no ML dependencies.** Facts, write-ups, Ask, review, timeline and recap can be tested and
  reused (for example by the cloud service) without torch or MLX.
- **`sound` holds every model that touches audio.** That covers Whisper, the speaker embedder, VAD and
  the voice clone, which share `asr.mlx_lock`.
- **`engine` orchestrates; `server` only translates HTTP to engine and lore calls.**

The packages are PEP 420 namespace packages: no `troubadour/__init__.py`. The old `troubadour.main`
moves to `troubadour.server.main`. Module moves (old → new import path):

| Old | New |
|---|---|
| `troubadour.config`, `settings`, `providers`, `transcript` | `troubadour.core.<same>` |
| `troubadour.campaign.write_atomic` | `troubadour.core.fsutil.write_atomic` (re-imported where used) |
| `troubadour.audio`, `segment`, `levels`, `mics`, `asr`, `voices`, `tts` | `troubadour.sound.<same>` |
| `troubadour.campaign`, `obsidian`, `memory`, `writeup`, `ask`, `cleanup`, `talk`, `dnd_terms` | `troubadour.lore.<same>` |
| `troubadour.cloud` | `troubadour.cloud.backup` |
| `troubadour.engine` | `troubadour.engine` (package; B2 splits it, `troubadour.engine` re-exports the public names) |
| `troubadour.improve`, `cloning`, `sim` | `troubadour.engine.<same>` |
| `troubadour.server` | `troubadour.server.app` (B3 splits it into `routers/*`, `deps`, `static`) |

### Web packages

- **`@yipe/tokens`**: CSS custom properties (`tokens.css`) plus TypeScript data: class names and base
  colours, rarity, the swatch palette. No React. See `design-system.md` → *Shared with DPRcalc*.
- **`@troubadour/ui`**: imports `@yipe/tokens/tokens.css`. `theme.css` maps tokens to Tailwind
  utilities. It holds components with no Troubadour knowledge: no `@troubadour/api` imports, no
  players, no facts. Subpath exports, no barrel: `import { Button } from "@troubadour/ui/button"`. A dev
  gallery (`@troubadour/ui/gallery`) renders every component; the app mounts it at `/dev/ui` in dev builds.
- **`@troubadour/api`**: one folder per domain (`players`, `campaigns`, `session`, `sessions`,
  `campaign`, `ask`, `cloud`, `llm`, `audio`, `clones`, `notebook`, `review`, `timeline`, `recap`,
  `storage`). Each folder has `types.ts`, `endpoints.ts` and `queries.ts`, plus `mutations.ts` where
  writes need ordering. Shared folders: `http` (request, `ApiError`, URL helpers), `events` (the
  `ServerEvent` union), `socket` (reconnecting WebSocket), `live` (zustand store for the running session),
  `query` (QueryClient factory, keys, `campaignWrite`, WS→cache bridge), `testing` (`mockFetch`,
  fixture builders). The app's `renderWithProviders` (router + query client + live store) lives in `app/src/test/`. Subpath exports: `@troubadour/api/campaign`.
- **`@troubadour/app`**:
  ```
  src/main.tsx, App.tsx (providers), routes.tsx (every route)
  src/shell/        TopNav, CampaignSwitcher, CloudChip, AccountMenu, RecordingPill, AiStatus, layouts
  src/components/   shared domain components (used by 2+ pages; catalogue in design-system.md)
  src/lib/          pure domain helpers with unit tests
  src/pages/<page>/ a page, its private components and its tests
  src/test/         test setup
  scripts/          shot.ts (screenshot one route), smoke.ts (visit every route)
  ```

### Tech choices

| Need | Choice | Why |
|---|---|---|
| Routing | `react-router` v7, declarative `createBrowserRouter` | Boring and well known. Replaces the hand-rolled `lib/route.ts`, which synced two stores to the URL. |
| Server state | `@tanstack/react-query` v5 | Replaces five hand-rolled fetch/loading/error patterns and the refetch plumbing. WS events invalidate or patch the cache. |
| Ordered campaign writes | `campaignWrite()`: a mutation with `scope: { id: "campaign" }` | TanStack runs mutations in one scope one at a time. Each `mutationFn` reads the latest cached entry when it runs and writes the response into the cache before returning. That is the old queue's rule, now in one place. |
| Live session state | zustand (kept), in `@troubadour/api/live` | Many patches per second; only the running session lives here. |
| Long lists | `react-virtuoso` (kept) | Already proven at 16 h of transcript. |
| Primitives | `@base-ui/react` via shadcn `base-nova` sources (kept), restyled | Already in use; keeps accessibility. |
| Variants | `class-variance-authority` (kept) | One variant API for every ui component. |
| Icons | `lucide-react` (kept) | The design uses lucide names. |
| Toasts | `sonner` (kept), wrapped as `notify()` with an Undo action | One call site pattern, used by every page. |
| Recap image | `html-to-image` | "Save image" renders the recap card to PNG. |
| Screenshots | `playwright` (dev), headless and muted | For the visual check in every UI task and for the route smoke test. |
| Fonts | System sans, Georgia serif stack, ui-monospace | From the design; drops the Geist dependency. |
| API types | `openapi-typescript` from FastAPI's schema, generated before every typecheck, never committed (B6) | Replaces "change `types.ts` and `server.py` together" by hand. Not committing means parallel branches can't conflict on a generated file. |
| Python types | basedpyright, `standard` mode, committed baseline (B5) | A type checker on new code without first fixing 12k untyped lines. The baseline only shrinks. |
| Cross-language logic | shared JSON test vectors (`shared/test-vectors/`) | Session numbering and `h:mm:ss` exist in both languages; one set of cases keeps them equal. |
| Boundaries | import-linter (Python), pnpm strict deps + oxlint restricted imports/globals (web) | Rules agents can't miss: the check fails. |
| Links | `app/src/paths.ts` typed path builders | A URL change is one edit; no string literals in components. |
| Tests | one vitest run for the workspace (`test.projects`), `TZ=UTC`, explicit `en-US` formatting | One command, and results that don't depend on the machine. |

## Routes

| Path | Page | Notes |
|---|---|---|
| `/` | Home (1b) | First run (no seated players and no saved sessions) redirects to `/welcome/campaign`. On first load, a running session redirects to `/sessions/live`. |
| `/welcome/:step` | Wizard (1a) | `campaign`, `table`, `microphone`, `notes`, `privacy`. Bare layout: no top nav. |
| `/sessions` | Sessions (1o) | Selects the newest session. |
| `/sessions/new` | Ready check (1c) | "Prepare session N". `?source=file` opens the file-replay picker. |
| `/sessions/live` | Live (1f) | Redirects to `/sessions` when no session is running. |
| `/sessions/:id` | Sessions (1o), that session selected | |
| `/sessions/:id/review` | Review (1h) | |
| `/sessions/:id/transcript` | Transcript viewer | |
| `/sessions/:id/recap` | Recap (1p) | |
| `/timeline` | Timeline (4a) | |
| `/codex`, `/codex/:entry` | Codex (1n) | |
| `/facts` | Facts (1k) | Filters live in the query string (`?about=npc&sure=gm&by=<player>&q=`). |
| `/ask` | Ask | |
| `/settings/:section` | Settings | `models` (1q), `microphone`, `players`, `vault`, `cloud` (2c). |
| `/dev/ui` | UI gallery | Dev builds only. |
| Old URLs | redirects | `/setup` → `/sessions/new`, `/session` → `/sessions/live`, `/history[/:id]` → `/sessions[/:id]`, `/campaign[/:entry]` → `/codex[/:entry]`. |

Nav tabs: Home · Sessions · Timeline · Codex · Facts · Ask. **Sessions** is active for `/sessions/*` and
shows a red dot while a session runs.

## Shared rules (used by several tasks)

- **Session number.** N is a session's 1-based position among the open campaign's saved sessions,
  oldest first, not counting sessions merged into another (`merged_from`). The next session is
  `count + 1`. The client helper `sessionNumber` (S2) and the server (`lore.pages.session_numbers`, C2)
  implement this one rule, and both have tests.
- **Player colour.** `player.color` (a hex override) if set; otherwise the class colour (a built-in
  class: `var(--color-class-<id>)` from the shared tokens; a custom class: its own hex); otherwise `var(--color-class-paladin)` for the GM; otherwise
  `var(--color-fg-subtle)`. Avatars are a 22% tint of that colour with a 1.5px inset ring, and initials
  in the colour. Implemented once in `app/src/lib/players.ts`, `playerColor(player, classes)` (S2).
- **Confidence.** `gm` → "GM stated" (success), `theory` → "Party theory" (warning), `once` → "Heard once"
  (neutral badge). One map in `app/src/lib/confidence.ts` (S2).
- **Timestamps.** `h:mm:ss`, mono, 12px. Clicking one plays the session audio from that point. In the live
  view it scrolls to the line and highlights it for 2.5 s. Never autoplay; `preload="none"`.
- **Long work** (write-up, recap, notebook pass, import, improve, backup) runs as a background job, reported
  by `campaign.job` (or `notebook.updated`). Requests never wait on an LLM or Whisper.

## API contract changes

New and changed endpoints and fields. Every task that owns one also updates its `@troubadour/api`
domain folder and its pytest. X2 copies this list into `PLAN.md`.

| Task | Change |
|---|---|
| C1 | **Classes are a list the app loads**, like `dnd_terms`: the 12 SRD classes built in, plus custom classes the user adds (stored in `DATA_DIR/classes.json`, never committed; e.g. an artificer). `GET /api/classes` → `DndClass[] {id, label, color: string \| null, builtin}` (built-ins have `color: null`: the client uses the shared token colour). `POST /api/classes {label, color}`, `PATCH /api/classes/{id}`, `DELETE /api/classes/{id}` (custom only). `Player.dnd_class: string \| null` (a known class id). `Player.color: string \| null`: now only a custom override. Existing players keep their colour as an override; new players start at `null`. `PATCH /api/players/{id}` accepts `dnd_class` and `color` (`null` clears). Saved records' `players[]` carry `dnd_class` and `color`. |
| C2 | `POST /api/session/start` also takes `title?` (≤120), `present_player_ids?` (≤32 ids), `record_audio?` (default: `TROUBADOUR_RECORD`), `cleanup?` (default on). Live `Session` adds `title` and `present_player_ids`. `SavedSession` adds `title` (write-up title, else working title, else null), `summary` (first paragraph of the write-up's wrap-up, else null), `present_player_ids`, `reviewed_at` (epoch s or null), `talk: Record<string, number>` (seconds per player id; unnamed voices under `voice:<id>`). New `POST /api/sessions/{id}/reviewed {reviewed: bool}`. |
| C3 | `GET /api/session/notebook` → `Notebook {session_id, items: NotebookItem[], pins: Pin[], updating: boolean}`. `POST /api/session/pins {t, text}` → `Pin`. `POST /api/session/notebook/{item_id} {status: "open"\|"kept"\|"dismissed"}`. WS `notebook.updated: Notebook`. Saved in `sessions/<id>/notebook.json`; `GET /api/sessions/{id}/notebook` for saved sessions. |
| C4 | No new shapes. The LLM pass fills `Notebook.items` and sets `updating` while it runs, reporting only through `notebook.updated`. |
| C6 | `Fact {id, text, about, said_by, source, confidence, history}` (see *Fact format*). `Entity.facts: Fact[]`, `Entity.suggested_facts: FactSuggestion[]`, `Campaign.facts: Fact[]`. Fact writes (add, edit, review accept/reject, campaign facts) take and return `Fact` and address facts by `id`. |
| C7 | `FactSuggestion` gains `kind: "new"\|"update"` and `replaces: string \| null` (a fact id). Write-up suggestions carry `source`, `said_by` and `confidence`. `SavedSession.scenes: Scene[] \| null`, where `Scene {t, title, place: string \| null}`. |
| C8 | `GET /api/sessions/{id}/review` → `Review {session_id, items: ReviewItem[], counts}`. `POST /api/sessions/{id}/review/{item_id} {action: "accept"\|"reject", text?, about?}` → `ReviewItem`. |
| C9 | `GET /api/campaign/timeline` → `{sessions: TimelineSession[]}`. `GET /api/campaign/entities/{name}` adds `appearances: {session_id, n, count}[]`. |
| C10 | `POST /api/sessions/{id}/recap {voice, length_s, include}` → job (`CampaignJob.kind: "recap"`). `GET /api/sessions/{id}/recap` → `Recap \| null`. |
| C11 | `GET /api/storage` → `{root, recordings, voices, notes, other}` (bytes). |
| C12 | `CloudStatus` adds `device`, `main_device`, `is_main`, `paused_live`. `GET /api/cloud/history` → `{attempts: BackupAttempt[]}` (90 days). `POST /api/cloud/restore` takes an optional `snapshot`. |
| C13 | No API change. Backups write `_Overview/*.md` into the vault first. |
| C14 | `CampaignAnswer.stats: {seconds, transcripts, notes} \| null`. `POST /api/campaign/ask` takes optional `t` (session seconds when asked live), echoed as `CampaignAnswer.t`. |

## Fact format in the vault

Today a fact is a bullet with an optional trailing session link: `- Owes Kessia a favour. ([[2026-10-15 Session]])`.
The new format extends it, so a note still reads well in Obsidian:

```markdown
## Facts
- The tide turns at the second bell. ([[2026-10-22 The Drowned Abbey#1:38:02|S12 1:38]] · Orsa Vell · GM stated)
- Orsa Vell paid Pip back. They're square. ([[2026-10-22 The Drowned Abbey#1:42:58|S12 1:42]] · Orsa Vell · GM stated)
  - ~~Orsa Vell owes Pip 20 gold.~~ ([[2026-10-08 Debts and Riddles#0:52:10|S10 0:52]] · Pip · Heard once)
- Brann swore an oath to the drowned god.
```

- **Trailer:** `([[<page>#<h:mm:ss>|S<n> <h:mm>]] · <said by> · <GM stated|Party theory|Heard once>)`. Every
  part is optional. The parser takes the link, then the last ` · ` part if it is a confidence label, then
  what is left as the speaker. When the link has no `#time`, `source.t` is null.
- **History:** nested `- ~~old text~~ (trailer)` bullets under a fact, newest first.
- **Old bullets:** plain text, or text with a bare `([[Page]])`, parse as `confidence: "once"` with the
  page as `source` (`t: null`). An unchanged old note is never rewritten just to upgrade its format.
  Notes are rewritten only when Troubadour changes their facts, as today.
- **Ids:** `id` = the first 10 hex characters of sha1 of `about + "\n" + norm(text)`. It is stable while
  the text stays the same; a write addresses the latest id.
- **Speaker:** stored as the display name in the note. `said_by.player_id` is resolved when the note is
  read, by matching seated players' names and characters (case-insensitive). No match gives `null`.
- Troubadour still owns only `## Facts` and `## Suggested facts`. Suggested facts use the same format;
  an update suggestion adds `→ replaces: <old text>` before the trailer.

## Decisions (and what was rejected)

1. **Workspace packages over one package with sub-modules.** You asked for packages. They also make
   dependencies explicit: `lore` installs without ML wheels. One package plus import-linter would have
   been cheaper and was rejected for that reason.
2. **Mixins for the engine split (B2), not composition.** The 2.4k-line `Engine` keeps its public
   methods, so the server and around 700 lines of engine tests don't change. Composition (objects for
   library, voices and pipeline sharing one lock) is the better long-term shape, but it is a behaviour-risky
   refactor. It is left for later, with the seams B2 creates.
3. **New app beside the old one, not a gradual migration.** The old app moves to `web/legacy/` and stops
   building on day one. Every page is new. Pure helpers with tests are ported. This happens on the
   `yipe/rebuild` branch while the real app keeps running from `main`.
4. **Review actions go through one server endpoint (C8).** It calls the same vault operations as today's
   atomic endpoints and records the decision, so progress ("5 of 14") is right even after a reject removes
   the suggestion. Two client calls (do the action, then record it) could disagree after a failure.
5. **Live ask answers inline** above the ask bar (the chosen live prototype). Screen 1g's styling (serif
   answer, numbered sources) is the look of the shared `AskAnswer` component, which the Ask page also uses.
6. **The scene breadcrumb is hidden in the live view.** Scenes come from the write-up's beats (C7) and
   appear in History and the Timeline. A live scene detector is deferred.
7. **Cloud history is the local log of backup attempts** (successes and failures) plus restore by snapshot
   id. A server-side snapshot list depends on the separate cloud service and is deferred.
8. **Tokens are shared with DPRcalc; components are not (yet).** The two apps use different stacks (Chakra
   vs Tailwind/base-ui). See `design-system.md`.
9. **Generated API types, gradually.** New and changed endpoints get pydantic `response_model`s and generated
   TS types. The 70 existing endpoints keep their hand-written types until someone touches them. Converting
   them all at once would be a big-bang change with no behaviour gain. Rejected: zod runtime validation of
   every response (more code, no new safety for a same-machine API).
10. **Known debt, kept on purpose:** importing `troubadour.server.app` builds the Engine (module-level
    singletons in `deps.py`), so any import has side effects on `DATA_DIR`. B3 keeps this to stay
    behaviour-preserving, and tests rely on patching `deps.*`. The fix is an app factory with
    lifespan-created dependencies; it's a follow-up task after the rebuild. Until then, every script that
    imports the server sets `TROUBADOUR_DATA` first (`openapi.py` shows how).
11. **Skipped for now:** the React Compiler (oxlint doesn't check its rules yet), Storybook (at two developers per app it isn't worth a second catalogue; hard UI states render in Vitest browser-mode tests with `shot()`, and DPRcalc already has its `ds-bundle`), pixel-diff visual regression (flaky across machines; the smoke screenshots are the
    artifact), pre-commit hooks (`yarn check` and CI are the gate), CODEOWNERS (one owner).
