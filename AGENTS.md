# Troubadour: agent guide

Troubadour live-transcribes an in-person D&D table from one shared mic: who is speaking, what they
said, and a campaign wiki that grows every session. **Everything runs
locally** on one Mac (Apple Silicon): Python engine + FastAPI in `backend/`, React UI in `web/`,
LLMs in LM Studio. No cloud calls at runtime, ever.

Design, measurements and history: `PLAN.md` (read the relevant section before changing a subsystem; it
records why things are the way they are). Layout and decisions: `docs/architecture.md`, `docs/adr/`.

## Commands (repo root, yarn 4)

| Task | Command |
|---|---|
| Install everything | `yarn setup` (uv + pnpm) |
| Run the app | `yarn start` → http://127.0.0.1:8765 (serves `web/dist`; `yarn build` first) |
| API + Vite, with fast refresh | `yarn dev` |
| UI dev server only | `yarn dev:web` (Vite, proxies to :8765) |
| All checks (run before every commit) | `yarn check` = format:check, lint, typecheck, tests, build |
| Format | `yarn format` |
| Safe sandbox: seeded throwaway server, no models, refuses :8765 | `scripts/scratch.sh 8790` |
| Screenshot one route / visit every route (headless, muted) | `pnpm -C web/app shot <route> out.png --port 8790` / `pnpm -C web/app smoke --port 8790` |
| Live regression check against a running server | `yarn check:live` |

From the repo root, `pnpm -C web/...` needs `COREPACK_ENABLE_STRICT=0` (or `cd web` first). The shell may
have `CI=true`: a first `yarn install` needs `--no-immutable`. Scoped commands for the inner loop are in
`backend/AGENTS.md` and `web/AGENTS.md`; `yarn check` is the gate, not the loop.

## Layout

```
backend/packages/<pkg>/src/troubadour/<pkg>/   core, sound, lore, cloud, engine, server (a uv workspace)
backend/tests/      pytest for all packages; no models or network needed
backend/spike/      research and ops scripts (benchmarks, soak tests, harden_check); spike/seed builds the demo data
web/app/            @troubadour/app: routes, shell, pages, shared domain components (React 19, Vite, Tailwind v4)
web/packages/       @troubadour/ui (components), @troubadour/api (contract, hooks), @yipe/tokens (colour tokens)
web/dist/           built UI, served by the backend (git-ignored)
shared/test-vectors/ JSON cases that both Python and TypeScript implementations must pass
docs/               architecture.md, conventions.md, glossary.md, adr/, design/ (handoff), rebuild/ (history)
~/troubador/       USER DATA, git-ignored: state, recordings, sessions, campaign vault
```

Deeper guides: `backend/AGENTS.md`, `web/AGENTS.md`, and a short `AGENTS.md` in each web package.

## Hard rules

1. **Never touch `~/troubador/`** in tests or experiments. It holds real players, voiceprints, hours
   of recordings and the user's Obsidian vault. Tests use tmp dirs (the `dirs`/`engine` fixtures).
   For a scratch server: `TROUBADOUR_PORT=8767 TROUBADOUR_DATA=/tmp/<name> uv run troubadour`.
2. **Never play audio** on the machine. Browsers you drive must be headless with `--mute-audio`.
   Don't start mic sessions; they record the room. Unit tests fake the mic.
3. **Local by default.** The LLM is LM Studio at `http://127.0.0.1:1235/v1`. Two opt-in exceptions, and
   tests never reach either (`httpx.MockTransport`): **Troubadour Cloud** backup (`troubadour.cloud.backup`; nothing is
   sent until the user clicks Connect, and it only uploads the vault) and a **hosted language model**
   (`troubadour.core.providers`: ChatGPT plan, OpenRouter, Anthropic API, DeepSeek API; nothing is sent until the user
   signs in or adds a key *and* picks it in Models). Whisper and voices never leave the Mac. Never use a
   subscription sign-in a provider doesn't allow for third-party apps (Claude's).
4. **Only restart the server (`:8765`) when `GET /api/state` shows `session.status == "idle"`.**
   A real game may be running.
5. **Licensed data and privacy (this repo is public):** only SRD names (CC-BY-4.0, attributed) are
   committed (`backend/packages/lore/src/troubadour/lore/srd_terms.json`); check additions against the SRD text. No other
   D&D product content, no real people's names (tests use made-up players), and don't name where
   a larger local list (`~/troubador/dnd_terms.json`) comes from. `backend/local/` is git-ignored
   for local-only tools.
6. `yarn check` must pass before a commit. Small, focused commits; push to `origin main`; never
   force-push without the owner's say-so.

## Conventions

Short form of `docs/conventions.md` (read it for the reasons).

1. **Tools enforce the rules; add the check with the rule.** Python layers `server -> engine -> cloud ->
   lore | sound -> core` (import-linter, `tests/test_layers.py`); `ui` never imports `api`, no `fetch` in
   `app/` or `ui`, pages never import pages (oxlint); basedpyright with a committed baseline that only
   shrinks (`backend/.basedpyright/`); API types generated from FastAPI's schema; `tests/test_routes.py`
   pins every route.
2. **Easy to find, safe to change.** A web page lives in `web/app/src/pages/<page>/` with its private
   components and tests. One idea per file, named after its export. Named exports only (route modules
   export `Component`); no barrels. Rule of two: share code on its second real use. Modules stay under
   about 600 lines (Python) and 250 (React). Comments say *why*. Every env var is read in
   `troubadour.core.config`, named `TROUBADOUR_*`.
3. **Fast, deterministic feedback.** No network (`httpx.MockTransport`, `mockFetch`), no real models, no
   sleeps, seeded randomness, `TZ=UTC`, explicit `en-US` locale. Fixtures over hand-written JSON
   (`conftest.py`, `@troubadour/api/testing`, `backend/spike/seed/`). Error messages say what to do.
4. **Contracts are code.** New or changed endpoints declare a pydantic `response_model` and use
   `Schemas["X"]` on the web side. Validate input at the edge (length caps on every string and list). Any
   LLM output is untrusted: validate names, types and lengths, and constrain choices before writing
   (see `lore/memory.py`, `lore/cleanup.py`). Persisted formats are read leniently, written canonically.
5. **Small, mergeable units.** One focused commit per change. Generated files (`src/generated/`, build
   output) are never committed. Slots (routes, routers, API domains, seed modules) are registered once so
   parallel work does not collide. Keep `main` green.
6. **Specs agents can execute:** exact files to read, goal, steps with the shortcuts to avoid, specific
   tests, and acceptance as commands with an observable result.

Domain rules that apply everywhere:

- Every behaviour change gets a test that fails without it. Prefer boring, explicit code; delete dead code.
- Text offsets that cross the API are **UTF-16 code units** (what JS uses); Python works in str
  indices. Convert with `transcript.utf16_offset` / `utf16_to_py` (`troubadour.core.transcript`).
- Long work (note import, write-ups, improve, spelling, recap, notebook pass, backup) runs as background
  jobs reported over the WebSocket (`campaign.job`, `notebook.updated`); never block a request on an LLM
  or Whisper.
