# Troubadour — live TTRPG transcription (tech demo)

Goal: check feasibility of near-real-time, speaker-labeled transcription of an
in-person D&D 5e table (one shared mic). Game-mechanics highlighting (regex + LLM tags)
was built, then removed on 2026-10-16 at the owner's request: transcript and audio quality only.
Everything runs locally. Every measurement here is from one Apple Silicon Mac (M5 Max, 128 GB) on MLX;
Linux and Windows run Whisper on faster-whisper instead (`docs/adr/0011`).

## Run

Full instructions: [INSTALL.md](INSTALL.md). In short:

1. `./install.sh` (or `.\install.ps1` on Windows): checks prerequisites, `uv sync`, `pnpm install`, builds the UI.
   `yarn setup` is the developer version; `yarn build` after UI changes.
2. Optional local LLM: LM Studio serving `google/gemma-4-26b-a4b-qat` on port 1235
   (`lms server start --port 1235 && lms load google/gemma-4-26b-a4b-qat --yes`). Override with
   `TROUBADOUR_LLM_URL` / `TROUBADOUR_LLM_MODEL`.
3. `HF_TOKEN=… yarn start` → http://127.0.0.1:8765. Needs a Hugging Face
   token with access to `pyannote/speaker-diarization-community-1`
   (`HUGGING_FACE_TOKEN` is also accepted).

Sample files for replay live in `backend/samples/eval/` (built by
`spike/dataset.py`). Players, campaigns and named/trained voiceprints persist in
`~/troubador/state.json` (`TROUBADOUR_DATA`). UI dev server: `yarn dev:web` (proxies to 8765).

## Develop

Root `package.json` scripts (yarn) drive both halves; the backend uses uv,
the web app pnpm.

| Command | Does |
|---|---|
| `yarn test` | backend pytest (no models/GPU: a fake speaker embedder makes sine tones act as voices) + web vitest |
| `yarn lint` | ruff (backend) + oxlint (web) |
| `yarn format` / `yarn format:check` | ruff format + import sort / prettier |
| `yarn typecheck` | `tsc -b` for the web app |
| `yarn check` | everything above + production build; run before committing |
| `yarn check:live` | `spike/harden_check.py` against the running server: validation, Host/Origin checks, session lifecycle, train/cancel, merges; only touches its own `zz-check-*` players |

Benchmark scripts need the extra group: `cd backend && uv run --group spike spike/eval.py --tag NAME`.

Stress test (separate server, own data dir, nothing audible): build a long WAV
in `backend/samples/soak/`, start
`TROUBADOUR_PORT=8766 TROUBADOUR_DATA=/tmp/troubadour-soak TROUBADOUR_SAMPLES=$PWD/samples/soak TROUBADOUR_MAX_REPLAY_SPEED=8 caffeinate -i uv run troubadour`,
then run `spike/ui_probe.py` (muted headless Chrome watching the UI over the
DevTools protocol) and `spike/soak.py` (starts the replay, samples memory/lag,
names voices every 10 min). Both write CSVs to `samples/soak/`.

Layout: `backend/packages/<pkg>/src/troubadour/<pkg>/` (`core`, `sound`, `lore`, `cloud`, `engine`,
`server`; see `backend/AGENTS.md`). `web/app` and `web/packages/{ui,api,tokens}` the UI (the API contract
lives in `@troubadour/api`, types generated from the server's schema). `backend/spike/`
benchmark scripts plus `harden_check.py`, a non-destructive regression check
against a running server (only touches its own `zz-check-*` players).

Safety: binds 127.0.0.1, no auth by design. Host and Origin checks stop other
websites in the same browser from calling the API or reading the WebSocket.
Inputs are bounded (names, avatars as small `data:image` URLs, colors, speed,
train length); replay files must live in `samples/eval/`. State writes are
atomic; Train recordings live in `backend/data/voices/` and are deleted with
their voice.

Long sessions: a session holds off idle sleep (`caffeinate -i` on macOS, `systemd-inhibit` on Linux,
`SetThreadExecutionState` on Windows) so the computer doesn't idle-sleep mid-game (closing the lid still sleeps it). If a mic delivers no
frames for `MIC_STALL_S` (5 s), the UI gets an error toast once. Session audio
costs ~230 MB/hour of RAM.

## Pipeline

All stages publish events over one WebSocket; the UI applies patches as better
information arrives.

| # | Stage | Tech | Target latency |
|---|---|---|---|
| 1 | Capture + VAD | `sounddevice` at the mic's rate → 16 kHz mono, Silero VAD → utterances (`troubadour.sound.segment`: 400 ms silence ends a line, 200 ms padding, 12 s cap) | — |
| 2 | Speaker ID | `VoiceMatcher` (`troubadour.sound.voices`): embed each utterance (padded to ≥ 1.5 s), nearest known voiceprint; best score < 0.30 → unknown, grouped into a pending "Voice N"; confident ≥ 3 s matches adapt the voiceprint | 0.5–1 s |
| 3 | ASR | `mlx-whisper` large-v3-turbo; prompt: the table's names, glossary names said lately, the rest of the glossary (≤ 20 names) and the last lines, fitted to Whisper's 223-token prompt window; glossary fix-up of names afterwards | 1.5–4 s |
| 4 | Refine | re-score past utterances against current (matured) voiceprints and relabel; later also re-run ASR over larger windows. pyannote is *not* used for identity (benchmark: it lowers accuracy) | background |

Each session has its own audio buffer, queues and threads; starting a new one
abandons the old (its threads exit without side effects). Whisper calls are
serialized, and all torch-MPS work (speaker embeddings) shares one lock:
concurrent MPS use aborts the process.

### Voices

Speaker ID detects **voices**, not players. A voice is a cluster of speech
embeddings (centroid + a few sample clips). Each voice maps to a player and,
optionally, a character:

- Player's normal voice → player, their PC.
- Player doing a character voice → same player, that PC.
- GM's narration → GM; each NPC voice → GM + NPC name (e.g. "Morvath").

Messages store `voice_id`; the displayed speaker comes from the mapping, so
remapping a voice relabels every past message from it.

**Default: no setup recording (option B).** The session starts with no known
voices. Unmatched utterances are grouped as they arrive; once a group holds
~3 s of speech it appears in the voices panel as "Voice N" and the user taps a
name. Naming a second group with an existing name merges it. The refine pass
then relabels earlier messages with the matured voiceprints.

**Optional: Train.** Any player can tap Train (setup or mid-session) and talk
for 15–30 s, any words, nobody else speaking. That creates or strengthens their
voiceprint and marks them trained. Most useful for quiet players, who may
never accumulate enough speech to surface in the panel. The clip is kept twice under
`data/voices/`: `<voice>.wav` (16 kHz, what the voiceprint and the sample use) and
`<voice>.hq.wav`, the same seconds at the mic's own rate (usually 48 kHz), 24-bit, untouched
(the mic tap, as for session recordings; a Train mid-session takes it from the session's mic). It is
meant as a voice-clone reference, where the band above 8 kHz matters. A Train during a file
replay has only 16 kHz, so it deletes an older `.hq.wav` rather than keep one that no longer matches.

**One line, by hand.** Clicking a line's speaker name offers every player (and the characters
someone already voices; a typed character goes with the pick). `POST /api/messages/{id}/speaker`
moves that line at once and pins it: refine never relabels it. Its voiceprint teaches the
chosen voice like one confident span (`VoiceMatcher.learn`, weight 1; naming a voice in the
panel counts 5×), so the next lines in that voice follow; moving the line again takes the
lesson back first (`forget`), and a voice that was only that line goes away again.

**Character voices: name them, don't train them.** We tried training a
separate character voiceprint plus a style model (WavLM; `spike/style.py`).
On a real normal/character pair the speaker embedding got 65%, WavLM 80% on
held-out 1–2 s windows, and live it still couldn't tell them apart, so it was
removed. Instead, a character voice that is really distinct to the speaker
model scores below 0.30 against the player's normal voiceprint, surfaces as
its own "Voice N", and gets named with a character in the panel. Among one
player's voiceprints a line only switches if one wins by `CHARACTER_MARGIN`
(0.08), so near-identical ones don't flicker. Once a player has a character
voice, their normal-voice lines show no character (out of character).

Benchmark: voiceprints put a person's NPC voices with their normal voice
(the GM is identified as the GM 96%+ even in the NPC-heavy roleplay clip). Good
for "who is talking"; telling *which* NPC needs sub-clustering within one
speaker's segments (pyannote did split off the jeweler voice) or text cues.

### Events

Authoritative shapes: the server's pydantic models (generated TypeScript in `@troubadour/api`, the
`ServerEvent` union in `web/packages/api/src/events/`). The WebSocket sends `snapshot`
first (and after every session start, campaign switch or player benching); the client
applies events idempotently.
A client that falls behind is disconnected and resyncs from a fresh snapshot.

- `session.updated`: status, source, `t` (audio seconds), LLM health, `asr` (Whisper model and
  `loading`/`ready`/`error`), `training` (who is being trained), `error` (e.g. models failed to load)
