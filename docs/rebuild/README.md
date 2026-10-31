# Troubadour rebuild: the plan

> **History.** This is the record of a finished rebuild, kept as it was written. It describes the
> project at that time (Mac only, older commands). For how things are now, see the root README,
> [INSTALL.md](../../INSTALL.md), [AGENTS.md](../../AGENTS.md) and [docs/architecture.md](../architecture.md).

This rebuilds the web UI to the redesign in `docs/design/troubadour-redesign/`, splits the backend into
packages, and leaves a clean base to iterate from. The work is cut into **70 small tasks in a DAG**
(`dag.toml`). Each one is a spec a Sonnet agent can run on its own (`tasks/<ID>.md`).

| File | What it holds |
|---|---|
| `dag.toml` | Task ids, dependencies, the files each task owns. The source of truth. |
| `dag.py` | Checks the DAG and file ownership, prints waves and the tasks that are ready to start. |
| `../architecture.md` (moved by X2) | Target layout (Python packages, web packages), tech choices, API contract changes, decisions. |
| `design-system.md` | Tokens (shared with DPRcalc), Tailwind mapping, the component catalogue and where each component lives. |
| `../conventions.md`, `../glossary.md` (moved by X2) | The working agreements the rebuild leaves behind: what tools enforce, file and naming rules, deterministic tests, contracts, how to write agent-ready specs, glossary. |
| `review.md` | The self-review of this plan: footguns found and how the plan handles them. |
| `page-map.md` | Each design screen mapped to its route, the current code and its tasks. Also where every existing feature ends up, and what is deferred. |
| `tasks/*.md` | One spec per task. |

## Waves (`python3 docs/rebuild/dag.py`)

```
wave 0: P0
wave 1: B1, W1
wave 2: B2, B4, U0, A1, X1
wave 3: B3, W2, U1, A2, S2
wave 4: B5, U2, U3, U4, A3, C5
wave 5: B6, S1
wave 6: S3, S6, S7, S9, S11, S13, C1, C2, C6, C11, C12
wave 7: S4, S8, S10, S12, S14, C3, C7, C10, C14, F4, F18
wave 8: S5, C4, C8, C9, F2, F3, F7, F9, F11, F16, F19, F20, F21, F22
wave 9: C13, F1, F5, F6, F8, F10, F12, F13, F14, F17
wave 10: F15
wave 11: X2
wave 12: X3
```

Lanes: **P** prep · **B** backend restructure · **W** web workspace · **U** tokens and `@troubadour/ui` ·
**A** `@troubadour/api` · **S** app shell and shared components · **C** backend features with their
contract · **F** pages · **X** finish. A wave is the earliest a task can start. Don't wait for the whole
wave: start any task once `dag.py --done …` lists it.

## Before anything runs: the owner signs off on these

The design handoff's `AGENT_PROMPT.md` asks for a check-in before the API contract changes or facts move
to a new vault format. This plan does both, so these are settled once, up front, rather than per task:

1. **Contract changes** (`architecture.md` → *API contract changes*): every new field and endpoint.
2. **Fact storage** (`architecture.md` → *Fact format in the vault*): the new bullet format. Old notes
   still parse.
3. **Python packages** (`architecture.md` → *Backend*): module moves and the new import paths.
4. **Shared tokens and classes** (`design-system.md` → *Shared with DPRcalc*): `@yipe/tokens` is copied
   from `~/src/dpr` now and published later. Only the 12 SRD classes are built in; users add others (for
   example an artificer) in the app, stored in their data dir (C1).
5. **Tooling added by the review** (`review.md`): basedpyright with a baseline, generated API types,
   boundary lint rules, shared test vectors.
6. **Out of scope** (`page-map.md` → *Deferred*).

## Running it (orchestrator)

The orchestrator is a person or an Opus-class agent. Sonnet agents run the tasks.

1. Integration branch: `yipe/rebuild` (this worktree). Never push to `main` until X3 passes and the owner says so.
2. For each ready task, create a worktree and branch off the integration branch:
   `git worktree add ../rebuild-<ID> -b rebuild/<ID> yipe/rebuild`
   then `yarn setup` in the new worktree.
3. Hand the agent this prompt (fill in `<ID>` and `<PORT>`):

   > You are running task `<ID>` of the Troubadour rebuild, in this worktree.
   > Read `docs/rebuild/README.md` (*Rules for task agents*), then `docs/rebuild/tasks/<ID>.md`, then
   > every file that spec lists under **Read first**. Change only paths listed for `<ID>` under `owns`
   > in `docs/rebuild/dag.toml`. Use port `<PORT>` for any scratch server. When the acceptance checks
   > pass, commit with the message `<ID>: <title>` and report: what you changed, how you checked it, and
   > anything you could not do.

4. Review the diff (`git diff yipe/rebuild...rebuild/<ID>`). Merge with `git merge --no-ff`. Run
   `yarn check` on the integration branch after every merge. Fix any merge conflicts here, not in the task.
5. Mark the task done and run `python3 docs/rebuild/dag.py --done <all done ids>` to see what is ready.
6. Ports: give every task that runs at the same time its own port (8770, 8771, …). Port **8765 belongs
   to the real app** on `main` (`/Users/michael/src/bard`).

