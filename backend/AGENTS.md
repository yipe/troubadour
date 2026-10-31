# Backend agent guide (Python 3, uv, FastAPI)

A uv workspace of six packages under `backend/packages/<pkg>/src/troubadour/<pkg>/` (PEP 420 namespace
packages: no `troubadour/__init__.py`). One test suite for all of them in `tests/`. Run from `backend/`:

| Task | Command |
|---|---|
| Server | `uv run troubadour` (real data dir; use `scripts/scratch.sh` instead for experiments) |
| Scratch server: seeded demo data in `/tmp`, no models, refuses :8765 | `scripts/scratch.sh 8790` (repo root) |
| Tests, one file / all | `uv run pytest tests/test_x.py -q` / `uv run pytest -q` |
| Lint (ruff + import-linter), format | `uv run ruff check .` and `uv run lint-imports`, `uv run ruff format .` |
| Types (basedpyright, committed baseline in `.basedpyright/`) | `uv run basedpyright` |
| Research scripts | `uv run --group spike spike/<script>.py` |
| Dump the OpenAPI schema | `uv run python -m troubadour.server.openapi <out.json>` |

## Layering (enforced)

```
server -> engine -> cloud -> lore | sound -> core
```

A package imports only from the packages to its right; `lore` and `sound` never import each other.
`tests/test_layers.py` runs import-linter on this contract, so `yarn check` fails on a violation.
`lore` has no ML dependencies (facts, write-ups, Ask, review, recap stay testable without torch or MLX);
`sound` holds every model that touches audio and shares `asr.mlx_lock`; `engine` orchestrates; `server`
only translates HTTP into engine and lore calls. `troubadour-cloud` imports `lore` only under
`TYPE_CHECKING`. Why: `docs/architecture.md`, `docs/adr/0001`.

## Modules

| Package | Module | Role |
|---|---|---|
| `core` | `config` | Env-driven settings (`TROUBADOUR_*`; the only place that reads `os.environ`). Paths like `vault_dir()` resolve per call so tests can redirect them. |
| | `settings` | Model choices saved on this machine (provider, local and hosted models); env defaults apply until changed. |
| | `providers` | Opt-in hosted LLMs: ChatGPT plan sign-in (OAuth + plan usage), OpenRouter sign-in, pasted keys, the wire formats `MemoryLLM` uses. With `cloud.backup`, the only network code besides the local LLM. |
| | `transcript` | Saved record shape (`build`), Markdown export, UTF-16 helpers. |
| | `classes` | Player classes: the 12 SRD ones built in plus user-added ones in `DATA_DIR/classes.json`. |
| | `fsutil` | `write_atomic`. |
| `sound` | `audio` | `MicSource` (native rate to soxr 16 kHz), `FileSource` (paced replay), `Recorder` (48 kHz WAV, background writer). |
| | `segment`, `levels`, `mics` | VAD cutting, level/quality metering, microphone listing and per-device settings. |
| | `asr` | mlx-whisper; prompt with glossary names and the last lines; `suspicious()` drops echoed or looping prompted output. |
| | `voices` | Speaker embeddings and the voice matcher. |
| | `tts` | Voice clones (opt-in per player): Chatterbox + DeepFilterNet on MLX, `Clones` (`data/clones/`), choosing clean references, note to speakable text. |
| `lore` | `campaign` | Obsidian vault: `Vault`, entity notes (frontmatter + Facts sections), `Corrector`, `everyday()`. |
| | `facts` | Facts as vault bullets: parse and render the trailer (source, speaker, confidence); ids; history. |
| | `memory` | Campaign jobs (note import, session write-up, scenes), the job runner (`Job.update()` / `advance()`), spelling suggestions. |
| | `writeup` | Session write-up: read the transcript into notes, write the page (`writeup_example.md` sets the style), facts from the notes. Measured with `spike/writeup_lab.py`. |
| | `pages` | Reading a write-up page (title, wrap-up) and `session_numbers`, the one numbering rule. |
| | `review` | Post-session review items anchored to transcript lines; decisions in `sessions/<id>/review.json`. |
| | `notebook` | Tonight's notebook, the LLM half (pure: the model is passed in). |
| | `timeline`, `recap` | The story so far; the shareable "Previously on" (`recap.json`). |
| | `ask` | Questions answered from transcripts and notes (LLM plan, BM25 search, LLM answer with citations). `_Overview/` is skipped. |
| | `cleanup`, `talk`, `obsidian` | Spelling cleanup (`Speller.find` code, `ask` constrained LLM, `apply`); speech profile and "in their words"; finding the vault in Obsidian's registry. |
| | `dnd_terms` | D&D vocabulary: committed SRD list (`srd_terms.json`) plus an optional local list in the data dir. |
| `cloud` | `backup` | Opt-in Troubadour Cloud: OAuth PKCE sign-in, vault scan, plan, signed uploads, commit; the attempt log `cloud_history.json`. |
| | `overview` | Writes `_Overview/*.md` into the vault before a backup. |
| `engine` | `core` + `_pipeline`, `_sessions`, `_library`, `_voices`, `_training` | `Engine` is one class assembled from these mixins. Threads: segmenter, worker (Whisper to message), LLM health check, refine loop, spelling cleanup, training. Owns the player library, campaigns, voices, messages, sessions, autosave. |
| | `live_session`, `buffers`, `model`, `state`, `paths`, `bus` | One listening run; its audio; players/voices/messages; `state.json` and its migration; paths; the event bus. |
| | `notebook` | The live notebook and its loop (`NotebookLoop`, started from `_pipeline.bind_notebook`). |
| | `improve`, `cloning`, `sim` | Post-session re-transcription and spelling fixes; clone jobs (HTTP-free); `troubadour-sim`. |
| | `pipeline` | The processing steps and their versions; the "refresh" job (Refresh this session, Upgrade old sessions). See *Pipeline versions*. |
| `server` | `app`, `deps`, `models`, `static`, `main` | FastAPI app, shared singletons, request models used by 2+ routers, the built UI, entry point. |
| | `routers/*` | One router per domain: `state`, `session`, `sessions`, `players`, `voices`, `campaign`, `ask`, `notebook`, `review`, `timeline`, `recap`, `clones`, `cloud`, `llm`, `audio`, `storage`. |
| | `openapi` | Schema export for the web types (sets `TROUBADOUR_DATA` and `TROUBADOUR_MODELS=0` first). |