- `player.upserted` / `player.removed`; `library.updated` (people not in the open campaign);
  `campaigns.updated` (created / renamed; switching sends a `snapshot`)
- `voice.upserted` / `voice.removed` (`merged_into` on merges)
- `speaker.active`: `{voice_id, confidence}` lights the mapped player's box
- `message.created`; `messages.updated`: one batch of patches (refine
  relabels, merges, spelling fixes)
- `train.status`: recording / processing / done / error / cancelled
- `error`: model, worker (once per session), recording and mic-stall failures, shown as a toast
- `campaign.job` (note import, write-up, improve, spelling, recap), `campaign.answer`, `campaign.updated`
- `audio.level` (~10/s), `audio.quality` (every 2 s), `mic.test`
- `cloud.updated` (backup status), `llm.updated` (provider and models)
- `notebook.updated`: the whole live notebook (candidate facts, entries, spellings, pins); replaces the cached one

## UI (Vite + React + TS + Tailwind v4, base-ui)

A pnpm workspace (`web/`): `app` (routes, shell, pages), `packages/ui` (components), `packages/api`
(contract, query hooks, live store), `packages/tokens` (colours shared with DPRcalc). Layout and rules:
`web/AGENTS.md`. The look is the redesign in `docs/design/troubadour-redesign/`. Nav tabs: Home,
Sessions, Timeline, Codex, Facts, Ask; Sessions shows a red dot while a session runs. The campaign
switcher, cloud chip and account menu sit in the top bar.

| Route | Screen |
|---|---|
| `/` | **Home**: the table, newest facts, last session, a banner when a session awaits review. First run (no seated players, no sessions) goes to the wizard; a running session goes to Live. |
| `/welcome/:step` | **Wizard**: campaign, table (players, classes, Train), microphone, notes (import), privacy. No top nav. |
| `/sessions/new` | **Ready check**: pick the mic (or replay a file or a saved session), live level and quality, who is present, title, "Previously on…", Start. |
| `/sessions/live` | **Live**: speaker rail (box glows via `data-speaking`), virtualized transcript (react-virtuoso), voices popover (name "Voice N", sample playback), audio-quality popover, the notebook (facts, pins, names), pins, inline Ask, End. |
| `/sessions[/:id]` | **Sessions**: every saved session with its summary, talk time, audio and actions (write up, improve, restore, merge). |
| `/sessions/:id/review` | **Review**: the session's suggestions beside their transcript lines; accept, edit or reject; progress from `review.json`. |
| `/sessions/:id/transcript`, `/recap` | Full transcript viewer with click-a-timestamp audio; the shareable recap (voice, length, save as image, read aloud). |
| `/timeline` | The story so far: places, talk time, new entries and accepted facts per session. |
| `/codex[/:entry]` | The campaign wiki: search, entries, edit, heard-as review, merge, delete to `.trash`, look for facts in transcripts. |
| `/facts` | Every fact with source, speaker and confidence; filters in the query string. |
| `/ask` | Ask about the campaign (same `AskAnswer` as the live inline panel). |
| `/settings/:section` | `models` (local and hosted LLMs, privacy), `microphone`, `players` (voices, clones, speech profile), `vault` (Obsidian, import, ignored words), `cloud` (backup, history, restore). |

Old URLs redirect (`/setup`, `/session`, `/history`, `/campaign`). Timestamps are `h:mm:ss`; clicking one
plays the session audio from there (never autoplay, `preload="none"`). Closing the audio-quality popover
switches the server's monitor off (`PUT /api/audio/monitor`, `session.audio_monitor`) so no level work runs
per frame.

Every session autosaves to `data/sessions/<id>/transcript.{md,json}` + `meta.json` (each refine tick, on
stop or new session, on shutdown). API: `GET /api/transcript.{md,json}`, `/api/sessions`,
`/api/sessions/{id}/transcript.{md,json}`.

Saved-session details:

- **Improve transcript**: `POST /api/sessions/{id}/improve` re-transcribes every
  line with the glossary as it is now (spellings accepted since, imported notes)
  plus the previous lines; speakers and line boundaries stay; a line heard as
  nothing keeps its text. Waits while a live session runs. The original stays as
  `transcript.orig.json` (`POST …/restore` puts it back).
- **Recording**: mic sessions also write `audio.wav` at the mic's own rate
  (48 kHz 16-bit, ~345 MB/h; `TROUBADOUR_RECORD=0` turns it off). The mic opens
  at its native rate; a soxr stream feeds the pipeline 16 kHz. Written on a
  background thread, header patched each second (crash-safe). A disk error
  stops the recording, not the session, and is toasted as it happens.
- **Setup snapshot**: `setup/{start,end}.json` (players + voiceprints, state.json
  shape) + `setup/voices/*.wav` (training clips).
- **Replay**: `{"kind": "session", "id", "speed"}` source; capped at what the
  session heard (`duration_s`), so a stopped replay of a long sample stays short.
  `GET /api/sessions/{id}/audio.wav` downloads the recording.
- **troubadour-sim**: `uv run troubadour-sim <id> [--setup start|end|current] [--speed 4]`
  re-runs a session headless in a throwaway data dir and writes
  `sims/<run>/transcript.*` + `compare.json` (speaker agreement with unnamed
  voices aligned by overlap, per-minute text similarity).

The Campaign screens work on the notes described under *Campaign memory*; the Codex replaced the old
glossary tab and the Review page replaced the per-entry suggestion cards.

### API added by the rebuild

Each row has a pydantic `response_model`; types are generated into `@troubadour/api` (ADR 0009). The full
route list is pinned by `backend/tests/test_routes.py`.

| Area | Endpoints, events and fields |
|---|---|
| Classes | `GET/POST /api/classes`, `PATCH/DELETE /api/classes/{id}` (custom only; SRD classes built in, custom ones in `classes.json`). `Player.dnd_class`, `Player.color` (null = use the class colour). |
| Session start | `POST /api/session/start` also takes `title`, `present_player_ids`, `record_audio`, `cleanup`. Live `Session` has `title`, `present_player_ids`. |
| Saved sessions | `SavedSession` adds `title`, `summary`, `present_player_ids`, `reviewed_at`, `talk`, `scenes`. `POST /api/sessions/{id}/reviewed {reviewed}`. |
| Notebook | `GET /api/session/notebook`, `POST /api/session/pins {t, text}`, `POST /api/session/notebook/{item_id} {status}`, `GET /api/sessions/{id}/notebook`; WS `notebook.updated`. Saved as `sessions/<id>/notebook.json`. |
| Facts | `Fact {id, text, about, said_by, source, confidence, history}`; entities carry `facts`, `suggested_facts`; `POST/PATCH /api/campaign/entities/{name}/facts`, `DELETE …/facts/{fact_id}`, `POST …/facts/search`, `POST …/merge`; `POST/PATCH /api/campaign/facts`, `DELETE /api/campaign/facts/{fact_id}`. Vault format: `docs/architecture.md` → *Fact format in the vault*. |
| Suggestions | `FactSuggestion.kind` (`new`/`update`) and `replaces`. Write-ups store `scenes.json`. |
| Review | `GET /api/sessions/{id}/review`, `POST /api/sessions/{id}/review/{item_id} {action, text?, about?}`. |
| Timeline | `GET /api/campaign/timeline`; `GET /api/campaign/entities/{name}` adds `appearances`. |
| Recap | `POST /api/sessions/{id}/recap {voice, length_s, include}` (job kind `recap`), `GET /api/sessions/{id}/recap`. |
| Storage | `GET /api/storage` (bytes by kind). |
| Cloud | `CloudStatus` adds `device`, `main_device`, `is_main`, `paused_live`; `GET /api/cloud/history`; `POST /api/cloud/restore` takes an optional `snapshot`; `_Overview/*.md` is written into the vault before each backup. |
| Ask | `CampaignAnswer.stats`; `POST /api/campaign/ask` takes optional `t`, echoed on the answer. |

### Rebuild

In October 2026 the web UI was rebuilt to the redesign, the backend split into packages and the API
extended as above, in 70 small tasks. The plan, task specs and per-task notes are in `docs/rebuild/`; the
layout and decisions that came out of it are in `docs/architecture.md` and `docs/adr/`.

## Campaigns and the player library

People are a library shared by every campaign; a campaign seats some of them, each with
a campaign-specific character and GM flag, and has its own vault and saved sessions.

- `state.json` v2: `players` (the library: name, avatar, color, trained), `campaigns`
  (`{id, name, roster, left}`: seats `{player_id, character, is_gm}`; `left` remembers the
  seats of people taken out, so adding them back restores their character), `campaign` (the open one),
  `voices` (each named voiceprint, with `campaign`: null for a person's own voice, which
  goes with them everywhere, or the campaign an NPC/character voice was named in).
  A pre-campaign file migrates into campaign `main` on load; the original is kept as
  `state.v1.json`. Nothing moves on disk.
