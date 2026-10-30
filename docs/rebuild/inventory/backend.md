# Troubadour backend inventory

Repo root at planning time. Read-only survey. Line counts verified per file via the read tool.
(≈) marks items not fully enumerated. Symbol lists for small modules come from `^class|^def` greps.

## 0. Layout
- `backend/` = one uv project (`troubadour`, src layout, `uv_build`), Python >=3.12, Apple-Silicon macOS only (mlx, MPS, caffeinate).
- `backend/src/troubadour/`: 24 .py + `srd_terms.json` + `writeup_example.md` (package data).
- `backend/tests/`: 26 test files + `conftest.py` + `cloud_contract.schema.json`.
- `backend/spike/`: 21 .py scripts + `WRITEUP_BENCHMARK.md`.
- UI is `web/` (pnpm/Vite); server serves `web/dist`. Contract mirrored in `web/src/lib/types.ts` + `web/src/lib/api.ts`; API list also in `PLAN.md`.

## 1. Modules (backend/src/troubadour/)

| Module | Lines | Purpose | Top-level symbols | Internal imports | Heavy 3rd-party |
|---|---|---|---|---|---|
| `engine.py` | 2366 | Live engine (see §3) | consts, helpers, `Player Campaign Voice Message Bus AudioBuffer LiveSession TrainJob Engine`, `keep_awake sample_path session_audio migrate_state seated_players short_id` | asr cleanup config levels settings transcript tts audio campaign memory segment voices | numpy; torch, pyannote.audio, silero_vad (lazy); `caffeinate`, ffmpeg subprocess |
| `server.py` | 1283 | FastAPI HTTP+WS, pydantic input models, static web | `app bus engine vault memory cloning asker cloud accounts campaign_gate LOCAL_HOSTS lifespan reject_cross_site_writes _call WebFiles`, ~30 `*In` models, route handlers (§2) | config improve mics obsidian providers settings transcript tts ask audio campaign cloning cloud engine memory | fastapi, starlette, pydantic, httpx |
| `memory.py` | 1131 | Campaign jobs (note import, write-up), job runner thread, LLM client, spelling suggestions | `MemoryLLM Job Memory Word`, `fleeting passages_about chunks transcript_lines apply_heard_as glossary_brief link_names ordinary looks_like skeleton scan_words name_like spelling_suggestions _obj _text _try_again _raise_for _server_error`, `STR STRS KIND NOTES_SCHEMA NOTES_SYSTEM` | config dnd_terms providers transcript writeup campaign | httpx |
| `campaign.py` | 792 | Obsidian vault model: entity notes, frontmatter, Corrector | `Entity Vault Corrector`, `everyday english norm safe_name unique same_fact add_unique mention_counts split_frontmatter sections bullets parse render write_atomic`, `TYPES FOLDERS OWNED_KEYS STATUSES README` | config (lazy) | pyyaml |
| `providers.py` | 664 | Hosted LLMs: ChatGPT-plan OAuth (PKCE), OpenRouter sign-in, pasted keys, wire formats | `Provider`(frozen dc) `PROVIDERS Accounts ProviderError`(≈) + header/models-path helpers, `LOCAL OPENAI_* OPENROUTER_AUTH USAGE_URL KEY_MAX`; secrets in `DATA_DIR/llm_accounts.json` | config | httpx, pyjwt, hashlib/base64 |
| `tts.py` | 611 | Voice clones: Chatterbox + DeepFilterNet on MLX, reference selection, `Clones` store, note → speakable text | `Synth Clones`, `persona_key normalize speech_only join speech_seconds noise_floor_db solo_lines pick_sessions speakable chunks plausible _pack _split_long _inline _url`, `OUT_SR REF_S` | asr config audio campaign | mlx_audio, mlx.core, soxr (lazy), numpy |
| `cloud.py` | 597 | Opt-in Troubadour Cloud backup (OAuth PKCE, scan, signed uploads, restore) | `CloudError NotConnected Cloud AutoBackup`, `path_problem _vault_files fingerprint scan _inside`, `EMPTY_FINGERPRINT` limits | config | httpx, hashlib |
| `ask.py` | 562 | Ask: LLM plan → BM25 passage search → LLM answer w/ citations; job thread emits `campaign.answer` | `Passage Answer Asker`, `tokens rank mentioned query_weights session_passages entry_passage`, `PLAN_SCHEMA PLAN_SYSTEM ANSWER_SYSTEM` | campaign memory transcript | httpx |
| `talk.py` | 561 | Speech profile from transcripts (pace, pet phrases, openers), "in their words" restyle | `tokens ngrams pet_phrases openers shares profile monologue examples describe problem restyle preview_text _plain _ask _brief _written_sample` | ask transcript | — |
| `writeup.py` | 373 | Session write-up: notes → page → facts parsing/prompts | `Beat Named Notes Page`, `clean parse_notes parse_page read write heard facts snippets table_stats`, uses `writeup_example.md` | campaign | — |
| `cleanup.py` | 327 | Spelling cleanup: `Speller.find` (code), `ask` (constrained LLM), `apply` (edits+UTF-16 offsets), `Learner`, `clean_record` | `Candidate Speller Learner`, `key apply ask clean_record`, `SYSTEM SCHEMA` | dnd_terms campaign memory transcript | difflib |
| `audio.py` | 322 | Sources + WAV IO | `FileSource MicSource Recorder`, `load_audio pcm16 wav_bytes tempo read_wav list_mics _close`, `FRAME` | config | sounddevice, soxr (lazy), ffmpeg subprocess, numpy |
| `cloning.py` | 318 | Voice-clone jobs (profile/build/say/read), HTTP-free | `Cloning` | talk tts audio config voices | numpy, soxr |
| `improve.py` | 281 | Post-session jobs: re-transcribe, reassign speakers, spelling, in-character, restore | `improve_record run save speaker_window reassign_speakers fix_spellings label_in_character restore`, `RETRANSCRIBE_BACKUP` | asr cleanup config talk transcript audio campaign **engine** voices | numpy |
| `mics.py` | 276 | Mic spec catalogue, user overrides (`mics.json`), recording checks | `CATALOG system_devices overrides_path overrides set_override specs checks measured describe` | config audio | `system_profiler` subprocess |
| `levels.py` | 247 | Live level meter + recording-quality report/verdict | `LevelMeter`, `zone grade db quality hints clip_db report verdict`, `ZONES` | config | numpy |
| `sim.py` | 187 | `troubadour-sim`: headless re-run of saved session in a throwaway data dir + comparison | `main` | audio config transcript engine (lazy) | numpy |
| `voices.py` | 182 | Speaker embeddings, voice matcher | `VoiceMatcher`, `normalize speech_spans embed_span centroid` | — | torch, silero_vad (lazy), numpy |
| `asr.py` | 170 | mlx-whisper wrapper: prompt build, hallucination/“too fast” filters | `mlx_lock`, `prompt_tokens build_prompt prompt_names transcribe suspicious too_fast warm_up memory _run _foreign` | config settings | mlx_whisper, mlx.core (lazy) |
| `settings.py` | 168 | Persisted model/provider choices (`settings.json`) | `path defaults normalize_llm_url saved known_llms hosted_models current update`, `WHISPER_* SPEAKER_MODEL WHISPER_OPTIONS ROLES` | config providers | — |
| `transcript.py` | 150 | Saved record shape (`build`), markdown export, UTF-16 helpers | `filler_only without_fillers utf16_to_py utf16_offset clock speaker character_voices build markdown` | — | — |
| `segment.py` | 68 | Silero-VAD utterance state machine | `SegmentConfig`(frozen dc), `Segmenter` | — | numpy |
| `config.py` | 65 | Env-driven settings; `vault_dir()` resolved per call | `env`, `BACKEND REPO HOST PORT LLM_URL LLM_MODEL MEMORY_LLM_MODEL MEMORY_REASONING WHISPER_MODEL WHISPER_IMPROVE_MODEL ASR_PROMPT ASR_CONTEXT_LINES CLEANUP DIARIZER TTS_MODEL DENOISE_MODEL DATA_DIR SAMPLES_DIR WEB_DIST CLOUD_URL SR vault_dir` (+ `RECORD_AUDIO`, `MAX_REPLAY_SPEED` used elsewhere) | — | — |
| `dnd_terms.py` | 50 | SRD vocabulary (`srd_terms.json`) + optional `data/dnd_terms.json` | `builtin generated_path terms` | config | — |
| `obsidian.py` | 44 | Find Obsidian vault id for a folder | `registry vault_for`, `REGISTRY VAULT_ID` | config | — |
| `__init__.py` | 16 | `main()`: warning filters, runs uvicorn on `config.HOST:PORT` (entry point) | `main` | config | uvicorn |