## Data directory (`DATA_DIR`, `~/troubador` by default)

`state.json` (players, campaigns, voices), `mics.json` (microphone corrections), `classes.json` (custom classes), `cloud_history.json` (backup
attempts, 90 days), `voices/`, `clones/`, `campaigns/<id>/` (vault for non-`main` campaigns),
`sessions/<id>/` with `transcript.{md,json}`, `meta.json`, `audio.wav`, `setup/`, and the rebuild's
`notebook.json`, `review.json`, `scenes.json`, `recap.json`. The vault gets a generated `_Overview/` folder
(read-only summaries for the cloud player). Vault layout and what Troubadour owns in a note: `PLAN.md` →
*Campaign memory*.

## Environment switches

`TROUBADOUR_MODELS=0` skips loading Whisper, the embedder and the VAD (ASR state stays `loading`); the
scratch server and the OpenAPI export use it. `TROUBADOUR_NOTEBOOK=0` turns the live notebook loop off.
Other switches (`TROUBADOUR_RECORD`, `CLEANUP`, `ASR_PROMPT`, `DATA`, `VAULT`, ports) are in `core/config.py`.

## Demo seed

`spike/seed_demo.py <data_dir>` builds the demo campaign (refuses a non-empty dir without its marker file, and anything inside the real data dir);
`scripts/scratch.sh` runs it. One module per domain in `spike/seed/` (`players`, `sessions`, `vault`,
`notebook`, `common`): extend the module that owns the data. Screenshots, `smoke` and CI use this data.

## Invariants (break these and something subtle breaks)

- **Session isolation:** work for an abandoned session must never write shared state. Check
  `sess is self.live` under `self.lock` before mutating; message ids are unique across sessions.
- **Locks:** `engine.lock` (RLock) guards players/voices/messages; never call Whisper, the LLM or
  disk-heavy work while holding it. `asr.mlx_lock` serializes MLX (Whisper, the voice clone); `embed_lock` serializes torch MPS.
- **A broken vault, a down LLM, or a full disk never stops transcription.** Catch, log, carry on.
- **Patches, not replacements**, for anything a UI may click quickly (`Vault.review`, ignore list).
- **Never lose words:** improve keeps a line's old text if Whisper now hears nothing; every spelling
  fix records what was heard (`fixes`); the first rewrite of a saved transcript backs up
  `transcript.orig.json`.
- **Vault notes are the user's:** Troubadour owns only the documented frontmatter keys, the description,
  `## Facts` and `## Suggested facts`. Keep other keys/tags/sections verbatim; never rewrite a note
  whose frontmatter doesn't parse (`read_only`); deletes go to `.trash/`.