- `main` keeps `config.vault_dir()` and every session saved before campaigns; later
  campaigns get `data/campaigns/<id>/`. Sessions record `campaign` in `meta.json`;
  History, replays and spelling suggestions list only the open campaign's.
- The engine holds only the open campaign: `players` (seated), `voices` (seated people's
  own voices + this campaign's characters + pending). Everyone else waits on `bench`, their
  voices `parked` outside the matcher with their voiceprints and Train clips kept.
- Switching (`POST /api/campaigns/{id}/open`) and removing a player from a campaign
  (`POST /api/players/{id}/bench`) happen between sessions only (not while training or a
  campaign job runs): the finished session gets its last relabel and waits (≤ `SETTLE_S`)
  for queued LLM tags and spelling fixes, is saved one last time and cleared, so roster
  changes can't rewrite its transcript; a fresh `snapshot` follows.
- Jobs (write-up, improve, spelling, import) use the open campaign's notes: the server refuses
  another campaign's session, and `campaign_gate` keeps a job from being queued mid-switch.
- The live engine never saves over a transcript that Improve / Fix spellings rewrote
  (`transcript.orig.json` exists): theirs is newer than its in-memory copy.
- API: `POST /api/campaigns {name}`, `PATCH /api/campaigns/{id} {name}`,
  `POST /api/campaigns/{id}/open`, `POST /api/players/{id}/seat {character, is_gm}`,
  `POST /api/players/{id}/bench`, `DELETE /api/players/{id}` (delete from the library:
  every campaign, voiceprints and clips). Events: `campaigns.updated`, `library.updated`;
  `snapshot` carries `campaign`, `campaigns` and `library`.
- UI: campaign switcher in the top bar (new, rename, open); Settings → Players lists the library
  (add to this campaign, or delete for good); a card's remove button benches.

## Campaign memory (Obsidian vault)

`Engine.vault_dir()`: the open campaign's notes. For `main`, `config.vault_dir()`:
`data/campaign`, or `TROUBADOUR_VAULT` (e.g. a folder in an existing
vault). Plain markdown, so people, Obsidian and agents can all read and edit it; Troubadour
re-reads notes when their file changes (edits in Obsidian count).

- One note per entity in `People/ Places/ Factions/ Items/ Lore/` (file name = name).
  Frontmatter Troubadour owns: `type`, `aliases`, `heard_as` (ASR misspellings it corrects),
  `heard_as_suggested` / `heard_as_rejected`, `status` (confirmed | suggested), `tags`.
  Body: description, `## Facts`, `## Suggested facts`. Other keys, tags and sections are
  kept verbatim; a note whose frontmatter doesn't parse is read-only, never rewritten.
- `Sessions/<date> <title>.md` (Last time, spotlight, highlights, timestamped beats, people, places,
  loot, still open, with [[links]])
  + `Sessions/Transcripts/<id>.md`; `Notes/` (pasted notes, verbatim); `Facts.md`;
  `Glossary.md` (generated index); `README.md` (written once, explains the layout).
- **Import notes** (`POST /api/campaign/import`): chunks of ~6 k chars → the memory LLM
  (JSON schema) → entities + facts merged in (by name, alias or heard-as). The user's
  notes confirm suggested entries and replace their AI descriptions.
- **Write up** (`POST /api/campaign/writeup/{id}`): see "Session write-ups" below; the page plus
  *suggestions* to review (new names, lasting facts, misheard spellings). Guards: a "new" name that sounds
  like a known one becomes a spelling suggestion; duplicate new names fold together; descriptions and lists
  aren't names; at most 30 facts per write-up; fleeting facts (hit points, "currently") dropped; a
  misspelling must occur in the transcript.
- **Spelling suggestions** (no LLM): transcript words that look or sound like a name
  (sequence ratio, or a crude sound key: Cassia/Kessia, Dilara/Elara), and frequent
  unknown names. A word counts as name-like only if it's capitalised mid-sentence and
  isn't an everyday word, filler or contraction.
- Review decisions go through `POST …/entities/{name}/review` (changes, not list
  replacement: rapid clicks can't undo each other); the UI also serializes its writes.
- Model: `TROUBADOUR_MEMORY_MODEL`, default `swift-qwen3.8-27b` (see "Session write-ups" below for
  how it was chosen); `TROUBADOUR_MEMORY_REASONING` stays `none` (thinking was 20× slower).
- **Live use**: new lines go through the glossary corrector (heard-as → name, name
  casing unless the name is an English word), and Whisper is prompted with the
  table's names (Setup, voices panel, confirmed entries) plus the last two lines.
- **Ask** (`ask.py`, `POST /api/campaign/ask {question}` → `campaign.answer` events; the open
  campaign's answers come with `GET /api/campaign`, in memory only): questions like "who did we
  suspect has the diamond?" answered from the open campaign's transcripts and vault notes. One LLM
  call plans (search words with synonyms: diamond → gem, jewel; the glossary entries asked about),
  code searches (BM25 over 8-line transcript windows, speech only so "Theo as Elara" isn't about
  Elara, plus every note; an entry is searched under its aliases and heard-as spellings and its
  note always goes in), and a second call answers from ≤ 14k chars of excerpts, told who's a
  player, the GM, a PC or an NPC, and to keep suspicions apart from facts. It may only cite the
  excerpts it got. Runs on its own thread beside the write-up queue (it never writes). On the
  real 2.6 h campaign: ~2 s per question with gemma. Gemma closes its JSON string early at an
  inner double quote, so it's told to quote with single quotes.

## Session write-ups (method, measurements, research)

`Memory._write_up` turns a saved transcript into a session page. Read this before changing it: most
of what is here fixed a measured failure, and several obvious-looking changes were tried and lost.

**Pipeline** (`writeup.py`, called by `Memory._write_up`), all calls JSON-schema, temperature 0:
1. **Input**: `transcript_lines` labels every line from the session's roster: `GM <name>` (or
   `GM <name> voicing <NPC>`), `<Character> (played by <player>)`, `Unknown voice`; a short cast list
   goes in every prompt. The roster, not per-line tags: the app tags a few GM lines with an NPC, and a
   line-count guess made the GM a player. `apply_heard_as` replaces confirmed misheard spellings before
   any model reads them (a hint alone left the misheard word in the page). The glossary brief carries
   each entry's description, so "Delara" reads as an NPC, not a misspelling of Elara.
2. **Read** (one call over the whole transcript, thinking on): notes = 20-35 timestamped beats from the first
   scene to the last, what each player character did, people (with npc/creature/faction), places, loot and
   deals, still open, the ending, and misheard spellings of glossary names. Rules learned from errors: rolls
   and damage are not beats unless they decided something; who did what is copied from the transcript; no
   "how" the transcript doesn't say; a player's joke name isn't a name until the GM uses it.
3. **Write** (one call that sees only the notes, thinking off, plus the made-up example page
   `writeup_example.md` for style and level of detail): title, "Last time" wrap-up (350-550 words, past
   tense, every turn of the session in order, the ending, what they carry forward), a spotlight per player
   character, 4-8 highlights.
4. **Glossary suggestions**: people and places the glossary lacks become suggested entries (a sound-alike of a
   known name, or of an earlier new one, becomes a heard-as suggestion instead); lasting facts come from one
   more call over the notes (fleeting ones dropped, at most 30); spellings must occur in the transcript.
5. **Page**: Last time, Spotlight, Highlights, What happened (the beats), People and creatures met, Places,
   Loot, Still open (a thread the beats already tell, or a plan, is dropped), Mentioned, Transcript. Read
   aloud reads Last time, Spotlight and Still open.

**How it is measured** (`spike/writeup_lab.py`, `spike/writeup_score.py`, `spike/WRITEUP_BENCHMARK.md`):
four gold pages written by a strong model from the full transcripts and checked by the table (two sessions
of each campaign; private, in `backend/local/gold/`), each with 39-48 weighted facts and known traps. The
judge is the local model, but every fact it credits needs a quote found on the page, every error a quote
from the gold page and a second "can both be true?" look. Score /100 = 50 x weighted fact recall in the
story (Last time + What happened) + 20 x recall in Last time alone + 10 x recall anywhere + (20 - 1.5 per
error). A gold page scored against itself gets ~74 (the judge misses ~13% of facts that are there). MTPLX
at temperature 0 is deterministic (a re-run matched to the decimal), but prompt changes move single
sessions a lot: trust a change only at +3 mean and 3 of 4 sessions.

**Findings on the four gold sessions** (Qwen3.8-27B on MTPLX, 2026-10-30):
- The old pipeline (part-by-part log, moments, plays, note, verify) scored 34 in 27 min per session, with a
  two-sentence summary. Read whole -> notes -> write page: 50 in ~5 min. Thinking while reading: 55-57
  (thinking costs ~1.1k tokens a call). A thinking writer wrote 153-word wrap-ups; the writer stays fast.
- Checking each beat against its own minutes of transcript (CoVe-style) made a page worse (50.5 -> 35.4):
  the window loses who is who, strips names the transcript mishears ("Magenta" -> "an old lady") and even
  moved a spell to the wrong caster. Same finding as the old verify pass.
- Reading in 14 chunks with the notes so far: more beats and story recall (0.60), but twice the errors and a
  weak wrap-up.
- Errors (7-10 a page) start in the notes and appear twice (wrap-up and beats): who-did-what between a
  player's character and the NPC the same player voices, a joke name taken as real, counts said before an
  event, invented causes or endings ("they long rested"). Research agrees: LLM dialogue summaries add
  plausible unstated inferences (Ramprasad et al., ACL 2024, arXiv:2406.03487); LLM judges overlook errors
  (TofuEval, NAACL 2024; FABLES, arXiv:2404.01261).

**Older findings** (one 2.4 h session, holistic 40-point scale unless noted; the pipeline they measured is
gone, the lessons about models still hold):
- Model: swift-qwen3.8-27b 27, gemma-4-31b 24, qwen3.8-27b 22, qwen3.6-35b-a3b 20, gemma-4-26b-a4b 18,
  gpt-oss-120b 11, laguna-xs 7, gpt-oss-20b 7 (empty), nemotron-3-super timed out. Swift takes ~10 min
  per session alone vs gemma's ~2.
- Thinking (`reasoning_effort=low`): 3.6 h instead of 10 min, and replies still overran 16k tokens.
- Whole session in one call vs the part-by-part log: one call won (20.6 vs 17.7 of 40 on the atomic-fact
  score, 3 min vs 16). Same one call on bigger local models: Laguna S 2.1 17.9, gpt-oss-120b 11.8, GLM-4.5-Air
  11.1, Nemotron 3 Super never stopped writing, Command A's GGUF caps context at 16k. Hosted, for scale (opt-in
  test, one session): Claude Opus 27.4, Sonnet 24.9, Haiku 16.2. The model's reading is the ceiling.
- Temperature (Qwen's suggested 0.7 / top-p 0.8 / top-k 20, and 0.3): means 18.6 and 20.6 vs 20.6 at 0;
  higher recall, lower precision. Stay at 0.
- Cleaning the transcript first (drop backchannel, merge runs, Qwen labels table talk out): 15.5 vs 20.6.
  The labels drop story with the chatter (the debt, the mallet, the long rest were in "table" lines).
- Final comparison on the player-corrected gold (48 facts, 22 known errors; one session, ±2 grader noise),
  whole session in one call: Claude Opus 29.6, Sonnet 28.4 (hosted, opt-in test); local: Qwen3.8-Flash-Next
  IQ3_XXS 24.3 (82 GB), qwen3.8-27b base 21.1, Swift-Qwen 27B 18–21, qwen3.6-35b-a3b 20.0, gemma-4-31b 19.0,
  Laguna S 17.0, laguna-xs 15.1, Haiku 14.1, gemma-4-26b 11.8, gpt-oss-120b 11.7, GLM-4.5-Air 11.3,
  gemma-4-e4b 9.4, gpt-oss-20b 5.6. The production hybrid (one call + plays + verify + moments) scored 15.6:
  its extra stages add as many errors as facts.
- Flash-Next IQ4_XS (94.6 GB, needs `sudo sysctl iogpu.wired_limit_mb=116000`): 19.5, not better than IQ3.
- A checklist answered first (per character, NPC, fight, money, ending), then the recap: +2.8 for Swift
  (18.0 → 20.8), −2.4 for Flash-Next. It helps a model that misses facts, not one that already finds them.
- Improve transcript (large-v3 re-listen, 1066 of 1595 lines changed) before writing up: no gain (Flash-Next
  IQ4 19.7 vs 19.5; IQ3 16.8 vs 24.3). It also drops reactions ("No! No!") the loud-moment detector uses.
- Glossary fixes pay immediately: confirmed heard-as spellings (Thayrin → Phaerimm, Garif → Gerleff,
  House Raid → House Randrir) fixed those names in every later page.
- 8k parts instead of 12k: worse, because the note then covered only the first half (since fixed by
  the coverage check; worth re-testing).
- Segmenting the note (3 segments): lost beats. The single note plus coverage check is better.
- Silent losses found and fixed: the note kept its first N scenes (the ending fell off), the fallback
  did the same, any line saying "attacked" was deleted, a reply cut off at max_tokens parsed to `{}`,
  and one LM Studio 500 killed a 20-minute job (now retried).
- What the model still gets wrong is mostly the transcript's fault: misheard names ("tomb town",
  "Thayrin"), garbled crosstalk. Fixing the glossary (heard-as spellings) fixed those immediately.

**Research this is built on** (and where to look next):
- Incremental vs hierarchical summarization of long text: BooookScore, Chang et al. 2023,
  arXiv:2310.00785. Incremental keeps more detail; hierarchical reads better. We use incremental (story
  so far); our segmented note was the hierarchical variant and lost detail, as the paper predicts.
- Lost in the Middle, Liu et al. 2023, arXiv:2307.03172: long inputs lose their middle and end; the
  note pass dropping the session's end is this, hence the code-checked coverage.
- Chain-of-Verification (CoVe), Dhuliawala et al. 2023, arXiv:2309.11495: verify with independent,
  specific questions. Our verify pass asks "is this sentence right?" and mostly says "unsupported";
  the next step is per-scene questions (who struck first, how many, who was hurt).
- FActScore, Min et al. 2023, arXiv:2305.14251; FASTFACT (EMNLP 2025 Findings) and LongDocFACTScore
  (LREC 2024): score by atomic facts (recall against a reference, precision of claims made). Our
  benchmark does this.
- Chain of Density, Adams et al. 2023, arXiv:2309.04269: rewrite a summary to add missing entities
  without growing it; a fit for the one-line summary.
- Query-focused meeting summarization, QMSum, Zhong et al. 2021, arXiv:2104.05938: targeted questions
  beat a generic summary; candidate: per-character "what happened to X" passes.
- Self-consistency / best-of-N: several samples, pick by code (coverage, grounding, numbers that
  match the transcript); candidate "try harder" mode, together with a second pass offset by half a
  part so no scene straddles a part boundary.

**Next steps** (best first; see `backend/local/writeup_lab/FABLE_PLAN.md` for the evidence):
1. Last time written per third of the session (three short calls), so a wrap-up can't stop early; the
   last paragraph ends at the notes' ending.
2. A no-inference rule in reading and writing; numbers only when stated after the event.
3. Importance-tagged beats: every key beat must reach the wrap-up.
4. A per-player "also voices" note in the cast (the Elara/Delara errors).
5. A small dedicated fact checker (MiniCheck, EMNLP 2024, arXiv:2404.10774) as an offline judge first.
6. Learn from edits: diff a session page the user corrects against what was generated; turn changed names
   into heard-as spellings and changed claims into facts the next write-up is given.


## Voice clones (say things, read write-ups aloud)

Chatterbox (multilingual v3, MLX port via `mlx-audio`, `TROUBADOUR_TTS` overrides it) speaks in a
player's voice; DeepFilterNet (MLX) cleans the reference. Both download from Hugging Face on first
use, like Whisper, then run locally. Code: `tts.py` (audio, text, `Clones`: the files),
`talk.py` (speech profile, restyling), `cloning.py` (the jobs; HTTP-free), the engine's part
(consent, Train clip, voiceprint, the live session jobs wait out); the server only checks and queues.

- **Consent first.** `Player.clone_ok` (library-level, off by default; Setup → player card →
  Voice clone). Nothing is built or spoken until it's on. Turning it off, or deleting the
  player, deletes `data/clones/<player>/` (reference, preview, profile, every clip). A job checks the flag
  again under the lock `forget` takes before it writes, so turning it off mid-job leaves nothing.
- **No training.** Chatterbox is zero-shot and reads only the start of one reference clip (10 s
  for the decoder, 6 s for the speech-token model), so more audio doesn't help; cleaner audio does.
  A Train recording is required (`<voice>.hq.wav`, the mic's own rate, else the 16 kHz clip;
  silences cut by Silero, first 10 s of speech); session recordings add candidates (below).
- **Build searches for the cleanest reference.** The clone copies room and noise along with the
  voice, and its likeness follows the reference's cleanliness far more than its length. Candidates:
  the Train recording's speech, then up to 3 sessions' worth of their cleanest lines from mic
  recordings (`audio.wav`, at the mic's own rate): their own voice (not a voice named with a
  character: a saved line's `character` also shows the seat's character, so it can't tell), not provisional, confidence
  ≥ 0.75, 2.5–12 s, nobody else within 0.3 s, sounding like their voiceprint (cos ≥ 0.5), ranked by
  how far speech stands above the room (95th vs 10th percentile of 20 ms frame RMS); per session the
  cleanest lines up to 10 s (≤ 300 lines measured per build). Every candidate goes through
  DeepFilterNet (always: the voice should sound clean, and the likeness, measured against a
  table-mic voiceprint, prefers keeping the room, so it isn't asked), speaks the preview 3 times,
  and is judged on the mean likeness (one generation varies by ~0.1). `voice.json` keeps `source`
  and every candidate's score (`tried`).
- **Estimate in-character time** (History viewer tool, `POST /api/sessions/{sid}/in-character`, job
  kind `incharacter`): `talk.label_in_character` saves `in_character` on every player's line. Named
  character voice → yes; the GM's other lines → no (text can't split narration from NPCs); other
  players' lines of 3+ words → the memory LLM (`classify_lines`, 25 per call, two lines of
  context); short or unanswered lines count as table talk, so it errs low. Nothing answered →
  error, nothing written. Saved labels win over voices in the talk-time boxes and the speech
  profile, and a voice rebuild reuses them instead of asking again. Restore original undoes it.
- **Character voices.** A player can have more than one clone: their table voice (above) and one
  per character they voice, each built the same way from its own lines (no Train recording) and
  judged against the centroid of those lines' voiceprints, and lines far from that centroid (cos
  < 0.5) are dropped as mislabelled: a performance can sound like someone else entirely (the GM's
  troll), so their table voiceprint can't judge it. Which voice a candidate line is: a voice
  named with a character in the voices panel is that character's (so the GM gets one per named
  NPC voice); otherwise, for a player (not the GM, whose NPCs the AI can't tell apart), the memory
  LLM reads it with the two lines before it (`talk.classify_lines`, 25 per call, labels checked):
  in character goes to their seat's character, table talk or unsure to the table voice. Local
  check (gemma-4-26b, 7 made-up lines incl. "I attack the goblin", "Can I roll intimidation?",
  dialogue to an innkeeper and an oath to a child): 7/7. A character's preview is something they'd
  say in character (`talk.character_text`, same checks as the table preview), else their longest
  such line. Files under `as/<persona key>/`; a rebuild drops characters it no longer finds. Say
  and Read aloud take `persona`; "in their words" is their table talk's style, so table voice only.
- **Measurements** (`spike/clone_reference.py`, synthetic `say` voices, M5 Max, 3 generations per
  row; truth = cosine to the voice's clean centroid): a noisy 15 dB table-mic reference 0.55–0.65;
  the same voice from a quiet recording 0.84. Averaging Chatterbox's two speaker embeddings (voice
  encoder and x-vector) over six noisy clips (~60 s) instead of the reference alone: worse (0.51),
  so more audio is used to *find* clean speech, not to average. Denoising a noisy reference: clone
  floor 35 → 55 dB, likeness within run-to-run noise (−0.09 here, +0.08 at 12 dB SNR earlier);
  also denoising the clone's output: +6 dB floor, −0.06, not done. Scratch smoke (noisy Train clip,
  quieter session recording): the build picked the session, 0.68 → 0.77, in 17 s. Real players
  first built from Train clips alone: 0.45–0.63. Earlier: a clean reference cloned at 0.85 (another
  voice 0.18–0.33); Whisper read clones back word for word except fantasy names. Speed: ~0.3–0.5×
  real time warm; first load ~35 s.