### Internal import graph
- engine → asr, cleanup, config, levels, settings, transcript, tts, audio, campaign, memory, segment, voices
- server → config, improve, mics, obsidian, providers, settings, transcript, tts, ask, audio, campaign, cloning, cloud, engine, memory
- improve → asr, cleanup, config, talk, transcript, audio, campaign, **engine**, voices
- memory → config, dnd_terms, providers, transcript, writeup, campaign
- cleanup → dnd_terms, campaign, memory, transcript
- ask → campaign, memory, transcript; talk → ask, transcript; cloning → talk, tts, audio, config, voices
- tts → asr, config, audio, campaign; asr → config, settings; settings → config, providers
- providers, cloud, dnd_terms, obsidian → config; mics → config, audio; audio, levels, campaign → config
- writeup → campaign; sim → audio, config, transcript, engine
- No internal deps: segment, voices, transcript, config.
- Shared lock coupling: `tts` and `asr` share `asr.mlx_lock`. Layering oddities: `improve → engine` (jobs reach into Engine), `cleanup → memory` (for `looks_like`, `skeleton`), `talk → ask`.
- Heavy deps are imported lazily inside functions (torch, silero_vad, mlx_*, sounddevice, soxr) so tests never load models. scipy is a declared dep; usage not located (≈).

