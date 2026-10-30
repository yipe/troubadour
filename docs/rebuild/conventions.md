# Conventions: a codebase people and agents can work in at the same time

These are the working agreements the rebuild leaves behind. X2 copies the short form into the `AGENTS.md`
files; this is the long form with the reasons. They're written for a project with several developers
and several coding agents pushing changes at once.

## 1. Let tools enforce the rules

A rule that lives only in prose gets broken by the first agent that doesn't read it. Every boundary
below fails `yarn check` when crossed:

| Rule | Enforced by |
|---|---|
| Python layers: `server → engine → cloud → lore \| sound → core` | import-linter, run by `tests/test_layers.py` (B1) |
| Web packages: `ui` never imports `api`; `tokens` imports nothing | pnpm's strict `node_modules` (a package can only import its declared deps) + oxlint `no-restricted-imports` (W1) |
| No `fetch` in components; server data only through `@troubadour/api` | oxlint `no-restricted-globals: fetch` in `app/` and `packages/ui/` (W1) |
| Pages don't import other pages (promote shared code instead) | oxlint `no-restricted-imports` pattern `@/pages/*` inside `app/src/pages/**` (W1) |
| Python types | basedpyright with a committed baseline: existing errors are recorded, new ones fail (B5) |
| API types match the server | TypeScript types generated from FastAPI's OpenAPI schema on every typecheck (B6) |
| Logic implemented in both languages agrees | shared test vectors in `shared/test-vectors/*.json`, read by pytest and vitest (P0) |
| Route list doesn't change by accident | `tests/test_routes.py` pins every route (B3) |
| Formatting | ruff format, prettier, checked in `yarn check` |

When you add a rule, add the check with it. When you can't check it, keep it short and put it in the
nearest `AGENTS.md`.

## 2. Make the code easy to find and safe to change

