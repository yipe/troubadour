# Page map

## Design screens → routes → today's code → tasks

Design files are in `docs/design/troubadour-redesign/` (PNG in `screenshots/`, exact values in the `.dc.html`).

| ID | Screen (file) | Route | Today | Status | Tasks |
|---|---|---|---|---|---|
| nav | Troubadour Nav | shell | `App.tsx` header, `CampaignSwitcher`, `AccountMenu`, `CloudBackupButton` trigger | Rebuild | S1, S11, S12, S13 |
| 1a | Screen Setup | `/welcome/:step` | `setup/SetupView`, `PlayerCard`, `LibraryList`, `TrainDialog`, `ImportDialog`, `ModelsDialog` | **New flow**, parts ported | F3 (+S7, S8, S9, S10) |
| 1b | Screen Home | `/` | none (History was the landing view) | **New** | F1 (+C2, C8) |
| 1c | Screen Lobby | `/sessions/new` | `setup/StartPanel`, `audio/MicTest`, `MicDetails` | Rebuild | F2 (+S7, S14, C2) |
| 1f / 3a | Screen Live C / **Live Prototype** | `/sessions/live` | `session/SessionView`, `SessionHeader`, `PlayerGrid`, `PlayerBox`, `ChatFeed`, `VoicesPanel`, `LineSpeakerPicker`, `LiveQualityBox`, `SessionAudio` | Rebuild + **new notebook, pins** | F4, F5, F6, F7 (+C3, C4) |
| 1g | Screen Ask Overlay | inside live (inline panel) | `campaign/AskPanel` | Restyle as `AskAnswer` | S5, F5 |
| 1h | Screen Review A (**chosen**) | `/sessions/:id/review` | spread over `SuggestionsCard`, `EntityEditor`, `WriteUpButton` | **New** | F8 (+C7, C8) |
| 1k | Screen Facts A (**chosen**) | `/facts` | `campaign/FactList`, `CampaignFacts` (inside an entry only) | **New** | F13 (+C6) |
| 1n | Screen Codex | `/codex/:entry` | `campaign/CampaignView`, `GlossaryList`, `EntityEditor`, `ChipEditor`, `EntityPicker` | Rebuild | F14, F15 (+C9) |
| 1o | Screen History | `/sessions[/:id]` | `history/HistoryView`, `SavedSessionRow`, `SessionViewer`, `TranscriptTools`, `RecordingQualityPanel` | Rebuild | F9, F10, F11 |
| 1p | Screen Recap | `/sessions/:id/recap` | `campaign/WriteUpButton`, `clone/ReadAloud` | **New** | F16 (+C10, S14) |
| 1q | Screen Settings | `/settings/models` | `ModelsDialog` | Dialog → page | F18 (+S9, C11) |
| 1r | App Icons (Listening die) | favicon | `web/public/favicon.svg`, `site/favicon.svg` | Redraw | X1 |
| 2a | Screen Cloud Connect | dialog | `CloudBackupButton` popover | **New** | S12 |
| 2b | Screen Cloud Popover | nav chip | `CloudBackupButton` | Rebuild | S12 (+C12) |
| 2c | Screen Cloud Settings | `/settings/cloud` | `CloudBackupButton`, `cloudStore` | **New page** | F22 (+C12) |
| 3d | Screen Cloud Player | the cloud service | none | **Deferred** (other repo); this repo writes `_Overview/` | C13 |
| 4a | Screen Timeline C (**chosen**) | `/timeline` | `lib/talkTime` only | **New** | F12 (+C9) |
| — | (no design) Ask page | `/ask` | `campaign/AskPanel` (`AskView`) | Restyle with `AskAnswer` | F17 |
| — | (no design) Transcript viewer | `/sessions/:id/transcript` | `history/SessionViewer` | Restyle | F11 |
| — | (no design) Settings › Microphone | `/settings/microphone` | `audio/MicDetails`, `MicTest` | New page from old parts | F19 |
| — | (no design) Settings › Players & voices | `/settings/players` | `setup/*`, `clone/VoiceCloneDialog`, `SpeechProfile`, `TheirWordsSwitch` | New page from old parts | F20 |
| — | (no design) Settings › Obsidian vault | `/settings/vault` | `ObsidianLink`, `ImportDialog`, ignored words in `SuggestionsCard` | New page from old parts | F21 |