- **Reading.** `speakable` turns a note into paragraphs (no frontmatter, links, tags, tables;
  headings and list items become sentences; Mentioned, Transcript, Highlights, Table moments,
  Facts and Suggested facts are skipped). `chunks` packs whole sentences up to 280 characters, never across a paragraph
  (Chatterbox drifts or stops early on long input); pauses 0.25 s between chunks, 0.6 s between
  paragraphs. A reading of 40+ characters outside 6–30 characters per second is redone once.
- **GPU.** Each model call holds `asr.model_lock` (one audio model at a time). Clones are Apple Silicon only (`config.VOICE_CLONES`). Clone, say and read
  jobs are refused while a session runs, and before every model call they wait out one that started
  since (`Engine.wait_idle`, "Paused while a session runs"; improve uses it too), so a session that
  starts mid-call waits for that one call (a few seconds).
- Jobs (`campaign.job`, `player_id` set): `profile`, `clone`, `say`, `read` (titled with the page;
  `note` is its vault path). API: `GET /api/clones` (`{voices, profiles, clips, available}`, voices and
  profiles by player id), `POST /api/players/{id}/profile`, `POST /api/players/{id}/clone`,
  `POST /api/players/{id}/clone/say {text ≤ 2000, in_their_words, persona}`,
  `POST /api/players/{id}/clone/read {session, in_their_words, persona}` (that session's write-up page),
  `GET /api/clones/{player}/{preview|preview_<persona>|clip}.wav`, `DELETE /api/clones/{player}/clips/{clip}`,
  `PATCH /api/players/{id} {clone_ok}`.
- **The preview is something they'd say.** ~20 s at their pace (`talk.preview_text`): the memory
  LLM writes table talk in their style from their speech profile (made on the way if missing), with
  the word count checked (0.6–1.5× the target) and no names they never used; if it's offline or
  writes junk, their longest single stretch of talk (`talk.monologue`: consecutive lines, nobody
  else between; good lines from different evenings stitched together read as nonsense); with too
  few lines, the stock line.
  Candidates are judged on its first sentences (≤ 140 characters, 3 tries each); the winner reads
  the whole line once. Scratch smoke (gemma-4-26b, made-up transcripts): 65 words, 20.2 s, in their
  phrases; the whole build including the profile took 25 s. `voice.json`: `preview_text`, `preview_kind`.
- UI: Settings → Players & voices → player → Voice clone (consent, build, preview, Say box, clips); Recap page →
  Read aloud (once the session is written up). Nothing autoplays.
- Smoke test with real models and synthetic voices: `uv run spike/clone_smoke.py [out_dir]`.

### Speech profile and "in their words"

`talk.py`, under the same consent (stored as `data/clones/<player>/profile.json`, deleted with
the clone). `POST /api/players/{id}/profile` (job `profile`, allowed mid-session: no voice model)
reads every saved `transcript.json`, all campaigns (people are library-wide), and counts:

- pace: words per minute over lines ≥ 1.5 s after taking off the VAD padding (0.2 s a side);
  words per line; share of questions, exclamations, lines in a character voice (one named with a
  character in the voices panel); first words their lines
  open with (≥ 5% of their lines and 1.3× the table's rate).
- pet phrases: 1–3-word n-grams by log-odds with an informative Dirichlet prior (Monroe et al.
  2008), against everyone else's lines: z ≥ 2, ≥ 2× the table's rate, ≥ 3 times in ≥ 3 lines.
  Function words never count alone; discourse words ("okay", "like", "literally") can. A phrase
  swallows the shorter ones inside it used about as often, and overlapping ones merge ("you know
  what" + "know what I" → "you know what I") if they're said together in ≥ 3 lines, up to 8 words.
- up to 12 example lines (6–30 words, confidence ≥ 0.6, not provisional; pet-phrase lines first,
  round robin over sessions), and a 2–4 sentence description from the memory LLM (plain text,
  ≤ 600 characters; none if the LLM is down: the numbers stand alone). The memory LLM is the one the
  user picked: with a hosted provider, the counts, examples and texts to restyle go to it, as
  write-ups' transcripts do.
- Needs 30 lines and 300 words. Whisper drops most "um"s and filler-only lines aren't saved, so
  hesitation isn't measured.

**In their words** (`in_their_words` on say/read; needs a profile): the memory LLM rewrites the
text paragraph by paragraph from the profile and examples (headings and paragraphs under 4 words
are read as written). A rewrite must keep every number (each as often) and every known name
(players, characters, glossary names and aliases) and add none, except the speaker's own name and
character, which may become "I"; and be 0.6–1.6× the length (+25 characters). A refused rewrite is
asked for once more with the reason (the LLM runs at temperature 0, so a plain retry repeats
itself), then that paragraph keeps the original wording (the job says how many). Smoke test
(made-up transcripts, gemma-4-26b): the first prompt overused pet phrases (one line came back 6×
longer, the same sentence four times); with "use their habits lightly" plus the reason on retry,
every paragraph of a short page passed. The checks can't catch tone shifts (a statement turned into
"…?"). The clip is then time-stretched to their pace (ffmpeg `atempo`, pitch kept): their wpm over the
clone's own (`clone_wpm`, measured on the preview at build), clamped to 0.85–1.15. Clips record
`in_their_words`; `text` is what was spoken.

## Troubadour Cloud (opt-in backup)

Besides an opt-in hosted language model (next section), the one thing Troubadour sends off the computer, and only
after the user connects: a copy of the open campaign's vault, kept as snapshots by a separate service
(Troubadour Cloud: Next.js on Vercel, Clerk, Neon, private Vercel Blob) that shows it read-only in a browser.
Troubadour works the same without it.

- `troubadour.cloud.backup`. Sign-in: OAuth 2 authorization code + PKCE (S256) with a loopback redirect to
  `http://127.0.0.1:8765/api/cloud/callback` (fixed: another `TROUBADOUR_PORT` can't sign in); the
  service says where to sign in (`GET /api/v1/client`), so Troubadour only knows `TROUBADOUR_CLOUD_URL`. The
  `state` is single-use and expires in 10 min. Tokens (refresh included) in `data/cloud.json`,
  mode 600; a refused refresh disconnects.
- Backup (a `campaign.job`, kind `backup`, on the memory job thread, so never mid-write-up): list
  the vault (no hidden files or folders, no symlinks, `Sessions/Transcripts/` only if the campaign
  opts in; paths NFC), sha256 each file, `plan` (the service lists what it lacks) → PUT those to
  signed URLs → `commit` the list as a snapshot. A file the service would refuse (over 20 MB, a
  path rule, a case-only twin) is left out and listed, not fatal. A lost race (`conflict`), a
  lost upload (`missing_blobs`) or a note edited mid-backup starts over once. Unchanged vault: no
  new snapshot. Hashes are cached by (file, size, mtime). A failure is kept as `last_error` until
  a backup succeeds.
- **Automatic backups** (`AutoBackup`, a thread started with the server; per campaign, on by
  default once connected): every 30 s it fingerprints the open campaign's vault (paths, sizes,
  mtimes; no reading). When that differs from the last backup's and has stayed the same for 2 min
  (a write-up or an Obsidian edit has settled), and the last automatic backup was ≥ 10 min ago,
  and no other job is running, it queues a backup job. So a write-up is backed up a couple of
  minutes after it lands, without any hook into the write-up code. A campaign with no notes yet is
  left alone (no empty vault). An automatic backup that fails (offline at the table) doesn't put
  an error chip in the header; the Cloud backup panel shows it and the next attempt retries.
- **Restore** (a job, kind `restore`): the newest snapshot of any of the account's vaults into the campaign
  with the vault's id (one this computer lacks is created, so it joins the picker). Each file is checked
  against its sha256 before it's written; a note that differs is moved to
  `.trash/Before restore <time>/` first; files the snapshot doesn't have are left alone (a restore
  never deletes). Paths go through the same rules as backups and must land inside the folder (no
  `..`, no writing through symlinks). Each file is written beside its note before the swap, so a
  file that can't be written (a folder with its name, a file where its folder should be) is
  skipped and listed, and the note stays as it was. On the web, a vault also downloads as a .zip.
- The service's contract: `backend/tests/cloud_contract.schema.json` (copied from the service's
  `contract.schema.json`); a test fails if its limits or error codes drift from `troubadour.cloud.backup`.