## 2. server.py (1283 lines)

### Setup
- Import-time singletons: `bus=Bus()`, `engine=Engine(bus)`, `vault=Vault(engine.vault_dir)`, `memory=Memory(vault,bus,sessions_dir=engine.sessions_dir, seed=engine.known_names)`, `cloning=Cloning(engine, llm=lambda: memory.llm, …)`, `asker=Asker(vault,bus,sessions_dir=engine.campaign_sessions,…)`, `cloud=Cloud()`, `accounts=Accounts()`, `campaign_gate=threading.Lock()`.
- `lifespan`: `bus.loop = running loop`; `_apply_models(settings.current())`; `engine.start_background()`.
- Middleware: `TrustedHostMiddleware(allowed_hosts=LOCAL_HOSTS={127.0.0.1, localhost, config.HOST})`; `reject_cross_site_writes` → 403 `{"detail":"cross-site request refused"}` for non-GET/HEAD/OPTIONS with non-local Origin (any port allowed for Vite dev).
- `_call(fn,*a)`: KeyError→404, ValueError→400.
- Input models (pydantic, length-capped): PlayerIn PlayerPatch SeatIn CampaignIn TrainIn SayIn ReadIn AssignIn MicIn/FileIn/SessionIn→StartIn(discriminated `kind`) EntityIn EntityPatch ReviewIn MicSpecsIn MicTestIn AudioMonitorIn IgnoreIn MergeIn FactIn FactsIn ImportIn AskIn CloudOptionsIn CloudRestoreIn ModelsIn HostedModelsIn LocalModelsIn LlmKeyIn LlmConnectIn SessionMergeIn.

