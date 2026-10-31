# Self-review of the plan

I reviewed the plan as if I were a lead about to hand it to a team. Each finding below has already been
applied to the specs and the DAG (`dag.py` still passes: 70 tasks, no ownership conflicts).

## Footguns found and fixed

| # | Footgun | Where it would have bitten | Fix |
|---|---|---|---|
| 1 | **Tailwind v4 skips the workspace packages.** It only scans files under the app's root, so classes used in `@troubadour/ui` would be missing from the build. Tests pass (jsdom has no CSS), and the app looks unstyled. | U1, S1, every page | `@source "./"` in `ui/src/theme.css` and in the app's `index.css` (U1, S1) |
| 2 | **Importing the server touches real data.** `troubadour.server.app` builds the Engine at import, which reads `~/troubador`. Any script that imports it, such as the OpenAPI export, would do the same. | B6, any future tooling | The export sets a temp `TROUBADOUR_DATA` before importing, with a test (B6). Recorded as known debt with the fix (an app factory), `architecture.md` decision 10 |
| 3 | **Root lint scripts named a path that moves.** W1 changed `src` → `packages` while B1 moves the code. Whichever merged first left the branch red. | W1 ∥ B1 | The scripts run `ruff check .` from `backend/`, which works before and after the move (W1, B1) |
| 4 | **Hand-mirrored API types** (`types.ts` "change both together"). With many parallel contract tasks, drift is the most likely bug. | every C task | B6: types generated from FastAPI's OpenAPI schema, never committed (no merge conflicts); new endpoints must declare `response_model` (contract rule in each C spec) |
| 5 | **The same logic in two languages** (session numbering, `h:mm:ss`) with "the same tests" written twice. They drift. | S2 ∥ C2, C5 | `shared/test-vectors/*.json` read by pytest and vitest (P0, S2, C2, C5) |
| 6 | **Locale- and timezone-dependent output.** The old formatters call `toLocale*(undefined, …)`, so tests pass on one machine and fail on another. | S2 and every date in the UI | Explicit `"en-US"` in formatters, `TZ=UTC` in the test script (S2, W1) |
| 7 | **No Python type checker** on a codebase that's about to have six packages and many hands. | everything after B3 | basedpyright with a committed baseline: old errors recorded, new ones fail (B5) |
| 8 | **Boundaries enforced only by prose** ("ui must not import api", "no fetch in components", "pages don't import pages"). Agents miss prose. | U, S, F tasks | oxlint `no-restricted-imports` / `no-restricted-globals` overrides plus pnpm strict deps, each proven with a planted violation (W1) |
| 9 | **URLs as string literals** across ~20 pages; one route change means a grep-and-pray. | F tasks | `app/src/paths.ts` typed builders, required by README rules (S1) |
| 10 | **Default exports + lazy routes** invite mismatched names and break grep/rename. | S1, F tasks | Named exports only; route modules export `Component` (S1, rules) |
| 11 | **Design copy hard-coded** ("Session 13", "Jabra Speak 710"). Sonnet copies examples literally. | every F task | A README rule: design copy is example data |
| 12 | **`main` keeps moving** (the owner shipped write-up UI changes today). A long-lived branch that renames every Python file is a merge trap. | the whole run | README *Keep up with `main`*: merge `main` before each wave, a short freeze on backend changes during B1–B3, carry over legacy-UI changes by hand |
| 13 | **Ten agents running `yarn check` at once** slows every one of them and invites timeouts. | waves 6–9 | Cap about six concurrent agents; scoped commands while working; stop dispatching when the integration branch is red |
| 14 | **The `@yipe/tokens` name exists on npm's scope.** A plain version range could resolve the registry. | U0 and later | `workspace:*` dependency (W1) |
| 15 | **Weak TS defaults.** Indexing records and arrays returns `T` rather than `T \| undefined`, which hides missing-key bugs in maps keyed by player and session ids. | all web | `noUncheckedIndexedAccess`, `noImplicitOverride` in `tsconfig.base.json` (W1) |
| 16 | **Guides didn't scale.** Three big `AGENTS.md` files for a ten-package repo; agents load the nearest one. | everyone after the rebuild | A short `AGENTS.md` (+ `CLAUDE.md` symlink, the repo's convention) per package (B1, W1). Task reports feed X2, which refreshes them |
| 17 | **Decisions lived in one long file**, unfindable a year later. | after the rebuild | X2 seeds `docs/adr/` (template + one ADR per decision) |
| 18 | **Smoke test ran only by hand.** Broken routes reach `main`. | after the rebuild | X2 adds a CI smoke job with screenshots as an artifact |
| 19 | **Missing JobStatus dependencies.** F1, F8 and F14 show job progress but didn't depend on S6, so they could start before it existed. | F1, F8, F14 | Deps added; `dag.py` checks every spec header against `dag.toml` |
| 20 | **Non-SRD names in a public repo** (DPRcalc's artificer colour). | U0, C1 | The sync drops it; classes are a loadable list, SRD built in, user-added ones in the data dir (your suggestion) |

## Cleanups and modernisation applied

- **One vitest run** for the workspace (`test.projects`) instead of `pnpm -r test`.
- **Subpath exports, no barrels**, for ui and api: faster tests, honest import graphs, no circular-import surprises.
- **TanStack Query for server state** with a single serial `campaignWrite`. This replaces five stores, three
  duplicated fetch/loading/error patterns and the hand-rolled queue.
- **One formatter set, one sign-in-tab helper, one `useJob`**: merges the duplicates the inventory found
  (`docs/rebuild/inventory/web.md` §9).
- **Pre-registered slots** (routes, routers, API domains, shell components, seed modules), so parallel tasks
  never edit the same registry file.

## Considered and deliberately not done

React Compiler, Storybook, zod response validation, pixel-diff visual tests, pre-commit hooks, CODEOWNERS,
converting all 70 existing endpoints to response models at once, and composing the Engine instead of
using mixins. Each is either new for its own sake here, or a big-bang change with no behaviour gain.
Reasons are in `architecture.md`, decisions 2, 9, 10 and 11.

## Residual risks (watch these during the run)

1. **B1–B3 are large mechanical moves.** The test suite is the safety net; B2 and B3 pin the test count and
   route list. Review those diffs with `git diff -M` (rename detection) and look only at non-rename hunks.
2. **C7 touches the write-up prompts** (a measured, tuned pipeline). The spec limits changes to the facts
   step and adds a separate scenes call. Quality can only be judged on real sessions, so X3 includes an
   owner-run round trip.
3. **The cloud history and the main device depend on the separate cloud service's API** for the device name
   of another Mac. C12 degrades to "another Mac".
4. **S1 is a bottleneck** (about 30 tasks wait on it). Give it the strongest reviewer.