- API: `GET /api/cloud` (never calls the service), `POST /api/cloud/connect` → `{authorize_url}`,
  `GET /api/cloud/callback`, `POST /api/cloud/disconnect`, `PUT /api/cloud/options
  {include_transcripts?, auto_backup?}`, `POST /api/cloud/backup` → job, `GET /api/cloud/vaults`,
  `GET /api/cloud/account` (name, email, avatar as a `data:` URL the server fetched, so the browser never
  contacts the image host), `POST /api/cloud/restore {vault_id}` → job. Event: `cloud.updated`.
- UI: the header's account menu (avatar, who is signed in, Back up now, Disconnect; Sign in when not connected);
  Campaign header → **Cloud backup** (connect, automatic on/off, include transcripts, back up
  now, last backup or failure, restore, disconnect).

## Hosted language models (opt-in)

Account menu → **Models** → **Language model**: this computer (LM Studio or any OpenAI-compatible server, the
default) or a hosted provider. The choice covers every LLM call (live spelling, Improve's spelling pass,
write-ups, note import, Ask); Whisper and voices always stay on the computer. Nothing is sent to a provider until
the user signs in or adds a key **and** picks it. Signing out of the provider in use switches back to this computer.

- `troubadour.core.providers`. Secrets in `data/llm_accounts.json` (mode 600), never in API responses (`key …abcd` only).
  `settings.json` keeps `provider` and each hosted provider's own `{llm, memory}` pair (`hosted`), so
  switching back and forth loses nothing. `MemoryLLM.wire` picks the API: `chat`, `anthropic`, `responses`.