### HTTP routes: METHOD path → handler — purpose
Models / LLM
- GET `/api/settings/models` → `get_models` — current model choices + options
- PUT `/api/settings/models` → `put_models` — save choices
- POST `/api/llm/local/models` → `local_models` — ask local server what it offers
- GET `/api/llm/local/servers` → `local_servers` — probe common local ports
- GET `/api/llm/models?provider=` → `llm_models` — hosted provider's model list
- POST `/api/llm/{provider}/connect` → `llm_connect` — start browser sign-in
- GET `/auth/callback` → `openai_callback` (HTML) — ChatGPT OAuth return
- GET `/api/llm/openrouter/callback` → `openrouter_callback` (HTML)
- PUT `/api/llm/{provider}/key` → `llm_key` — paste API key
- POST `/api/llm/{provider}/disconnect` → `llm_disconnect`
- POST `/api/llm/recheck` → `recheck_llm` — probe local LLM now
State / transcripts / sessions
- GET `/api/state` → `state` — `engine.snapshot()`
- GET `/api/debug/memory` → `debug_memory`
- GET `/api/transcript.{md|json}` → `current_transcript` — attachment
- GET `/api/sessions` → `sessions` — saved list
- POST `/api/sessions/merge` → `merge_sessions`
- GET `/api/sessions/{sid}/transcript.{md|json}` → `saved_transcript`
- POST `/api/sessions/{sid}/improve` → `improve_transcript` (job)
- POST `/api/sessions/{sid}/retranscribe` → `retranscribe`
- POST `/api/sessions/{sid}/spelling` → `fix_spellings`
- POST `/api/sessions/{sid}/in-character` → `estimate_in_character`
- POST `/api/sessions/{sid}/restore` → `restore_transcript`
- GET `/api/sessions/{sid}/quality` → `session_quality`
- GET `/api/sessions/{sid}/audio.wav` → `saved_audio` (Range)
Mics
- GET `/api/mics` → `list_mic_details`; PATCH `/api/mics/{name}` → `correct_mic`; POST `/api/mic/test` → `mic_test`; POST `/api/mic/test/stop` → `stop_mic_test`; PUT `/api/audio/monitor` → `audio_monitor`
Campaign vault
- GET `/api/campaign` → `campaign`
- POST `/api/campaign/entities` → `create_entity`; GET|PATCH|DELETE `/api/campaign/entities/{name}` → `get_entity|update_entity|delete_entity`
- POST `/api/campaign/entities/{name}/review|merge|facts/search|facts` → `review_entity|merge_entity|seek_facts|add_entity_fact`
- PUT `/api/campaign/facts` → `set_campaign_facts`; POST `/api/campaign/facts` → `add_campaign_fact`
- POST `/api/campaign/import` → `import_notes` (job); POST `/api/campaign/ask` → `ask`; POST `/api/campaign/writeup/{sid}` → `write_up` (job)
- POST `/api/campaign/ignore` → `ignore_words`; DELETE `/api/campaign/ignore/{word}` → `unignore_word`; GET `/api/campaign/suggestions` → `suggestions`
Cloud
- GET `/api/cloud` → `cloud_status`; POST `/api/cloud/connect` → `cloud_connect`; GET `/api/cloud/callback` → `cloud_callback` (HTML); POST `/api/cloud/disconnect` → `cloud_disconnect`; PUT `/api/cloud/options` → `cloud_options`; POST `/api/cloud/backup` → `cloud_backup`; GET `/api/cloud/vaults` → `cloud_vaults`; GET `/api/cloud/account` → `cloud_account`; POST `/api/cloud/restore` → `cloud_restore`
Sources / players / campaigns / training
- GET `/api/sources` → `sources` (sample WAVs + mics); GET `/api/files/{name}` → `sample_file` (Range)
- POST `/api/players` → `add_player`; PATCH|DELETE `/api/players/{pid}` → `update_player|remove_player`; POST `/api/players/{pid}/seat|bench` → `seat_player|bench_player`
- POST `/api/campaigns` → `create_campaign`; PATCH `/api/campaigns/{cid}` → `rename_campaign`; POST `/api/campaigns/{cid}/open` → `open_campaign`
- POST `/api/players/{pid}/train` → `train` (202); POST `/api/train/cancel` → `cancel_training` (204)
Voice clones
- GET `/api/clones` → `clones`; POST `/api/players/{pid}/profile|clone|clone/say|clone/read` → `build_profile|build_clone|clone_say|clone_read` (202 jobs); GET `/api/clones/{pid}/{name}.wav` → `clone_audio`; DELETE `/api/clones/{pid}/clips/{cid}` → `delete_clip`
Voices / messages / session control
- POST `/api/voices/{vid}/assign|unassign` → `assign|unassign`; POST `/api/messages/{mid}/speaker` → `assign_message`; GET `/api/voices/{vid}/sample.wav` → `voice_sample`
- POST `/api/session/start|pause|resume|stop` → `start|pause|resume|stop`