- **Predictable places.** A package has `AGENTS.md` (with a `CLAUDE.md` symlink, the repo's convention),
  `src/` and tests. A web page lives in `app/src/pages/<page>/` with its private components and tests
  next to it. A Python feature is one module in the right package with one test file.
- **One idea per file; the file is named after what it exports** (`SuggestionCard.tsx` exports
  `SuggestionCard`). That way grep, rename and agents' file search find it.
- **Named exports only.** No default exports; route modules export `Component`, React Router's lazy
  convention. **No barrels** that re-export a whole package. Subpath imports (`@troubadour/ui/button`)
  keep the import graph honest and the tests fast.
- **Rule of two** for sharing: a second real user promotes code into `app/src/components`,
  `@troubadour/ui` or a lore module. One user keeps it local.
- **Small files.** Python modules stay under about 600 lines and React components under about 250. Past
  that, split by responsibility, not by line count alone.
- **Explicit over clever.** No metaprogramming, no dynamic imports except route-level lazy loading, no
  global mutable state except the documented singletons (`server/deps.py`, the live store, the socket).
- **Comments say why.** The *what* is the code. Long design reasoning goes in `docs/adr/` (X2 seeds
  it from `architecture.md`), with a link from the code.
- **Every environment variable lives in `troubadour.core.config`**, named `TROUBADOUR_*`, with a comment.
  Nothing reads `os.environ` elsewhere.

## 3. Keep feedback fast and deterministic

Agents iterate by running checks. Slow or flaky checks waste many runs, and a flaky test teaches people
to ignore red.

- **Scoped commands that take seconds:** `uv run pytest tests/test_x.py -q`, `pnpm -C web/<pkg> test`,
  `pnpm -C web/<pkg> typecheck`. Every package `AGENTS.md` lists them. `yarn check` is the gate before
  a commit, not the inner loop.
- **Deterministic tests:**
  - no network (`httpx.MockTransport`, `mockFetch`);
  - no real models (stubs in `conftest.py`);
  - no sleeps (fake timers; poll with a deadline in thread tests);
  - seeded randomness;
  - `TZ=UTC`;
  - formatters use an explicit locale (`Intl.DateTimeFormat("en-US", …)`), never `undefined`.
- **Fixtures over hand-written JSON.** Python: `conftest.py` fixtures. Web: builders in
  `@troubadour/api/testing`. Demo data: `backend/spike/seed/`, one module per domain, which is the same
  data every screenshot uses.
- **A safe sandbox in one command:** `scripts/scratch.sh <port>` (a throwaway seeded data dir, no
  models, no LLM, refuses the real port), `pnpm -C web/app shot <route>`, `pnpm -C web/app smoke`.
  An agent can see what it built without any risk to real data.
- **Actionable errors.** Error messages and assertion messages say what to do ("Backups wait until the
  session ends", "Run `yarn setup` first"), not only what failed.

## 4. Treat contracts as code

- **The API contract is the backend's pydantic models.** Every new or changed endpoint declares a
  `response_model`. `@troubadour/api` types for those endpoints come from the generated schema
  (`Schemas["Notebook"]`), not hand copies. Older endpoints are migrated when someone touches them.
- **WebSocket events** reuse those models for their payloads; the `ServerEvent` union names them.
- **Untrusted input is validated at the edge:** pydantic caps on every string and list; LLM output is
  validated (names, types, lengths, constrained choices) before anything is written.
- **Persisted formats** (vault notes, `meta.json`, `*.json` in session folders) are read leniently and
  written canonically, with a test for the old shapes. A change that needs a migration says so in its
  task and ADR.

## 5. Work in small, independently mergeable units

- One task = one branch = one focused commit, `<ID>: <title>`. The spec says which files the task owns;
  `dag.py` proves that parallel tasks don't overlap.
- **Pre-registered slots** (routes, routers, API domains, shell components, seed modules) are created
  empty by an early task, so later parallel tasks never edit the same registry file.
- **Generated files are never committed** (`schema.d.ts`, build output), so they can't conflict.
  Lockfiles change only in the tasks that own dependencies.
- **The integration branch stays green.** If `yarn check` fails after a merge, stop dispatching until it
  is fixed.
- **Definition of done:** acceptance commands pass, `yarn check` passes, a test fails without the change,
  the screenshot was compared (UI), and the report lists what's left.

## 6. Write specs agents can execute

The task specs in `docs/rebuild/tasks/` follow this shape. Keep using it for new work:

1. **Read first:** the exact files and sections, not "look around".
2. **Goal:** one paragraph on the outcome.
3. **Build or Steps:** names, signatures, shapes, the edge cases spelled out, and what *not* to do (the
   tempting shortcut).
4. **Tests:** the specific cases, including adversarial ones for anything an LLM feeds.
5. **Acceptance:** commands with an observable result. "Works" isn't an acceptance check.

Give example data as examples. A spec that shows "Session 13" means "the next session number". Hard-coded
sample copy from the designs is a bug.

## 7. Glossary (one word per idea)

| Term | Means | In code |
|---|---|---|
| Campaign | One game: its seats, vault and sessions | `Campaign` (engine), `CampaignInfo` |
| Player | A person in the library, seated in campaigns with a character | `Player`, `LibraryPlayer` |
| Class | A D&D class (SRD built-in or user-added); gives a player's colour | `DndClass`, `core.classes` |
| Voice | A cluster of speech the matcher heard; named when assigned to a player | `Voice` |
| Session | The live recording (`Session`) or a saved one (`SavedSession`, record in `transcript.json`) | `LiveSession`, `SavedSession` |
| Line | One transcribed utterance | `Message` (live), `RecordMessage` (saved), `ViewLine` (UI) |
| Vault | The campaign's Obsidian folder of notes | `Vault` |
| Entry | A codex note about a person, place, item… The UI says entry; the code says entity. | `Entity` |
| Fact | A lasting statement about an entry or the campaign, with source and confidence | `Fact` |
| Suggestion | A fact, entry or spelling proposed by a model, waiting for review | `FactSuggestion`, `ReviewItem` |
| Notebook | Live candidates during a session; nothing is written to the vault | `Notebook`, `NotebookItem` |
| Pin | A note typed during a session at a timestamp | `Pin` |
| Write-up | The session page a model writes after a session | `writeup.py`, job `writeup` |
| Review | Accepting or rejecting a session's suggestions beside their lines | `Review` |
| Recap | The shareable "Previously on…" built from reviewed facts | `Recap` |
| Scene | A stretch of a session with a title and place, from the write-up | `Scene` |
| Job | Long background work reported over the WebSocket | `CampaignJob` |