**Keep up with `main`.** The real app keeps changing on `main` while this runs. Merge `main` into
`yipe/rebuild` before each wave. Git follows the `git mv` renames from B1; check `git log --follow` on a moved
file. Ask the owner to hold backend changes on `main` while B1–B3 land (about a day), and to note any UI
change made on `main` meanwhile: the legacy app is frozen, so those changes have to be carried into the new
pages by hand.

**Pace.** Run at most about six agents at once. Each `yarn check` runs the whole Python and web suites, and
more parallel runs only slow each other down. Agents use the scoped commands while working and `yarn check`
once before committing. If the integration branch goes red, stop dispatching until it's green.

If a task fails its acceptance three times, stop that task, write down the assumption that looks wrong,
and fix the spec before running it again.

## Rules for task agents

The repo's `AGENTS.md`, `web/AGENTS.md` and `backend/AGENTS.md` still apply. On top of them:

**Safety (non-negotiable)**
- Never read or write `~/troubador/`. Never run `yarn start`, or anything else that binds port 8765 or
  uses the default data dir. For a server, use `scripts/scratch.sh <PORT>`: a throwaway data dir under
  `/tmp`, seeded with the demo campaign.
- Never play audio. Never start a mic session. Any browser runs headless with `--mute-audio`
  (`web/app/scripts/shot.ts` does both).
- No network calls in tests: `httpx.MockTransport` in Python, `mockFetch` in the web tests.

**Scope**
- Edit only the paths your task owns in `dag.toml`. There are two exceptions. You may make minimal fixes
  to existing tests under `backend/tests/` that your change breaks. You may add rows to a seed module you
  own. Anything else outside your paths: stop and report it.
- Don't add dependencies. W1 and B1 install everything the plan needs. If you truly need one, stop and
  report it.
- Don't edit `PLAN.md`, `AGENTS.md`, `README.md`, `web/AGENTS.md` or `backend/AGENTS.md`. X2 updates
  them once, using the **Contract** section of each task.
- Out of scope means out of scope. Don't build the alternatives (1d, 1i, 1j, 1l, 1m, 3b, 3c) or anything
  in `page-map.md` → *Deferred*.

**Code**
- Boring, explicit code. Comments explain *why*. Delete dead code; don't leave the old version next to
  the new one.
- **Rule of two:** a component or helper becomes shared only on its second real use. One user: it stays in
  that page's folder. `design-system.md` lists what is already shared. Don't add to `@troubadour/ui` or
  `app/src/components` unless the catalogue or your spec says so.
- Web: server data comes only through `@troubadour/api` query hooks. Never call `fetch` in a component.
  Never put server data in zustand; the live-session store is the one exception. Campaign writes go
  through `campaignWrite` (serial).
- Web styling: Tailwind utilities from the token mapping (`bg-surface`, `text-ink-muted`, `border-line`…).
  No raw hex, no `style` colours except a player or class colour passed as a CSS variable.
- Python: pydantic input models with length caps on every string and list. Map errors with `_call`. Treat
  all LLM output as untrusted: validate names, types and lengths, and restrict choices before writing.
- Text offsets that cross the API are UTF-16.
- Named exports only (route modules export `Component`); no barrels; links through `paths.*`; dates
  formatted with an explicit `"en-US"` locale. See `conventions.md`.
- Design copy is example data. "Session 13", "Jabra Speak 710" and "Alex" in a spec or a design mean
  "the computed value". Never hard-code them.
- New or changed endpoints: pydantic `response_model`, generated TS types (`Schemas["X"]`). Never edit
  anything in `src/generated/`.
- Your report lists anything that belongs in a package `AGENTS.md` (a new invariant, command or gotcha).
  X2 writes them in.

**Tests and checks**
- From the repo root, `pnpm -C web/...` refuses to run because the root `package.json` names yarn as its
  package manager. Prefix it: `COREPACK_ENABLE_STRICT=0 pnpm -C web/app shot …`, or `cd web` first.
- Every behaviour change gets a test that fails without it. Pure helpers get unit tests. Pages get
  Testing Library tests for their main interactions, with `mockFetch` and the fixtures in
  `@troubadour/api/testing`.
- Run the task's acceptance commands, then `yarn check`. Both must pass before you commit.
- UI tasks: take a screenshot of your route against the seeded scratch server (`pnpm -C web/app shot
  <route> /tmp/<ID>.png --port <PORT>`) and look at it next to the design PNG the spec names. Fix
  differences in layout, spacing, type and colour. List any that remain in your report.
- Exact values (sizes, gaps, copy) are in the inline styles of the matching `.dc.html` file in
  `docs/design/troubadour-redesign/`. Read it as text. Don't copy its markup.

## Shared files

`dag.py` guarantees that tasks running at the same time own different paths. Two exceptions merge by hand:
existing `backend/tests/*` touched by minimal fixes, and `web/pnpm-lock.yaml` if someone breaks the
no-new-dependencies rule. Pre-registered slots keep everything else apart:
- **Routes:** S1 creates every route with a stub page (`app/src/pages/<page>/index.tsx`). Page tasks
  replace their own folder.
- **API domains:** A1 creates every domain folder (`@troubadour/api/<domain>`), including the new ones.
  C tasks fill in their own folder.
- **Routers:** B3 creates every FastAPI router, including empty ones for the new endpoints, and
  registers them in `app.py`.
- **Shell slots:** S1 creates `CampaignSwitcher`, `CloudChip` and `AccountMenu` as stubs. S11, S12 and
  S13 fill them in.
- **Seed:** B4 splits the demo seed into one module per domain. C tasks extend the module they own.