### WebSocket `/ws` (handler `ws`)
- Origin check (close 1008 if bad). Accept; `bus.subscribe()` BEFORE sending snapshot.
- **Client → server:** no message types; server only `receive_text()` to detect disconnect, content ignored.
- **Server → client:** `{"type": <t>, "data": <payload>}` (built in `Bus.emit`, engine.py:342-355). First frame `{"type":"snapshot","data":engine.snapshot()}`.
- Overflow: Bus.QUEUE_MAX=2000 → `OVERFLOW` sentinel → close 1013 → client reconnects, gets new snapshot.
- Types and emitters:
  - `snapshot` — ws connect; engine bench_player, open_campaign
  - `session.updated` — engine `_emit_session`, pause/resume/stop, every ~5 s running (carries llm_ok, status, audio_monitor, train job)
  - `message.created`, `messages.updated` (patch list) — engine
  - `speaker.active` {voice_id, confidence} — engine segment loop
  - `voice.upserted`, `voice.removed` {id, merged_into} — engine
  - `player.upserted`, `player.removed`, `library.updated`, `campaigns.updated` — engine
  - `train.status` — engine `_train_status`
  - `error` {message} — engine (model load, recording stopped, segmenter failure, mic stall 5 s, transcription failure)
  - `mic.test` {state,device,seconds} — engine
  - `audio.level`, `audio.quality` — levels.LevelMeter (via engine/mic test)
  - `campaign.updated` — memory.changed, memory import, engine glossary check, server open_campaign
  - `campaign.job` — memory.Memory.emit (Job progress; kinds import/writeup/facts/improve/spelling/retranscribe/backup/restore/clone/say/read/profile/incharacter)
  - `campaign.answer` — ask.Asker
  - `llm.updated` {provider, providers} — server `_llm_changed`
  - `cloud.updated` — server cloud callback/disconnect/options/backup

### Static web
- Last lines: `if config.WEB_DIST.is_dir(): app.mount("/", WebFiles(directory=config.WEB_DIST, html=True), name="web")`; `config.WEB_DIST = REPO/"web"/"dist"`.
- `WebFiles(StaticFiles)`: `assets/*` → `Cache-Control: public, max-age=31536000, immutable`; else `no-cache`; unknown non-`api`/`assets` 404s fall back to `index.html` (SPA deep links, e.g. `/history/<id>`).

## 3. engine.py (2366 lines)

| Lines | Item | Responsibility |
|---|---|---|
| 1-37 | docstring/imports | thread model: segmenter → worker → refine → llm health |
| 40-52 | `keep_awake` | caffeinate |
| 55-83 | constants | thresholds, PALETTE, STOP, SESSION_ID, OVERFLOW, CAMPAIGN_ID |
| 86-142 | `short_id _first_by_id _audio_seconds _concat_wav` | helpers |
| 144-180 | `sample_path session_audio` | resolve replay file/session audio |
| 181-207 | `Player`, `PERSON_KEYS` | library person |
| 208-221 | `MAIN_CAMPAIGN STATE_VERSION Campaign` | |
| 222-252 | `migrate_state seated_players` | pure state.json migration |
| 253-292 | `Voice` | dataclass + to_json |
| 293-321 | `Message` | dataclass |
| 322-366 | `Bus` | thread→asyncio fan-out |
| 367-387 | `AudioBuffer` | growing 16 kHz float32 whole-session buffer |
| 389-425 | `LiveSession` | one running session (source, queues, threads, recorder, abandon) |
| 427-458 | `TrainJob` | Train-recording capture |
| 460-2366 | `Engine` | all below |