- **Spelling cleanup must not touch everyday speech:** dictionary words and their forms, case-only
  changes to D&D terms, spelled-out letters and aliases are never fixed. Add a test for any new rule.

## Pipeline versions (refresh and upgrade)

`engine/pipeline.py` lists the steps that process a saved session (`transcribe`, `speakers`, `spelling`,
`talk`, `in_character`, `writeup`, `review`, `recap`), each with an integer `version`. `session.pipeline`
(`{step: version}`, in `meta.json` and `transcript.json`) is written when a step finishes; a session without it
is version 0 of everything. `GET /api/sessions/upgrades` lists sessions with a step below the current version
(only steps the session can run and has output of); `POST /api/sessions/upgrade` queues a `refresh` job per
session, oldest first, running only those steps; `POST /api/sessions/{sid}/refresh` runs every step that can
run. Never during a live session (409). A failed step stops the job and earlier steps stay recorded.

- **Bump a step's `VERSION` only when its output meaningfully changes** (new prompt, new rule, new fields).
  Every saved session then offers an upgrade; a bump for a refactor or a bug in unrelated code just makes the
  owner wait for nothing.
- A new step goes in `STEPS` in dependency order, reuses the existing job code (don't copy it), says why it
  can't run (`skip`) and whether a session has anything of its kind to upgrade (`upgrades`).
- What it must keep: the first transcript as `transcript.orig.json` (taken before the first rewriting step), the
  old write-up page copied to the vault's `.trash`, old `review.json`/`recap.json` archived beside the new ones,
  confirmed facts untouched (new facts are suggestions, deduped with `same_fact`).
- Live sessions are saved with the steps listening already did (`LIVE_STEPS`); keep that list honest when a
  step is added.

## Testing

- No models, no network: Whisper is stubbed (`troubadour.asr.transcribe`), the embedder is a fake,
  `engine.cleanup_llm.json` raises unless a test patches it, and the generated D&D list is hidden
  (`hermetic_dnd_terms`). Keep it that way.
- Use the fixtures in `tests/conftest.py` (`dirs`, `engine`, `tone`, `speak`, `write_wav`; voice clones:
  `FakeSynth`, `ScriptedLLM`, `job()`, `fake_vad`).
- Fake LLMs return scripted JSON (`tests/test_memory.py::FakeLLM`); include adversarial outputs
  (junk names, invented spellings) when testing anything an LLM feeds.
- Piping pytest through `tail` hides its exit code: check `${PIPESTATUS[0]}` or don't pipe.
- Real-data experiments go in `spike/` and read `data/` read-only; results go in `samples/` (ignored).

## Adding an API endpoint

1. Put it in the router for its domain (`server/routers/<domain>.py`); a new route also goes in
   `tests/test_routes.py` (it pins the full list).
2. Validate input with pydantic models (length caps on every string and list) and declare a
   `response_model`; the web types come from it (`pnpm -C web/packages/api gen`, `Schemas["X"]`).
3. Map errors with `_call` (KeyError becomes 404, ValueError 400). Pydantic validation failures are 422.
4. Mutations of the vault call `memory.changed()` (regenerates `Glossary.md`, emits `campaign.updated`).
5. Add the hook in `web/packages/api/src/<domain>/` and the endpoint to the API list in `PLAN.md`.

## Gotchas

- Importing `troubadour.server.app` builds the Engine (`deps.py` singletons): set `TROUBADOUR_DATA` first
  in any script. Routers use `from troubadour.server import deps` and `deps.engine`, never
  `from .deps import engine` (tests patch `deps.*`).
- Fact ids are the first 10 hex of sha1 of `about + "\n" + norm(text)`; a write addresses the latest id.
  `facts.py` has its own `norm` (avoids an import cycle).
- `Engine.bind_notebook(sess)` is needed for sessions created without `start()`. Notebook tests spawn idle
  daemon threads; no final LLM pass runs for lines transcribed after Stop.
- Session `talk` in `meta.json` is not refreshed by Retranscribe or Improve; the pipeline's `talk` step
  (Refresh) does. `present_player_ids == []` means everyone.
- An encoded-slash path (`..%2F`) may hit the built UI's fallback route (200 html / 405) instead of the API's 404; traversal tests accept that.
- `routers/review.py` imports its output models from `routers/campaign.py`.
- A cloud `GET /api/cloud` may call the service (connected only, 3 s cap, 60 s cache).
- Scenes need at least 2 usable beats or none are stored.