- **ChatGPT plan** (`openai`): Sign in with ChatGPT with plan usage, the only way a subscription can pay
  (https://developers.openai.com/siwc/token-sharing-open-source). Dynamic client registration
  (`dynamic_agent_client` → an issued `oaiapp_…` id, kept), a per-computer `ext_agent_host_id` (`urn:uuid:`,
  kept across sign-outs), PKCE + nonce, loopback `http://127.0.0.1:8765/auth/callback`. The ID token is
  verified against OpenAI's JWKS (PyJWT). No `chatgpt.tokens.use.direct` in the granted scopes: not
  connected, and the next sign-in asks again (`prompt=consent`). Access tokens last 1 h; refreshes are
  serialized (rotating refresh tokens); `invalid_grant` & co. sign out. Sign-out revokes the refresh token
  at the discovered `revocation_endpoint`. Requests: `POST /v1/responses` with `store: false`,
  `stream: true`, `instructions`, a strict JSON schema (dropped once if the route refuses it), no
  temperature or token cap; success only on `response.completed`. Plan errors (usage limit, not eligible)
  become plain messages with the usage link. Models: `GET /v1/models` → `models[]` with `visibility: list`.
  One account at a time; "Use another account" registers again.
- **OpenRouter**: OAuth PKCE (`openrouter.ai/auth`, callback `http://localhost:8765/api/llm/openrouter/callback`)
  mints a key on the user's account (their credits); a pasted key works too.
- **Anthropic API**, **DeepSeek API**: pasted keys. Anthropic forbids third-party use of Claude subscription
  sign-ins (Agent SDK docs), so this is the user's API billing; it uses the native Messages API with
  `output_config.format` (the OpenAI-compatible layer ignores `response_format`), no temperature, and
  thinking headroom on `max_tokens`. DeepSeek is OpenAI-compatible chat.
- API: `GET /api/settings/models` adds `provider`, `hosted`, `providers` (status, never secrets);
  `PUT /api/settings/models {provider?, hosted?: {id: {llm?, memory?}}}` (400 unless signed in);
  local only: `memory_url` gives the write-up/question model its own server ("" = auto, `llm_url`'s), e.g.
  MTPLX for write-ups and LM Studio for live spelling; `GET /api/llm/local/servers` probes the usual ports;
  `GET /api/llm/models?provider=` → `{models: [{id, name, price}], error, price_note}` (only OpenRouter's
  list has prices, as USD per 1M tokens in/out; the others get a `price_note`); `POST /api/llm/{id}/connect {fresh?}` →
  `{authorize_url}`; `GET /auth/callback` (ChatGPT), `GET /api/llm/openrouter/callback`;
  `PUT /api/llm/{id}/key {key}`; `POST /api/llm/{id}/disconnect` → `{providers, revoked}`.
  `POST /api/llm/local/models {llm_url, api_key}` → `{installed, found, error}`: the Models dialog's
  Rescan, asking the typed (unsaved) local server what it offers now.
  Event: `llm.updated {provider, providers}`.
- Not verified against the live services (tests use fakes of each): the ChatGPT flow needs a real Go/Plus/Pro
  account to confirm the redirect path and the plan route's acceptance of `text.format`.

## Spelling cleanup (behind the transcriber)

D&D vocabulary: Troubadour ships the SRD 5.1/5.2 names (`srd_terms.json`, ~1.6k spells, creatures,
items, conditions, species, classes and rules terms; CC-BY-4.0, attributed, each name checked
against the SRD PDFs). An optional, larger list in the same shape at `data/dnd_terms.json` is
used on top when present; it's never committed. Official names are held to a stricter match
than the campaign's own: spelled nearly the same (ratio ≥ 0.8, length ≥ 6), no sound-alikes,
phrases only for spells, creatures and items and only word by word ("hideous laughing" →
Hideous Laughter; "far away" doesn't become a two-word rules term). Indexed by first letter
and last word: 0.1 ms a line. They also drop out of "unknown names" suggestions.

`cleanup.py`. Code finds candidates in every line: words and 2–3 word phrases that look or
sound like a known spelling (confirmed glossary names and aliases, accepted heard-as, the
names Setup and the voices panel know, and a built-in D&D vocabulary, `troubadour.lore.dnd_terms`).
- **Sure fixes** happen before the line is shown: an accepted heard-as spelling, the same
  letters with other spacing or case ("thunder wave", "auggie"), or a near-identical spelling
  with one candidate (ratio ≥ 0.88: "Augie" → "Auggie").
- **Ambiguous** words ("Dallara": Elara *or* Delara, two different characters) go to the
  local LLM a few seconds behind, in batches of up to 8 lines with 4 lines of context; it may
  only answer one of the offered names or "keep". The line is patched in place
  (`messages.updated` with text and fixes); a line edited meanwhile is skipped.
- Never touched: everyday words and their forms ("confusing", "poisoned", "teleports"),
  case-only changes to D&D terms ("scrying"), spelled-out letters ("B-U-T-T-E"), aliases.
- Every fix keeps what was heard (`fixes: [{start, end, heard}]`, UTF-16), shown as a dotted
  underline "Heard as …". An answer the LLM gives twice becomes a heard-as *suggestion*, so
  once approved the instant code path handles it.
- After a session: `POST /api/sessions/{id}/spelling` (seconds for 2.6 h: 23 fixes, 19 lines
  asked); Improve transcript runs it too. `TROUBADOUR_CLEANUP=0` turns it off.
- Spelling suggestions leave out D&D vocabulary, acronyms and fillers; any suggestion can be
  ✕'d (unknown names go to the vault note `Ignored words.md`).

## Audio quality and microphones

- **Live meter** (`levels.LevelMeter`, fed every 16 kHz frame): `audio.level` ~10/s with a zone
  (silent < −50, quiet < −30 grey-blue, good < −12 green, hot < −3 amber, clip red) and
  `audio.quality` every 2 s over the last 15 s: speech level (p90 of 50 ms RMS), background
  (p10), SNR, rumble (% energy < 100 Hz), clipping, graded with hints. **Test mic** on the ready check
  (`POST /api/mic/test`) runs the same meter for 20 s without a session; nothing is recorded.
- **Recording report** (`GET /api/sessions/{id}/quality`, cached in `quality.json`, ~4 s for
  2.6 h, made automatically after a mic session): overall numbers, a per-minute timeline,
  loudness per named player (each line stores `level_db`) and a verdict: good / change
  settings (gain, clipping, rumble) / change microphone (players ≥ 10 dB apart: the mic favours
  one side; or a poor SNR at a good gain). The 2026-10-08 Yeti GX session: speech −41 dBFS,
  SNR 17 dB, rumble 70%, players within 4 dB → "change settings": raise gain, high-pass.
- **Mic details** (`GET /api/mics`, `mics.py`): macOS reports name, maker, connection and rate
  only; pickup pattern and capsule come from a small catalog of common mics or the user's
  corrections (`data/mics.json`, `PATCH /api/mics/{name}`), plus measured verdicts. Shown as a
  ✓/✗/? checklist: hears the whole table (omni/stereo/boundary), picks up distant voices (not
  dynamic), wired, ≥ 44.1 kHz, measured well.
- **Mic choice** (ready check) is remembered in the browser (`localStorage` `troubadour.mic`) and an
  amber note says when that mic isn't connected. Before, starting any session (which leaves
  Setup) reset it to the macOS default: the 2026-10-15 game was tested on a Yeti, then ran
  2.6 h on the MacBook's built-in mic (beamforming toward the screen: the near player 4 dB
  louder, the far ones 7 dB quieter).
- **Start-time check**: Start session on a mic whose checklist has a red item (✗) asks first:
  "Hey, you aren't using an omnidirectional mic" (the `around` check) or "Hey, something in
  this mic's checklist is red", with the red items; Start anyway / Pick another mic. If the
  checklist can't be read, the session just starts.

## Transcription study (real 2.6 h session, Yeti GX)

Correction: the table has two similar names, Elara (a PC) and Delara (an NPC Theo plays);
the study first counted both as Elara. Two gold lines were fixed and two ambiguous ones dropped
(92 lines); the ranking didn't change (TGC 10.6% WER, 91% names).

`spike/asr_compare.py` re-transcribed all 2,020 lines under 9 configs;
`spike/asr_score.py` scores them against 94 lines adjudicated by reading every
hypothesis in context (58 of 150 sampled lines were noise nobody could call; skipped).
The gold favours glossary spellings, so read it as a ranking.

| Config | WER | Names right | Notes |
|---|---|---|---|
| TGC turbo, names + last 2 lines prompt | **11.0%** | 86% | **live now**; same speed as T0 |
| TG turbo, names prompt | 11.6% | 89% | |
| LG large-v3, names prompt | 12.6% | **92%** | 3× slower |
| T0 turbo, no prompt (old live) | 12.9% | 31% | |
| L0 large-v3, no prompt | 13.3% | 31% | 3× slower, no better |
| LGC large-v3, names + last 2 lines | 14.3% | 89% | context hurts large-v3 |
| TWG / LWG / LW0 packed ~28 s windows | 21–31% | 50–89% | words slide across line boundaries |
| The session as recorded live | 13.0% | 28% | |
| …after **Improve transcript** | **10.7%** | 86% | 1,311 of 2,020 lines changed |

The names prompt is the win (names ~30% → 86–92%); the last lines add a little for turbo.
A bigger model and longer windows don't pay here. Pasting notes or accepting spellings
grows the glossary, which the prompt and the corrector both use.

Prompting needs a guard: on quiet clips Whisper reads the prompt back ("armor class,
d20, cantrip…") or loops; such a result is redone without the prompt (`asr.suspicious`).

## Whisper prompt (big glossaries)

Whisper reads at most n_ctx/2 − 1 = **223 prompt tokens** and drops the *start* of a longer
prompt (mlx-whisper: `prompt_tokens[-(n_ctx // 2 - 1):]`), which is where the names were. On
2026-10-15 (glossary of 56 names) the first-40-names prompt alone was 188 tokens and **46% of
the session's prompts overflowed**. Now `asr.build_prompt` keeps the last lines to 60 tokens
and adds names, in `asr.prompt_names` order, only while the whole prompt fits; the engine
caps the list at `PROMPT_NAMES` = 20: the table's names (Setup, voices panel), glossary names
said in the last 100 lines (latest first; a glossary nickname said goes in as said, e.g.
"Phisho"), then the rest of the glossary. Clips under 1 s (`CONTEXT_MIN_S`) get the names but
not the last lines: on a blip of noise the lines tempt Whisper into a whole sentence.

`spike/prompt_sweep.py`: the 2026-10-08 gold (94 lines, glossary of 5) with its glossary
padded to 65 names from another campaign (none said in the session); per-line WER, turbo.

| Prompt | WER | Names right |
|---|---|---|
| old, the real 5-name glossary | 11.8% | 76% |
| old, padded to 65 names (5% of prompts overflowed) | 18.6% | 76% |
| all names that fit, no lines | 14.2% | 91% |
| ≤ 12 names, no lines | 11.8% | 91% |
| ≤ 20 names, no lines | 12.6% | 91% |
| ≤ 12 names + 60 tokens of the config's own last lines | 9.4% | 85% |
| **≤ 20 names + 60 tokens of its own last lines (live now)** | **9.3%** | 82% |

A long name list costs words everywhere, overflow or not: cap it. The names lost with the
lines are mostly casing ("magenta", "delara"), which the corrector fixes. Context lines taken
from the old live transcript instead (misspelled names) gave 11.1–11.4% WER and 76–82% names.

Tonight's 2026-10-15 session (laptop mic), 76 lines where configs disagree, adjudicated blind
(variants unlabeled and shuffled; 24 of 100 sampled were too noisy to call):

| Config | Mean WER | Pooled WER | Names right |
|---|---|---|---|
| as recorded live (old prompt, overflowing) | 19.8% | 11.5% | 2 / 14 |
| **live now** (`build_prompt`, own last lines) | **15.3%** | **9.8%** | 7 / 14 |
| TG turbo, 9 table names, no lines | 9.9% | 9.1% | 9 / 14 |
| TGC turbo, 9 table names + 2 own lines, untrimmed | 14.3% | 9.8% | 7 / 14 |
| T0 turbo, no prompt | 11.1% | 9.2% | |
| L0 large-v3, no prompt | 11.0% | 10.6% | |
| LG large-v3, 9 table names | 16.6% | 13.7% | 9 / 14 |

Lines vs no lines is a wash here (22 lines better, 20 worse); the losses are mostly sub-second
noise clips that the last lines tempt into a sentence (3 of 5). **large-v3 isn't better on a
weaker mic either**, not even on the quietest players' lines (48 of the 76: L0 8.0% vs T0
8.7%, TG 9.8%), costs ~3.7× the time, and with a prompt writes "Subtitles by the Amara.org
community" on noise (17 lines this session; turbo never did).

## Utterance cutting

`troubadour.sound.segment` is Silero's VADIterator (proven equal by a test) with the padding as a setting
and padding that never reaches into the previous line. `spike/segment_sweep.py` caches Silero's
probabilities once and replays them through it. Speaker purity on the benchmark clips (AMI + CR,
107 min, true turns); WER on the 2026-10-08 gold by words whose middle falls inside each gold
line (any cutting can be scored), and on whole CR clips against captions.

| Silence / padding / cap | Lines mixing speakers | Speech kept | Gold WER | CR WER |
|---|---|---|---|---|
| 400 ms / 80 ms / 12 s (before) | 25.5% | 81.9% | 12.9% | 21.9% |
| **400 ms / 200 ms / 12 s (now)** | 25.4% | 85.9% | **12.0%** | **21.8%** |
| 400 / 300 / 12 | 26.9% | 88.5% | 21.5%* | 22.0%* |
| 250 / 200 / 12 | 19.9% | 85.8% | 15.3%* | 23.5%* |
| 400 / 200 / 8 | 25.4% | 85.8% | 12.3%* | 22.3%* |

\* with the quiet-point cut below and the old prompt (the 80 and 200 ms rows with it: 12.9/22.1
and 12.0/21.7, so the same ranking).

- Shorter silence (250 ms) separates speakers better (a fifth fewer mixed lines) but shorter
  lines cost Whisper 2–3 points of WER. Not taken; one segment per speaker needs diarization.
- Cutting a 12 s monologue at its quietest moment in the last 3 s instead of at 12 s sharp
  (12% of lines on the clips hit the cap, 14% on 2026-10-15) changed no WER measurably: removed.

## Weak mics (2026-10-15, MacBook built-in mic)

The same 76 blind-adjudicated lines, everything shipped (prompt, nicknames, short-clip rule),
Whisper's temperature fallback seeded so variants differ only by what they change:

| Variant | Mean WER | Pooled WER | Junk on the 5 silent clips |
|---|---|---|---|
| as recorded live | 19.8% | 11.5% | 5 |
| shipped prompt, no junk filters | 14.1% | 9.1% | 2 |
| **+ junk filters (live now)** | **11.4%** | **8.3%** | **0** |
| + loudness normalised to −20 dBFS | 11.4% | 9.6% | 1 |
| + 100 Hz high-pass | 10.9% | 8.9% | 0 |
| + high-pass + normalised | 10.8% | 8.9% | 0 |
| + `noisereduce` + high-pass + normalised | 10.6% | 9.1% | 0 |

On a weak mic Whisper's damage is **junk on noise**, not missed words: 13 live lines held
letters from other scripts ("образbak Waters factual", "COR perfekt달"; one was "…what's
your AC? 18. ож Kobe Thank you."), and the worst single clip was 120 invented words.
`asr._run` now drops any segment with a non-Latin letter (the language is forced to English;
accented Latin is kept), `HALLUCINATIONS` gains the YouTube outros ("we'll be right back",
"see you next time", "subtitles by the amara.org community"), and a result with more than
8 words per second of clip (people top out near 6.6) is redone without the prompt, then
dropped. With 200 ms padding the rate rule flags none of the real fast lines of 2026-10-08.

Cleaning the audio before Whisper doesn't pay (within noise either way; Whisper is trained on
noisy audio), so nothing is filtered. A lower VAD threshold (0.35) finds 54 more clips, 26 s
in 2.6 h, nearly all sub-second and transcribed as junk: the VAD isn't losing quiet players.
What helps a weak mic is the mic (the start-time check), the prompt and the junk filters
above, and fixing speakers by hand (one click per line).

## Milestones

1. **Spike / benchmark**: done (below).
2. **Live backend**: done. Mic or real-time file replay → Silero VAD → Whisper.
3. **Setup + optional Train + voices panel + live speaker lighting**: done.
4. **Chat feed + mechanics** (regex, then local-LLM backfill): done; mechanics removed 2026-10-16.
5. **Background refinement** (re-score past messages, UI relabels): done for
   speaker; re-transcription is the post-session **Improve transcript** job.

Known gaps: one utterance can span a speaker change (VAD cuts on silence only);
the voices panel doesn't split a voice that merged two people.

## Stress test (16.14 h of Critical Role at 8×, UI open)

| | Baseline | After fixes |
|---|---|---|
| Crashes / errors / disconnects | none | none |
| Messages / voices | 9,645 / 298 | 9,637 / 130 |
| UI DOM nodes (max) | 177,647 | 5,063 |
| UI JS heap (max) | 634 MB | 28 MB |
| Worst frame gap | 617 ms | 67 ms |
| Full-history reload (9.6k msgs) | — | ~0.3 s |
| malloc_small per audio-hour | +66 MB | +81 MB (native, not Python) |

Fixes: virtualized chat, id→index store, top-8 pending voices, MLX cache cap
(1 GB), pending-voice tidy-up in refine, caffeinate per session, mic watchdog,
`/api/debug/memory`. Found after the re-run: the chat mounted at 0 px and stayed
blank until scrolled (now absolutely sized); index.html was cached so rebuilds
didn't show (now `no-cache`, hashed assets immutable). Verdict: 4 h is safe
(~+330 MB native creep; ~9 GB total).

## Benchmark (milestone 1)

Rebuild: `uv run --group spike spike/dataset.py`, then `uv run --group spike spike/eval.py --tag NAME`
(defaults = best config below). Every run appends to `samples/results.jsonl`.

**Data** (`samples/eval/`, 70 min total):

- 5 × 10 min Critical Role clips (C2E44, C2E58 combat + roleplay, C3E114,
  VM E52). Reference = official YouTube captions, which name the speaker at
  every change. Combat windows chosen by density of mechanics talk.
- 3 AMI meetings (ES2004a, IS1009a, TS3003a), **single distant mic**: the
  closest public match to one Yeti in the middle of a table. Reference =
  pyannote AMI-diarization-setup RTTM.
- Enrollment: ~30 s per speaker of isolated speech from *outside* the clip
  (CR: elsewhere in the episode; AMI: the sibling meeting, same people).

**Metric**: word-level speaker identity accuracy (word gets the enrolled name
that was actually speaking). WER is vs lightly edited captions, so treat it as
relative. NUM = share of caption numbers transcribed exactly.

| Config | CR speaker ID | AMI speaker ID | CR WER | CR NUM |
|---|---|---|---|---|
| pyannote clusters (majority-mapped, optimistic) | 81.2% | 95.7% | 17.6% | 93.3% |
| + oracle speaker count | 82.0% | 96.6% | | |
| + clustering threshold 0.4–0.7 | 80.3–81.3% | 95.7–96.2% | | |
| pyannote clusters → nearest enrolled voice | 80.9% | 95.7% | | |
| **each Whisper segment → nearest enrolled voice** | 90.7% | 97.7% | | |
| + pad short segments to 1.5 s | 91.0% | 98.3% | | |
| + adapt voiceprints from confident segments | 91.2% | 98.4% | | |
| + no Whisper prompt (**trained default**) | **91.6%** | **98.4%** | 17.4% | 93.0% |
| whisper large-v3 instead of turbo | 90.0% | 98.0% | 17.1% | 91.3% |

Option B, no training (`--voices discover`; the user's naming taps are
simulated with the true majority speaker; taps are per 10 min clip):

| Config | CR speaker ID | AMI speaker ID | Taps |
|---|---|---|---|
| pyannote clusters from first 3 min, named once (`--voices named`) | 84.2% | 78.1% | — |
| continuous discovery, live labels only | 75.8% | 90.6% | ~5 |
| + refine relabel, voice shown at 5 s | 87.7% | 97.5% | |
| + refine relabel, voice shown at 3 s (**default**) | 89.5% | 98.4% | 4–9 |
| + refine relabel, voice shown at 2 s | 91.0% | 98.7% | 5–18 |

Findings:

- **Enrollment is the lever; diarization clustering is the bottleneck.**
  Classifying segments against enrolled voices beats every pyannote variant;
  blending in pyannote's cluster as a prior *lowers* accuracy (85–90%).
- Accuracy by segment length (CR, single speaker, before padding): < 1 s 57%, 1–2 s 93%,
  2–4 s 99%, 4 s+ 100%. Remaining errors: sub-second replies (~50% are a new
  speaker, ~50% a continuation, so context alone can't fix them) and fast
  crosstalk inside one segment. Splitting at word pauses doesn't help.
- Enrollment length: 15 s ≈ 30 s (91.2%); 60 s 91.8%. Any words work.
- Option B ≈ trained once the refine pass relabels history. Live labels lag
  (~76% CR) until voices mature, so show low-confidence labels as provisional.
  Remaining gap is quiet players who never reach the panel: Train fixes that.
- Unknown voices (leave-one-out, segments ≥ 1.5 s): best score < 0.30 flags
  96.7% of unenrolled speakers, wrongly flags 4.3% of enrolled ones.
- Whisper prompt with names: no measurable gain on WER, numbers, or names.
  large-v3: ~3× slower, no better. Turbo, no prompt.
- Speed: ASR 0.013–0.02 RTF, embeddings negligible. Live latency is bounded by
  utterance end detection, not compute.
- Fixed along the way: Whisper repetition loops on trailing noise
  (`condition_on_previous_text=False`, `hallucination_silence_threshold=1.0`).
- Caveat: CR has a mic per person and AMI is meetings. A 10-minute recording of
  the actual table on the Yeti is still the final go/no-go.

## Known risks

- One shared mic: far-field voices embed worse. AMI (single distant mic) at
  98.4% suggests this is manageable with enrollment.
- Sub-second replies ("Yeah", "12") are ~50% wrong. Mitigation: show them
  with low confidence, let the refine pass revisit with more context.
- Crosstalk, laughter, dice noise → VAD/ASR junk.
- Fantasy names: the Whisper prompt doesn't fix them (Grukk → "drug"). Plan a
  glossary fix-up (fuzzy/phonetic match against setup names) and the LLM pass.