Engine (approx. lines):
- 460-505 `__init__`; 506-565 model load (`start_background`, `_load_models` [pyannote embedder on MPS + Silero], `_wait_ready`, `_require_models`); 566 `shutdown`
- 581-650 mic test / session quality; 651 `known_names`
- 661-860 disk sessions: `sessions_dir transcript_record _transcript_signature save_transcript session_campaign campaign_sessions list_sessions merge_sessions session_file _snapshot_setup`
- 858-990 state.json + voice audio paths + `_load_state _in_campaign _voiceprint _state_data _save_state`; 991 `memory_stats`
- 1011-1070 JSON views: `session_json snapshot campaigns_json library_json _emit_session set_audio_monitor _emit_patches`
- 1072-1166 players (add/update/remove/seat/bench)
- 1167-1285 campaigns (`vault_dir create_campaign adopt_campaign rename_campaign open_campaign _require_idle _close_finished _sync_voices`)
- 1287-1435 voices (`_surface _update_suggestion _refresh_suggestions assign_voice assign_message unassign_voice _unassign voice_sample`)
- 1455-1600 session lifecycle (`start _attach_tap pause resume stop _finish`)
- 1600-1730 pipeline threads (`_segment_loop _segment _embed _quick_speaker _worker_loop`)
- 1730-1850 transcription (`_glossary_state _ignored_signature speller whisper_prompt _whisper_prompt _process_utterance _separate_from_next`)
- 1903-1978 cleanup thread (`_cleanup_loop _cleanup learn`)
- 1979-2043 speaker ID (`_identify _last_voice_of _character_tiebreak`)
- 2044-2131 refine (`_refine_loop _refine _relabel _tidy_pending _drop_pending`); 2135 `_speaker_name`
- 2142-2168 LLM health (`_set_llm_ok recheck_llm _llm_health_loop`)
- 2169-2290 training (`train cancel_training _train_status _train_run _finish_training`)
- 2291-2345 clone support (`clone_allowed check_clone _train_voice has_train_clip train_clip train_voiceprint`)
- 2346-2366 `embed wait_for_models wait_idle`

Natural split seams
1. `bus.py`: Bus, OVERFLOW (no deps).
2. `model.py`: Player, Campaign, Voice, Message, constants, migrate_state/seated_players, short_id (pure data).
3. `storage.py`: sessions_dir, session_audio, sample_path, _concat_wav, save/list/merge sessions, state.json IO, voice audio paths.
4. `library.py`: players + campaigns/roster + open_campaign/_sync_voices.
5. `voiceset.py`: assign/unassign/surface/suggestions/_identify/_refine/_tidy.
6. `pipeline.py`: LiveSession, AudioBuffer, start/pause/stop, segment & worker loops, process_utterance, whisper prompt/glossary.
7. `background.py`: cleanup loop, LLM health, refine loop, model loading.
8. `training.py`: TrainJob, train, clone support.
9. mic_test/session_quality → next to `levels.py`.
Constraints: everything shares `Engine.lock` (RLock) and `sess is self.live` guards; `embed_lock`; `improve.py` imports `engine.PROVISIONAL_BELOW/Engine/session_audio`; `server.py` imports `OVERFLOW SESSION_ID Bus Engine sample_path session_audio`; tests monkeypatch `troubadour.asr.transcribe`, `engine.cleanup_llm.json`, and set `eng.live/buffer/status/matcher/embedder/ready` directly.

## 4. pyproject.toml
- name `troubadour` 0.1.0; "Live, speaker-labeled transcription of an in-person D&D table, all local"; readme README.md; requires-python >=3.12; author Michael Margolis.
- Scripts: `troubadour = "troubadour:main"`, `troubadour-sim = "troubadour.sim:main"`.
- Deps: fastapi>=0.143.0, httpx>=0.28.1, mlx-audio>=0.6.3, mlx-whisper>=0.4.3, pyannote-audio>=4.0.7, pyjwt[crypto]>=2.10, pyyaml>=6.0.3, scipy>=1.18.1, silero-vad>=6.2.3, sounddevice>=0.5.6, soxr>=1.1.0, uvicorn[standard]>=0.54.0.
- Groups: `dev` = pytest>=8.4, ruff>=0.14. `spike` = jiwer>=4.0.0, librosa>=1.0.0, pyannote-metrics>=4.1, whisper-normalizer>=0.1.15.
- Build: `uv_build>=0.12.5,<0.13.0`.
- ruff: line-length 130, py312; select E,F,W,I,B,UP,SIM,PT; ignore E501, SIM108; per-file `spike/*` ignores B905,B023,SIM,UP.
- pytest: testpaths `tests`, addopts `-q`, filterwarnings `error` + ignores (starlette httpx TestClient, torchaudio DeprecationWarning/UserWarning, FutureWarning).
- No pyright/mypy config anywhere in pyproject.