Alternatives kept only as references (**don't build**): 1d (Live A), 1i/1j (Review B/C), 1l/1m (Facts B/C), 3b/3c
(Timeline A/B).

Screens without a design follow the same patterns: `RailLayout`, `PageHeading`, `Card`, tables. Keep
them plain.

## Every current feature → where it lives after the rebuild

Nothing is dropped silently. Each row names the task that carries the feature over.

| Feature today | New home | Task |
|---|---|---|
| Players: add, edit, avatar, GM flag, bench, remove; library (players from other campaigns) | `PlayersTable` (wizard step 2, settings › players); library banner "N players from X have trained voices" | S8, F3, F20 |
| Voice training (20 s) | `TrainDialog` from Train/Retrain | S8 |
| Voice clones, speech profile, "in their words", say, clips, consent | Settings › Players & voices → per-player "Voice clone" dialog | F20 |
| Read a write-up aloud | `ReadAloud`: ready check (Previously on…), recap | S14, F2, F16 |
| Session source: mic, file replay with speed, replay a saved session | Ready check mic card: device select lists mics, then "Replay a file…" and "Replay a session…" (dev aids, kept) | S7, F2 |
| Red-check warning before Start | Ready check "Start anyway?" `ConfirmDialog` | F2 |
| Mic test, mic specs and checks, quality grades | `MicCard` (ready, wizard, settings); `MicDetails` specs form in settings › microphone | S7, F19 |
| Live meter and quality box during a session | Live left rail status line; click opens a popover with the quality rows | F4 |
| Live transcript, jump to latest, speaker reassign per line | `TranscriptList` live mode; clicking a name opens the speaker picker | S4, F5 |
| Pending and named voices, assign/unassign, sample play | Pending voice card in the rail; full list in the "Voices" popover | F4 |
| Pause, resume, stop, new session, Whisper/LLM status and recheck | Rail buttons, nav recording pill, nav AI status (→ settings › models) | F4, S1 |
| Live export links (md/json) | Live rail "Export" menu | F4 |
| Saved sessions list, merge, suggested merge pair | Sessions rail; "Merge with another session" dialog | F9, F10 |
| Saved session viewer (player boxes, transcript, audio, write-up tab) | Transcript viewer page; recap and write-up in the session detail | F11, F9 |
| Downloads (md, json, audio) | Session "Export" menu | F10 |
| Improve transcript, fix spellings, retranscribe, in-character estimate, restore original | "Improve transcript" dialog | F10 |
| Recording quality report | "Audio quality" link → dialog with the report | F10 |
| Write-up job (steps, marquee, live tokens) | Session detail "Write up" + `JobStatus`; started by End session too | F9, F7, S6 |
| Codex: list, search, type filters, needs review | Codex rail | F14 |
| Entry editor: name, type, description, aliases, heard-as (accept/reject suggested), facts, merge, delete, look for facts, Obsidian link | Codex entry page + edit dialog | F14, F15 |
| Campaign-wide facts | Facts page, About = "Campaign" | F13 |
| Spelling suggestions (misheard/unknown), ignore, unignore, reject misheard | Review (per session, beside the line); codex "Needs review"; ignored words in settings › vault | F8, F15, F21 |
| Import notes | `ImportNotes` (wizard step 4, settings › vault) | S10 |
| Ask (question list, answers with sources, open source) | Ask page + live ask bar | F17, F5 |
| Models dialog (Whisper models, local server URL and scan, hosted providers, sign-in, keys, model pick) | `ModelsSettings` (wizard step 5, settings › models) | S9, F18 |
| Cloud backup: connect, options, back up now, restore, vaults from other Macs, account | Nav chip + popover, connect dialog, settings › cloud | S12, F22 |
| Account menu (Models, sign-in, links, disconnect) | `AccountMenu` (Settings, cloud account, disconnect) | S13 |
| Campaign switcher, new, rename | `CampaignSwitcher` (new opens the wizard at step 1) | S11 |
| Error boundary, "waiting for server", server error banner | App shell | S1 |
| URL deep links | React Router + redirects from old paths | S1 |

## Deferred / out of scope

- **Shared table-screen mode, saving Ask answers as facts, multi-device editing and sync conflicts:** removed by the design.
- **The alternative screens** listed above.
- **Cloud player view web app (3d):** belongs to the cloud service repo. This repo only generates `_Overview/` pages (C13).
- **Server-side backup snapshot list:** needs a cloud-service endpoint. History shows local attempts (C12).
- **Appearance settings, light and midnight themes:** the tokens ship them; no UI until asked.
- **"Delete recordings after review" policy:** destructive, and not needed for the redesign. Storage usage is shown read-only.
- **Live scene detection and the scene breadcrumb:** scenes come from the write-up (C7) for History and the Timeline.
- **"Heard all seats" mic check and "asked by <player>" on answers:** no data source today. The checklist uses the existing checks.
- **Composition refactor of `Engine`:** B2 leaves mixins and clear seams; composition comes later.
- **Publishing `@yipe/tokens` and a shared `SwatchGrid`:** owner steps after the rebuild (`design-system.md`).