## 5. Tests (backend/tests) — lines
test_cloud 878 · test_memory 751 · test_engine 729 · test_providers 546 · test_cloning 515 · test_recording 500 · test_tts 426 · test_talk 372 · test_campaigns 352 · test_transcript 289 · test_server 270 · test_campaign 250 · test_ask 234 · test_audio_bus 208 · conftest 184 · test_cleanup 170 · test_levels 149 · test_writeup 141 · test_improve 130 · test_campaign_api 126 · test_asr 119 · test_mics 95 · test_voices 93 · test_segment 82 · test_obsidian 39 · test_settings 33 · test_config 17; plus `cloud_contract.schema.json`.
(Line counts were read per file; name↔count mapping follows call order and was cross-checked for test_engine 729 / test_server 270 / conftest 184.)

### conftest.py (184 lines)
- Import-time: temp dir `troubadour-tests-*`; sets `TROUBADOUR_DATA`, `TROUBADOUR_SAMPLES`, `TROUBADOUR_OBSIDIAN_REGISTRY` BEFORE importing troubadour (server.py builds an Engine on import).
- `FakeEmbedder` (dim 256, pooled FFT magnitude → sine tones act as speakers); `tone(freq, seconds)`; `RecordingBus(Bus)` (`events`, `of(type)`, emit records only); `NullSource` (start/pause/resume/stop no-ops, `stopped`/`paused` flags) — this is the mic/source fake.
- `dirs(tmp_path, monkeypatch)`: patches `config.DATA_DIR`→tmp/data, `config.SAMPLES_DIR`→tmp/samples (created); returns `(data, samples)`.
- `engine(dirs, monkeypatch)`: `Engine(RecordingBus())`, `embedder=FakeEmbedder()`, `matcher=VoiceMatcher(embedder)`, `ready.set()`, live `LiveSession(NullSource(), {"kind":"file","name":"x.wav","speed":1.0})`, `status="running"`; patches `troubadour.asr.transcribe` → "I deal 12 slashing damage", `config.ASR_PROMPT=False`, and `eng.cleanup_llm.json` → raises ConnectionError (no real LLM).
- Helpers: `speak(eng,freq,seconds,gap=0.3)` (append tone to live buffer, returns (t0,t1)); `write_wav(path, audio)`.
- autouse `hermetic_dnd_terms`: `dnd_terms.generated_path` → nonexistent file.
- Clone fakes: `FakeSynth(cps=14, bad=0)` (denoise/voice/speak; records `said`, `denoised`; `bad` returns 0.1 s clips first); `ScriptedLLM(*replies)` (`json(system,user,schema,max_tokens)` pops scripted replies, raises Exceptions, records `prompts`) — the LLM fake; `job()` → `memory.Job(id="test", kind="clone", title="")`; fixture `fake_vad` (patches `silero_vad.get_speech_timestamps` so whole clip is speech).
- Also: `FakeLLM` in `tests/test_memory.py` (per AGENTS.md); `client` fixture for test_server.py defined in that file (≈ TestClient on `server.app`).

## 6. Root package.json / CI
Root: `"name":"troubadour"`, `"private":true`, `"packageManager":"yarn@4.9.1"`. Scripts verbatim:
```
"setup": "cd backend && uv sync --all-groups && cd ../web && pnpm install",
"start": "cd backend && uv run troubadour",
"dev": "sh scripts/dev.sh",
"dev:web": "cd web && pnpm dev",
"build": "cd web && pnpm build",
"test": "yarn test:backend && yarn test:web",
"test:backend": "cd backend && uv run pytest",
"test:web": "cd web && pnpm test",
"lint": "yarn lint:backend && yarn lint:web",
"lint:backend": "cd backend && uv run ruff check src tests spike",
"lint:web": "cd web && pnpm lint",
"typecheck": "cd web && pnpm typecheck",
"format": "cd backend && uv run ruff check --fix --select I src tests spike && uv run ruff format src tests spike && cd ../web && pnpm format",
"format:check": "cd backend && uv run ruff format --check src tests spike && cd ../web && pnpm format:check",
"check": "yarn format:check && yarn lint && yarn typecheck && yarn test && yarn build",
"check:live": "cd backend && uv run spike/harden_check.py"
```
`scripts/dev.sh`: cd repo root; `yarn start &` (API) and `yarn dev:web &`; trap INT/TERM/EXIT kills both; `wait` on web.

CI `.github/workflows/ci.yml` (only workflow; job `check`): on push to main + pull_request; runs-on `macos-15` (mlx-whisper installs only on arm64 macOS). Steps: checkout@v4 → `brew install ffmpeg` → astral-sh/setup-uv@v6 (cache on backend/uv.lock) → pnpm/action-setup@v4 (web/package.json) → actions/setup-node@v4 (node 24, pnpm cache web/pnpm-lock.yaml) → `corepack enable` → `yarn install --immutable` → `yarn setup` → `yarn check`.

## 7. Data dir layout (`TROUBADOUR_DATA`, default `~/troubadour`; env names also accepted with legacy `BARD_` prefix)
Paths from code (`config.DATA_DIR`):
- `state.json` — players, campaigns (rosters), named voiceprints (STATE_VERSION 2)
- `settings.json` (settings.py) · `llm_accounts.json` (providers.py secrets) · `cloud.json` (cloud.py) · `mics.json` (mics.py) · `dnd_terms.json` (optional, dnd_terms.py)
- `sessions/<YYYY-MM-DD_HHMMSS-xxxx>/`: `meta.json` (source, campaign, duration_s…), `transcript.json`, `transcript.md`, `audio.wav` (mono 16-bit at mic rate; mic sessions only), `transcript.orig.json` (backup before first improve), `transcript.before-retranscribe.json`, `setup/<phase>.json` (start/end snapshots), temp `.audio.wav.merging`, `.transcript.before-retranscribe.json.tmp`; quality cache file next to audio (name not located ≈)
- `voices/<voice id>.wav` (16 kHz Train clip) and `<voice id>.hq.wav` (24-bit, mic's own rate)
- `clones/<player id>/`: `reference.wav`, `preview.wav`, `voice.json`, `profile.json`, `clips/<clip id>.wav` + `.json`; character voices keyed by persona key
- `campaigns/<campaign id>/` — vault of non-main campaigns. Main vault = `config.vault_dir()` = `$TROUBADOUR_VAULT` or `DATA_DIR/campaign`.
- Outside DATA_DIR: `SAMPLES_DIR` = `TROUBADOUR_SAMPLES` or `backend/samples/eval` (replay WAVs); `TROUBADOUR_OBSIDIAN_REGISTRY` default `~/Library/Application Support/obsidian/obsidian.json`.
- Vault layout (campaign.py/memory.py/cloud.py): entity folders by type (`People`, … via `FOLDERS` from `TYPES`; pc→People, npc→NPC folder ≈, place, …) with `<name>.md`; `Notes/*.md` (imports); `Sessions/<title>.md` (write-ups, `session_id:` frontmatter); `Sessions/Transcripts/<sid>.md`; `Glossary.md` (generated); `Ignored words.md`; `README.md`; `.trash/` (deletes, `.trash/Before restore <ts>`); `.obsidian` ignored by cloud.

## 8. backend/spike (names only)
asr_compare, asr_score, clone_reference, clone_smoke, dataset, eval, harden_check (target of `yarn check:live`), lab_llm, llm_concurrency, make_scene, memory_trial, memwatch, prompt_sweep, run, segment_sweep, soak, style, ui_probe, unknown, weak_mic, writeup_lab, writeup_score (.py) + WRITEUP_BENCHMARK.md. Linted by ruff with relaxed rules; results go to `backend/samples/` (gitignored).

## 9. backend/AGENTS.md invariants
Session isolation (`sess is self.live` under lock); `engine.lock` RLock never held across Whisper/LLM/disk; `asr.mlx_lock` serializes MLX (Whisper + clone), `embed_lock` serializes torch MPS; vault/LLM/disk failure never stops transcription; patches not replacements for UI-clicked state; never lose words (`transcript.orig.json`, `fixes`); vault notes are user's (owned keys only, `read_only` on bad frontmatter, deletes → `.trash/`); spelling cleanup never touches everyday speech. New endpoint: pydantic models w/ length caps, `_call` error mapping, `memory.changed()` on vault mutations, update `web/src/lib/types.ts` + `api.ts` + PLAN.md.
