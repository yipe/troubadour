# web/ inventory (React 19 + Vite 8 + Tailwind v4 + shadcn base-nova)

Line counts = file lines at read time. All paths relative to repo root `web/`.
Src: `src/main.tsx` 13, `App.tsx` 124, `App.test.tsx` 51, 19 ui primitives, 56 non-ui component files (incl. 1 `.ts`), lib files (incl. tests), 3 test helpers.
Note: `AGENTS.md` says tabs are "Setup | Session | History | Campaign"; the code has **Sessions | Campaign | Ask** (stale doc).

---
## 1. Routing

No router library. Two stores + a hand-rolled URL mirror.

- View enum: `View = "setup" | "session" | "history" | "campaign" | "ask"` (`lib/store.ts`, `useStore.view`).
- `App.tsx` header tabs (`TABS`): **Sessions**, **Campaign**, **Ask**. "Sessions" is active when `view` is not campaign/ask; clicking it from campaign/ask goes to `viewing ? "history" : running ? "session" : "setup"`. Campaign/Ask call `actions.setView(id)`.
- `App.tsx` body switch (not loaded → "Waiting for the Troubadour server…"):
  - `view === "campaign"` → `CampaignView` (components/campaign/CampaignView.tsx)
  - `view === "ask"` → `AskView` (components/campaign/AskPanel.tsx)
  - else (setup/session/history) → `HistoryView` (components/history/HistoryView.tsx) = Sessions shell: left sidebar (New Session button, Live/Paused session button, `HistoryList`), right pane switch:
    - `view === "session"` → `SessionView`
    - `view === "history" && viewing` → `SessionViewer` (key = viewing.id)
    - `view === "setup"` → `SetupView` (in scroll wrapper)
    - else placeholder "Select a session, or start a new one."
- URL ↔ state (`lib/route.ts`): paths `/setup`, `/session`, `/history[/<session id>]`, `/campaign[/<entry name>]`, `/ask`. `/` and unknown → null (app picks view; first snapshot sets setup if idle else session). `startRouting()` (called in `App` effect) subscribes to `useStore` + `useCampaign`, waits for `loaded`, applies `location.pathname` once, then `pushState` on store change; `popstate` re-applies. `history/<id>` needs summary → `openById` fetches `api.sessions()` and finds it (toast on miss). `campaign/<name>` ↔ `useCampaign.selected`. Exports: `Route`, `parsePath`, `routePath`, `openSessionById`, `startRouting`.
- Sub-views inside screens (local state, not in URL):
  - SessionViewer right rail tabs `RailTab = audio | transcript | writeup` (collapsible) → `RecordingQualityPanel` / download links + `TranscriptTools` / `WriteUpButton` (→ `ReadAloud`).
  - StartPanel source kind `mic | file`; "Session in progress" card when status ≠ idle.
  - CampaignView: selected entry (store `selected`) → `EntityEditor` in main pane, else hint. (AGENTS.md says a right-hand `Sheet`; code uses an inline `<main>` pane. `ui/sheet.tsx` has no importer in components read.)
  - GlossaryList filter chips (all / type / review).
- Dialogs/popovers (component ← trigger):
  - `ModelsDialog` ← `AccountMenu` item "Models" and the header status button in `App.tsx` (`setModelsOpen(true)`, state `llmStore.modelsOpen`); also toast action "Open Models" from `campaignStore.attempt`.
  - `CampaignNameDialog` (local to CampaignSwitcher) ← "New campaign…" option / pencil button.
  - `TrainDialog` ← `PlayerCard` Train/Retrain.
  - `VoiceCloneDialog` ← `PlayerCard` Speech icon.
  - `StartPanel` red-mic-checks Dialog (Start anyway / Pick another mic).
  - `ImportDialog` ← `CampaignView` "Import notes".
  - `TranscriptTools` Retranscribed report Dialog; inline confirms for Retranscribe and Restore original.
  - `EntityFooter` inline merge/delete confirms; `LibraryChip` delete confirm.
  - Popovers: `AccountMenu`, `CloudBackupButton`, `LineSpeakerPicker`, `EntityPicker` (cmdk), `ModelsDialog.ServerPick`.
  - `window.confirm` in `VoiceCloneDialog.setConsent`.
  - Global: `Toaster` (sonner bottom-right), `ErrorBoundary` (main.tsx), destructive `Alert` bar for `session.error` (App).

---
## 2. Components (excl. ui/)

Format: path (lines) — renders; props; stores/hooks/api; child components; test.

### Top level `components/`
- `AccountMenu.tsx` (153) — header avatar Popover: Models, sign-in with DPRcalc, account info, Back up now, links, Disconnect; hosts `<ModelsDialog>`. Props: none. Uses `useCloud`/`cloudActions`, `useCampaign(running("backup"))`, `useLlmProviders.modelsOpen`, `setModelsOpen`. Renders `ModelsDialog`, `DprcalcMark`, `Popover*`, `Button`. Imports `running` from `campaign/CloudBackupButton`. Test: `AccountMenu.test.tsx` (99).
- `CampaignSwitcher.tsx` (150) — header NativeSelect of campaigns + rename button + local `CampaignNameDialog`. Props: none. Uses `useStore` (campaign, campaigns, busy), `api.openCampaign/createCampaign/renameCampaign`. Renders `Dialog*`, `Input`, `NativeSelect`. Test: `CampaignSwitcher.test.tsx` (138).
- `DprcalcMark.tsx` (12) — SVG logo. Props `{className?}`.
- `ErrorBoundary.tsx` (36) — class boundary "Something broke — reload". Props `{children}`. Used in `main.tsx`.
- `ModelsDialog.tsx` (683) — Models settings Dialog: whisper models, provider select, local server URL/scan/api key, per-provider sign-in/key panel, model pickers, Save. Props `{open, onOpenChange}`. Uses `useLlmProviders`, `setLlmProviders`, `useStore(session.llm)`; `api.modelSettings/localServers/scanLocalModels/saveModelSettings/llmModels/llmConnect/llmKey/llmDisconnect`. Local: `ProviderPanel`, `Field`, `ModelPicker`, `ServerStatus`, `ServerBadge`, `ServerPick` (Popover), `blurb`, `options`, `modelLabel`. Uses raw `<input>`/`<select>` (not ui primitives). Test: `ModelsDialog.test.tsx` (321).
- `PlayerAvatar.tsx` (33) — avatar image or colored initials. Props `{player: AvatarPerson|null, className?}`; exports `AvatarPerson`. Uses `initials`.

### `components/transcript/`
- `TranscriptRow.tsx` (140) — one transcript line (avatar/name/time/text; `continued` chat mode; uncertain "?" tooltip; flash on `bump`). Props `TranscriptRowProps {id,text,fixes?,tStart,uncertain,speaker,person,character?,extra?,renderName?,continued?,bump?,onTimestampClick?}`; also exports `TranscriptSpacer`. Uses `mmss`. Renders `PlayerAvatar`, `FixedText`, `Tooltip*`. Used by `ChatFeed`, `SessionViewer`. No test.
- `PlayerBox.tsx` (89) — player card with talk-share bar, GM crown, in-character %. Props `{person: PlayerBoxPerson, speaking?, seconds, total, inCharacter?}`; exports `PlayerBoxPerson`, `UnnamedShareChip`. Uses `sharePct/talkDuration`. Used by `PlayerGrid`, `SessionViewer`. No test.
- `FixedText.tsx` (26) — text with spell-fixed spans underlined (title "Heard as"). Props `{text, fixes}`. Uses `splitFixes`. Test: `FixedText.test.tsx` (32).

### `components/setup/`
- `SetupView.tsx` (61) — Players list + Add player + `LibraryList` + `StartPanel` aside. Uses `useStore.players`, `actions.upsertPlayer`, `api.createPlayer`. Renders `PlayerCard`, `LibraryList`, `StartPanel`. No test.
- `StartPanel.tsx` (291) — Start session card: mic/file source, speed, `MicDetails`, `MicTest`, red-checks warning Dialog. Exports `SOURCES_POLL_MS` (2000), `MIC_KEY` `troubadour.mic`, `OLD_MIC_KEY` `bard.mic`. Uses `useStore` (sources, session), `actions.setSources/setView`, `api.sources` (polled when idle) / `api.mics` / `api.startSession`, localStorage. Renders `Card*`, `Select*`, `Dialog*`, `Label`. Test: `StartPanel.test.tsx` (181).
- `PlayerCard.tsx` (173) — editable player (avatar upload, color, name, character, GM switch, Trained badge, Train/Clone/Remove). Props `{player}`. Uses `useStore`, `useIdle`, `actions.upsertPlayer`, `api.updatePlayer/benchPlayer`, `fileToAvatar`. Renders `TrainDialog`, `VoiceCloneDialog`, `PlayerAvatar`, `Card`, `Input`, `Switch`, `Badge`. No test.
- `LibraryList.tsx` (79) — chips for people from other campaigns (Add / delete-for-good confirm). Uses `useStore.library`, `api.seatPlayer/deletePlayer`, `actions.seated/dropFromLibrary`. Renders `PlayerAvatar`. Test: `LibraryList.test.tsx` (97).
- `TrainDialog.tsx` (145) — 20 s voice training Dialog (countdown/progress/level). Props `{player, open, onOpenChange}`. Uses `useStore` (train, session.error), `actions.clearTrain`, `api.trainPlayer/cancelTraining`. Renders `Dialog*`, `Progress`. No test.

### `components/session/`
- `SessionView.tsx` (36) — live layout: SessionHeader, PlayerGrid, ChatFeed, VoicesPanel aside, LiveQualityBox (mic only; expanded/collapsed). Uses `useStore.session`. No test.
- `SessionHeader.tsx` (164) — source label, status badge, clock, Whisper/LLM dots (+Retry), audio, export, New session/Pause/Resume/Stop. Uses `useStore.session`, `useSessionTime`, `actions.setView`, `api.recheckLlm/pauseSession/resumeSession/stopSession`, `mmss`, `sourceLabel`. Renders `SessionAudio`, `ExportLinks`, `Badge`, `Tooltip*`. Test: `SessionHeader.test.tsx` (65).
- `SessionAudio.tsx` (70) — hidden `<audio>` synced to session clock for file sources; mute / "Play audio". Uses `useStore.session`, `sessionTimeNow`; URL `/api/files/<name>` (not in `api.ts`). No test.
- `ExportLinks.tsx` (45) — live transcript md/json download links (disabled + tooltip if no messages). Uses `useStore.messages`, `transcriptUrl`. Test: `ExportLinks.test.tsx` (35).
- `PlayerGrid.tsx` (48) — PlayerBoxes with speaking glow + unnamed chip + "voice speaking" chip. Uses `useStore` (players, voices, messages), `useSpeaking`, `talkTime`. Renders `PlayerBox`, `UnnamedShareChip`. Test: `PlayerGrid.test.tsx` (71).
- `ChatFeed.tsx` (129) — react-virtuoso live transcript, jump-to-latest, memoized `MessageRow` with `LineSpeakerPicker` and "Name this voice". Uses `useStore` (messages, voices, players, bumps), `actions.focusVoice`, `speakerFor/speakerKey`. Renders `TranscriptRow`, `TranscriptSpacer`, `LineSpeakerPicker`. Test: `ChatFeed.test.tsx` (188).
- `LineSpeakerPicker.tsx` (100) — Popover to reassign a line's speaker/character. Props `{messageId, children}`. Uses `useStore` (players, voices), `api.assignMessage`. Renders `PlayerAvatar`, `Popover*`, `Input`. Test: `LineSpeakerPicker.test.tsx` (67).
- `VoicesPanel.tsx` (188) — pending voices (cap 8, show all, focus-from-chat) and named voices; assign/unassign. Local `PendingVoice`, `NamedVoice`. Uses `useStore` (voices, players, focus), `actions.upsertVoice`, `api.assignVoice/unassignVoice`, `speakerFor`. Renders `SamplePlayer`, `PlayerAvatar`, `Select*`, `Input`, `Badge`. Test: `VoicesPanel.test.tsx` (69).
- `SamplePlayer.tsx` (41) — play/pause button for a sample URL (`preload="none"`). Props `{url}`. No store. No test.

### `components/history/`
- `HistoryView.tsx` (281) — Sessions shell (see §1) + local `HistoryList` (saved sessions, select-2 merge, suggested pair, "Merge matching sessions" with hand-rolled progress bar). Uses `useStore` (view, viewing, session.status), `useCampaign` (refresh for write-up titles), `useSavedSessions`, `api.mergeSessions`, `dateTime`. Renders `SessionView`, `SetupView`, `SessionViewer`, `SavedSessionRow`. Test: `HistoryView.test.tsx` (307).
- `SavedSessionRow.tsx` (96) — list row (write-up title, date, source, lines, quality dot, duration, checkbox, downloads). Exports `SessionDownloads`, `SavedSessionRow`. Uses `useCampaign.campaign.written_up`, `actions.openSavedSession`, `transcriptUrl/sessionAudioUrl`, `VERDICT`. No own test (badge tested in `RecordingQualityPanel.test.tsx`).
- `SessionViewer.tsx` (267) — read-only saved session: header, local `RecordBody` (PlayerBoxes + Virtuoso of `TranscriptRow`, seek), collapsible rail tabs (Audio/Transcript/Write-up). Props `{summary, onBack}`. Uses `api.sessionRecord/sessions`, `loadRecord`, `recordTalkTime`, `useStore.getState().viewing`, `actions.openSavedSession`, `sessionAudioUrl/transcriptUrl`. Renders `RecordingQualityPanel`, `PlayerBox`, `UnnamedShareChip`, `TranscriptRow`, `TranscriptTools`, `WriteUpButton`. Test: `SessionViewer.test.tsx` (54).
- `TranscriptTools.tsx` (272) — Improve / Fix spellings / Retranscribe / Estimate in-character job buttons, Restore original, status lines, report dialog. Props `{summary, improved, spelling, retranscribed, inCharacter?, onReload}`. Uses `useCampaign.jobs`, `attempt`, `campaignActions.putJob`, `api.improveSession/fixSpellings/retranscribeSession/estimateInCharacter/restoreSession`, `jobActive/jobCount`. Test: `TranscriptTools.test.tsx` (305).

### `components/clone/`
- `VoiceCloneDialog.tsx` (265) — consent switch, speech profile, build voice, previews, say box, clip list. Props `{player, trained, open, onOpenChange}`. Uses `useClones`/`refreshClones`, `useCampaign.jobs`, `useIdle`, `attempt`, `campaignActions.startJob`, `actions.upsertPlayer`, `api.updatePlayer/buildClone/cloneSay/deleteClip`, `latestJob/jobActive`. Renders `SpeechProfile`, `TheirWordsSwitch`, `JobStatus`, `Dialog*`, `Textarea`, `NativeSelect`, `Switch`. Test: `VoiceCloneDialog.test.tsx` (319).
- `SpeechProfile.tsx` (80) — profile stats/phrases + "Profile how they talk" button. Props `{player, profile, job}`. Uses `api.buildProfile`, `campaignActions.startJob`. Renders `JobStatus`, `Badge`. No test.
- `ReadAloud.tsx` (105) — read a written-up session in a cloned voice. Props `{sessionId, page}`. Uses `useClones`, `useStore.players`, `useCampaign` (latestJob kind "read"), `useIdle`, `api.cloneRead`. Renders `TheirWordsSwitch`, `JobStatus`, `NativeSelect`. Covered by `WriteUpButton.test.tsx`.
- `TheirWordsSwitch.tsx` (25) — "In their words" switch. Props `{profiled, checked, onChange, missing}`.

### `components/campaign/`
- `CampaignView.tsx` (118) — Campaign tab: header (vault path, Obsidian link, `JobChip`s, `CloudBackupButton`, Import), aside (`SuggestionsCard`, `GlossaryList`, `CampaignFacts`), main (`EntityEditor` or hint), `ImportDialog`. Uses `useCampaign` (campaign, loadError, selected, jobs, dismissed), `campaignActions.refresh/select`. Test: `CampaignView.test.tsx` (824; also covers GlossaryList/EntityEditor/SuggestionsCard/ImportDialog).
- `GlossaryList.tsx` (212) — search, filter chips, entry list; exports `NewEntryForm` (reused by `SuggestionsCard`). Props `{entities, types}`. Uses `useCampaign.selected`, `campaignActions.select/putEntity`, `attempt`, `api.createEntity`, `needsReview/matchesSearch`.
- `EntityEditor.tsx` (415) — entry editor: name, type, description, aliases/heard-as `ChipEditor`s with suggested spellings, suggested facts (`SuggestedFact`), facts (`FactList` + `LookForFacts`), `EntityFooter` (merge via `EntityPicker`, delete confirm). Props `{entity}`. Uses `mutateEntity/deleteEntity/mergeEntity`, `attempt`, `campaignActions`, `api.updateEntity/reviewEntity/addEntityFact/seekFacts`. Renders `ObsidianLink`, `ChipEditor`, `EntityPicker`, `FactList`, `FactText`.
- `ChipEditor.tsx` (67) — string chip list add/remove. Props `{label, values, onAdd, onRemove, placeholder, pending?}`.
- `FactList.tsx` (106) — facts with inline edit/delete/add. Props `{facts,onEdit,onDelete,onAdd,addPlaceholder,addLabel?,empty}`. Renders `FactText`.
- `FactText.tsx` (36) — text with `[[wiki links]]`; entity links call `campaignActions.select`. Uses `useCampaign.entities`, `splitWikiLinks/findEntity`.
- `CampaignFacts.tsx` (28) — campaign-wide facts card. Props `{facts}`. Uses `mutateCampaignFacts`, `api.setCampaignFacts/addCampaignFact`.
- `EntityPicker.tsx` (81) — Popover+cmdk combobox (aliases/heard-as keywords). Props `{entities,value,onChange,exclude?,label,className?}`.
- `SuggestionsCard.tsx` (295) — spelling suggestions (misheard/unknown), ignore/undo toasts, ignored words. Local `IconAction`, `IgnoredWords`, `UnknownName`. Uses `useCampaign` (suggestions, entities, ignored, hidden), `campaignActions.refreshSuggestions`, `ignoreWord/unignoreWord/rejectMisheard/unrejectMisheard/mutateEntity`, `api.reviewEntity/updateEntity`. Renders `EntityPicker`, `NewEntryForm`, `Collapsible*`, `Tooltip*`.
- `ImportDialog.tsx` (146) — paste notes → import job; progress, result chips. Props `{open,onOpenChange}`. Uses `api.importNotes`, `attempt`, `campaignActions.putJob/select`, `useCampaign.jobs`. Renders `JobBar`.
- `JobProgress.tsx` (236) — exports `JobChip`, `JobBar`, `JobStatus`, `JobSteps`, `JobMarquee`. Uses `campaignActions.dismissJob`, `jobActive/jobCount`, `Progress`. No own test (via WriteUpButton/CampaignView tests).
- `WriteUpButton.tsx` (50) — "Write up for campaign" job button + steps + Obsidian link + `ReadAloud`. Props `{sessionId}`. Uses `useCampaign` (campaign, jobs), `campaignActions.refresh/startJob`, `api.writeUp`. Test: `WriteUpButton.test.tsx` (333).
- `ObsidianLink.tsx` (42) — `obsidian://` link or explanatory span. Props `{relPath?, children, className?}`. Uses `useCampaign.campaign`, `obsidianUrl`.
- `CloudBackupButton.tsx` (253) — header Popover: backup status, option switches, Back up now, local `Restore`. Exports `running(kind)` selector (also used by `AccountMenu`). Uses `useCloud/cloudActions`, `useCampaign`, `useStore.campaign`, `ago/when`. Test: `CloudBackupButton.test.tsx` (250).
- `AskPanel.tsx` (185) — exports `AskView` (refresh + `AskPanel`) and `AskPanel` (question list left; form + `AnswerCard` + `SourceRow`s right). Uses `useCampaign.answers`, `attempt`, `campaignActions.putAnswer/select/refresh`, `api.ask`, `openSessionById` (lib/route). Renders `FactText`, `ObsidianLink`, `Alert`. Test: `AskPanel.test.tsx` (131).

### `components/audio/`
- `LevelMeter.tsx` (101) — `LevelMeter` (subscribes to level pub/sub per `source`, rAF-throttled) and pure `MeterView`. Uses `lib/audio`. Test: `LevelMeter.test.tsx` (120).
- `LiveQualityBox.tsx` (80) — live mic meter + `QualityRows` with hide/show monitor. Uses `useStore.session.audio_monitor`, `useAudio.quality.session`, `api.setAudioMonitor`. Test: `LiveQualityBox.test.tsx` (95).
- `MicTest.tsx` (93) — Setup mic test start/stop, countdown, meter, quality. Props `{device}`. Uses `useAudio`, `attempt`, `api.startMicTest/stopMicTest`. Test: `MicSetup.test.tsx` (122, covers MicTest + MicDetails).
- `MicDetails.tsx` (205) — selected mic specs/checks/advice + local `SpecsForm`. Props `{device}`. Uses `api.mics/updateMic`, `attempt`.
- `QualityRows.tsx` (36) — 5 graded quality rows + hints. Props `{quality, hints?}`. Uses `QUALITY_ROWS/GRADE_DOT`.
- `RecordingQualityPanel.tsx` (183) — saved-recording quality: verdict banner, `QualityRows`, SVG `Timeline`, `SpeakerLevels`. Props `{sessionId}`. Uses `api.sessionQuality`. Test: `RecordingQualityPanel.test.tsx` (117).
- `qualityVerdict.ts` (32) — `VERDICT` display map.

---
## 3. `components/ui/` (shadcn base-nova on `@base-ui/react`), 19 files
`alert.tsx` (61: Alert, AlertTitle, AlertDescription, AlertAction), `badge.tsx` (48), `button.tsx` (55: Button, buttonVariants), `card.tsx` (78), `collapsible.tsx` (17), `command.tsx` (157, cmdk), `dialog.tsx` (134), `input-group.tsx` (137; no importer seen), `input.tsx` (19), `label.tsx` (17), `native-select.tsx` (20), `popover.tsx` (51: Popover, Trigger, Content, Title), `progress.tsx` (63), `select.tsx` (183), `sheet.tsx` (116; no importer seen), `sonner.tsx` (34), `switch.tsx` (31), `textarea.tsx` (17), `tooltip.tsx` (51).
`components.json`: style `base-nova`, rsc false, baseColor neutral, cssVariables, no prefix, icons lucide, aliases `@/components`, `@/lib/utils`, `@/components/ui`, `@/lib`, `@/hooks` (no `hooks/` dir).

---
## 4. `src/lib`

### `api.ts` (264) — all HTTP via `req<T>(method,path,body)` (JSON; non-OK → `ApiError(detail)`; 204/202 → undefined). Exports: `ApiError`, `PlayerPatch`, `TranscriptFormat`, `transcriptUrl(format, sessionId?)`, `sessionAudioUrl(id)`, `EntityPatch`, `EntityCreate`, `EntityReview`, `api`.
Endpoints (`api.<fn>` → METHOD path):
- sessions: `sessions` GET /api/sessions; `mergeSessions` POST /api/sessions/merge; `sessionRecord` GET /api/sessions/{id}/transcript.json; `estimateInCharacter` POST /api/sessions/{id}/in-character; `improveSession` POST …/improve; `retranscribeSession` POST …/retranscribe; `fixSpellings` POST …/spelling; `restoreSession` POST …/restore; `sessionQuality` GET …/quality
- sources/mics/audio: `sources` GET /api/sources; `mics` GET /api/mics; `updateMic` PATCH /api/mics/{name}; `startMicTest` POST /api/mic/test; `stopMicTest` POST /api/mic/test/stop; `setAudioMonitor` PUT /api/audio/monitor
- players: `createPlayer` POST /api/players; `updatePlayer` PATCH /api/players/{id}; `deletePlayer` DELETE /api/players/{id}; `seatPlayer` POST …/seat; `benchPlayer` POST …/bench; `trainPlayer` POST …/train; `cancelTraining` POST /api/train/cancel
- campaigns: `createCampaign` POST /api/campaigns; `renameCampaign` PATCH /api/campaigns/{id}; `openCampaign` POST /api/campaigns/{id}/open
- clones: `clones` GET /api/clones; `buildClone` POST /api/players/{id}/clone; `buildProfile` POST …/profile; `cloneSay` POST …/clone/say; `cloneRead` POST …/clone/read; `deleteClip` DELETE /api/clones/{id}/clips/{clip}
- voices/messages: `assignVoice` POST /api/voices/{id}/assign; `unassignVoice` POST …/unassign; `assignMessage` POST /api/messages/{id}/speaker
- live session: `startSession` POST /api/session/start; `pauseSession` POST …/pause; `resumeSession` POST …/resume; `stopSession` POST …/stop; `recheckLlm` POST /api/llm/recheck
- models/LLM: `modelSettings` GET /api/settings/models; `saveModelSettings` PUT /api/settings/models; `localServers` GET /api/llm/local/servers; `scanLocalModels` POST /api/llm/local/models; `llmModels` GET /api/llm/models?provider=; `llmConnect` POST /api/llm/{provider}/connect; `llmKey` PUT /api/llm/{provider}/key; `llmDisconnect` POST /api/llm/{provider}/disconnect
- campaign memory: `campaign` GET /api/campaign; `campaignSuggestions` GET /api/campaign/suggestions; `createEntity` POST /api/campaign/entities; `updateEntity` PATCH /api/campaign/entities/{name}; `deleteEntity` DELETE same; `reviewEntity` POST …/review; `mergeEntity` POST …/merge; `addEntityFact` POST …/facts; `seekFacts` POST …/facts/search; `ignoreWords` POST /api/campaign/ignore; `unignoreWord` DELETE /api/campaign/ignore/{word}; `addCampaignFact` POST /api/campaign/facts; `setCampaignFacts` PUT /api/campaign/facts; `importNotes` POST /api/campaign/import; `ask` POST /api/campaign/ask; `writeUp` POST /api/campaign/writeup/{sessionId}
- cloud: `cloud` GET /api/cloud; `cloudConnect` POST /api/cloud/connect; `cloudDisconnect` POST /api/cloud/disconnect; `cloudOptions` PUT /api/cloud/options; `cloudBackup` POST /api/cloud/backup; `cloudVaults` GET /api/cloud/vaults; `cloudAccount` GET /api/cloud/account; `cloudRestore` POST /api/cloud/restore
- URL-only (no `req`): `transcriptUrl` → /api/transcript.{md|json} or /api/sessions/{id}/transcript.{fmt}; `sessionAudioUrl` → /api/sessions/{id}/audio.wav; `SessionAudio.tsx` uses `/api/files/{name}`; server-supplied `voice.sample_url`, `voice.preview_url`, `clip.url`, `SourceList.files[].audio_url`.
- Quirk: orphaned doc comments stacked above `estimateInCharacter` and above `localServers` (comments for functions that moved/vanished).

### WebSocket (`store.ts`)
`connect()` (idempotent; `App` effect): `ws(s)://<host>/ws`; onopen → `connected:true`, delay reset to 500 ms; onclose → `connected:false`, reconnect, delay doubles capped at 5000 ms; onmessage → `JSON.parse` → `applyEvent` (errors → console.error). Vite dev proxies `/api` and `/ws` to 127.0.0.1:8765.
`applyEvent(ev: ServerEvent)` (exported for tests) handles `ev.type`:
- in `store.ts`: `snapshot` (→ `applySnapshot`: replace session/campaign/campaigns/players/library/voices/messages, clear bumps, on campaign switch clear `viewing` + `campaignActions.campaignChanged()`, first load picks setup/session view), `session.updated`, `player.upserted`, `player.removed`, `library.updated`, `campaigns.updated`, `voice.upserted`, `voice.removed`, `speaker.active` (→ `useSpeaking`, auto-clear 1.5 s), `message.created` (ordered insert, binary search, id→index cache), `messages.updated` (batch patch + `bumps`), `train.status`, `error` (→ `toast.error`)
- delegated: `audio.level`/`audio.quality`/`mic.test` → `applyAudioEvent` (lib/audio.ts); `campaign.job`/`campaign.answer`/`campaign.updated` → `applyCampaignEvent` (campaignStore.ts; `campaign.updated` = 300 ms debounced refetch of loaded campaign/suggestions); `cloud.updated` → `applyCloudEvent` (cloudStore.ts); `llm.updated` → `applyLlmEvent` (llmStore.ts)
(22 variants, all in `ServerEvent` union in `types.ts`.)

### Files (exports / purpose)
- `types.ts` (529) — API contract mirroring `backend/src/troubadour/server.py`. Exports Player, LibraryPlayer, CampaignInfo, Campaigns, Voice, Message, Fix, Source, Session, SavedSession, ImprovedInfo, RetranscribedInfo, InCharacterInfo, SpellingInfo, MessagePatch, Snapshot, SourceList, **ServerEvent**, CloudBackup/CloudStatus/CloudAccount/CloudVault, EntityType, Entity, AnswerSource, CampaignAnswer, CampaignJob, JobSnippet, JobStep, JobLive, CloneVoice, CloneClip, SpeechProfile, Clones, ObsidianVault, Campaign, LlmProviderId, LlmProvider, ModelSettings, LlmModel, CampaignSuggestions, TrainStatus, RecordPlayer, RecordMessage, SessionRecord, AudioSource, LevelZone, AudioLevel, Grade, QualityGrades, QualityNumbers, AudioQuality, QualityVerdict, RecordingQuality, MicPattern, MicCapsule, MicSpecs, MicCheck, MicInfo, MicSpecsPatch.
- `store.ts` (285), `campaignStore.ts` (328) — §5.
- `route.ts` (131) — §1.
- `audio.ts` (154) — `METER_MIN_DB`, `zoneOf`, `SEGMENTS`, `litSegments`, `meterPosition`, `ZONE_LABEL`, `ZONE_SEGMENT_CLASS`, `ZONE_TEXT_CLASS`, `GRADE_DOT`, `QUALITY_ROWS`, level pub/sub (`publishLevel`, `subscribeLevel`, `currentLevel`), zustand `useAudio` {quality, micTest}, `applyAudioEvent`, `resetAudio` (test seam). No test.
- `cloneStore.ts` (32) — `useClones`, `refreshClones()`; subscribes to `useCampaign` to refetch when a clone/say/read/profile job ends.
- `cloudStore.ts` (70) — `useCloud` {status, account}, `cloudActions` (refresh, loadAccount, connect, disconnect, setOptions, backup, vaults, restore), `applyCloudEvent`.
- `llmStore.ts` (24) — `useLlmProviders` {providers, modelsOpen}, `setModelsOpen`, `setLlmProviders`, `applyLlmEvent`.
- `campaign.ts` (96) — `TYPE_LABEL`, `TYPE_PLURAL`, `ENTITY_TYPES`, `needsReview`, `matchesSearch`, `findEntity`, `obsidianUrl`, `FactSegment`, `splitWikiLinks`, `latestJob`, `jobActive`, `jobCount`. Test `campaign.test.ts` (73).
- `record.ts` (127) — `PLAYER_PALETTE`, `ViewerPlayer`, `ViewerLine`, `LoadedRecord`, `loadRecord`. Test `record.test.ts` (87).
- `speaker.ts` (33) — `Speaker`, `speakerFor`, `speakerKey`. Test `speaker.test.ts` (50).
- `talkTime.ts` (83) — `TalkTime`, `talkTime`, `recordTalkTime`, `sharePct`, `talkDuration`. Test `talkTime.test.ts` (123).
- `fixes.ts` (29) — `Part`, `splitFixes`. Test `fixes.test.ts` (41).
- `format.ts` (37) — `mmss`, `hms`, `dateTime`, `initials`, `fileToAvatar`. Test `format.test.ts` (34, `hms` only).
- `time.ts` (13) — `ago(epochS, nowMs)`, `when(epochS)`. Test `time.test.ts` (20).
- `source.ts` (30) — `sessionIdStartedAt`, `sourceLabel`. Test `source.test.ts` (37).
- `useSavedSessions.ts` (38) — hook: `api.sessions()`, refetch on live session end / campaign switch; returns `{sessions,error,reload}`.
- `useSessionTime.ts` (23) — `sessionTimeNow()`, `useSessionTime(intervalMs=500)`.
- `utils.ts` (6) — `cn` (clsx + tailwind-merge).
- Other lib tests: `store.test.ts` (155), `campaignStore.test.ts` (32), `route.test.ts` (125).

---
## 5. State

### `lib/store.ts` — zustand v5, two stores
**`useStore`** keys: `connected`, `loaded`, `view`, `session`, `sessionAt` (performance.now at receipt), `campaign` (open campaign id), `campaigns`, `players`, `library`, `voices`, `messages`, `bumps` (id→update counter), `train` (playerId→TrainStatus), `sources`, `focus` ({voiceId,n}|null), `viewing` (SavedSession|null; navigation only).
`actions`: `setView`, `openSavedSession`, `closeSavedSession`, `openHistory`, `upsertPlayer`, `seated`, `dropFromLibrary`, `removePlayer`, `upsertVoice`, `clearTrain`, `setSources`, `focusVoice`. Hook `useIdle()`. Private: `indexFor/reindexed` (id→index cache), `addMessage`, `inServerOrder`.
**`useSpeaking`** `{voiceId}` — separate store so ~4 Hz updates skip the chat.
Other exports: `View`, `applyEvent`, `connect`.
Rule (AGENTS.md): live store holds only the live session; WS events must not leak into History/Campaign state.

### `lib/campaignStore.ts` — zustand `useCampaign`
Keys: `campaign`, `loadError`, `suggestions`, `hidden` (dismissed suggestion keys), `jobs` (id→CampaignJob), `dismissed` (failed jobs hidden), `answers` (id→CampaignAnswer), `selected` (entry name).
`campaignActions`: `refresh` (queued), `refreshSuggestions`, `select`, `putEntity`, `removeEntity`, `setIgnored`, `setFacts`, `putJob`, `startJob`, `dismissJob`, `putAnswer`, `campaignChanged`.
Write queue: `serialize()` promise chain + `renamed` map; exports `mutateEntity`, `deleteEntity`, `mergeEntity`, `mutateCampaignFacts`; optimistic `ignoreWord`, `unignoreWord`, `rejectMisheard`, `unrejectMisheard`, `suggestionKey`; `attempt()` (toast on failure; message containing "Models" adds "Open Models" action); `applyCampaignEvent`; `REFETCH_DEBOUNCE_MS=300`.
Other zustand stores: `useAudio` (audio.ts), `useClones` (cloneStore), `useCloud` (cloudStore), `useLlmProviders` (llmStore). Component-local state: SessionViewer record (`LoadState`), `useSavedSessions`, dialogs.
Cross-store coupling: `store.applySnapshot → campaignActions.campaignChanged`; `cloneStore` subscribes `useCampaign`; `route.ts` subscribes both; `campaignStore → llmStore.setModelsOpen`; `cloudStore → campaignStore.putJob`; `useSavedSessions`/`useSessionTime` read `useStore`.

---
## 6. Styling

`src/index.css`: imports `tailwindcss`, `tw-animate-css`, `shadcn/tailwind.css`, `@fontsource-variable/geist`; `@custom-variant dark (&:is(.dark *))`; `@theme inline` maps tokens → `--color-*` (background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring, chart-1..5, sidebar-*), `--font-sans` "Geist Variable", radii `--radius-sm..4xl` from `--radius: 0.625rem`. `:root` neutral oklch light palette; `.dark` palette (no component sets `.dark`; many components use dark-leaning colors e.g. `text-emerald-200`, `text-amber-200`, `bg-red-500/10`). `@layer base`: `* {border-border outline-ring/50}`, body bg/text, html font-sans.
Custom CSS: `@keyframes flash` + `@utility animate-flash` (1.4 s; TranscriptRow bump, VoicesPanel focus); `@keyframes speak-pulse` + `.speaker-box` (+ `[data-speaking="true"]`, `--player` var; PlayerBox, PlayerGrid); `@keyframes clip-flash` + `@utility animate-clip-flash` (LevelMeter clip).
Inline styles: player color (`backgroundColor`, `--player`); HistoryView merge-bar width; LevelMeter peak left; Timeline SVG.

Repeated className patterns (2+):
1. Raw control `h-8 w-full rounded-lg border bg-background px-2` — 6× in `ModelsDialog.tsx` (model-server input, API key, provider key input, `Field` select, `ModelPicker` input + select) instead of `ui/input` / `ui/native-select`.
2. Card section `rounded-xl border bg-card p-3` — `CampaignFacts.tsx`, `SuggestionsCard.tsx`; `p-4` in `AskPanel.tsx` AnswerCard; `PlayerBox.tsx` `rounded-xl border bg-card px-3 py-2`.
3. Destructive box `rounded-md bg-destructive/15 p-3 text-sm text-destructive` — `TrainDialog.tsx` (2×), `ImportDialog.tsx` (with `flex items-start gap-2`).
4. Chip `inline-flex h-6 items-center gap-0.5 rounded-md … pr-0.5 pl-2 text-xs` — `ChipEditor.tsx`, `EntityEditor.tsx` (suggested spelling), `SuggestionsCard.tsx` (ignored words). Pill toggles `rounded-full px-… bg-primary text-primary-foreground | bg-muted text-muted-foreground hover:text-foreground` — `GlossaryList.chip()`, `MicDetails.tsx` pattern buttons.
5. Selected-row toggle `cn("…rounded-lg px-2 py-1.5 text-left text-sm", on ? "bg-muted font-medium" : "hover:bg-muted/60")` — `HistoryView.tsx` live-session button, `AskPanel.tsx`, `GlossaryList.tsx`, `SessionViewer.RailTabButton`, `App.tsx` tabs (`bg-background shadow-sm`).
6. Status dot `size-2 rounded-full bg-emerald-500 | bg-red-500 | animate-pulse bg-amber-500` — `App.tsx` (connection, AI), `SessionHeader.tsx`, `audio.ts GRADE_DOT`, `qualityVerdict.ts`; `size-1.5 rounded-full bg-emerald-500` in `App.tsx` and `HistoryView.tsx`.
7. Spinner `<Loader2 className="size-4 animate-spin" />` + muted text — `ModelsDialog`, `CampaignView`, `JobProgress` (3×), `SessionViewer`, `RecordingQualityPanel`, `TrainDialog`, `AskPanel`; `className="animate-spin"` in button labels across ~10 files.
8. Header bar `flex flex-wrap items-center gap-… border-b px-4 py-2` — `CampaignView.tsx`, `SessionHeader.tsx`, `SessionViewer.tsx`, `App.tsx` (py-2.5).
9. Side rail `w-80 shrink-0 … border-r` — `HistoryView.tsx`, `AskPanel.tsx`, `CampaignView.tsx`; `lg:w-80 lg:border-t-0 lg:border-l` — `SessionView.tsx` (2×), `SessionViewer.tsx`; collapsed strip `flex w-full shrink-0 justify-center border-t py-2 lg:w-12 lg:flex-col lg:border-t-0 lg:border-l` in `SessionView.tsx` and `SessionViewer.tsx`.
10. Helper text `text-xs text-muted-foreground` (60+ uses); time/number `font-mono … tabular-nums`.
11. Field label `<Label className="text-xs text-muted-foreground">` in `space-y-1` — `PlayerCard.tsx`, `EntityEditor.tsx`; raw `<label className="text-xs …">` in `ModelsDialog.tsx`.
12. `<a className={buttonVariants({variant, size})}>` link-buttons — `ExportLinks`, `SavedSessionRow` (`linkClass`), `SessionViewer` (`downloadClass`), `CloudBackupButton`, `AccountMenu`, `ObsidianLink`.

---
## 7. Tests

- Runner: vitest 5; `vitest.config.ts` = `mergeConfig(viteConfig, {test:{environment:"jsdom", setupFiles:["./src/test/setup.ts"]}})` (inherits `@` alias, react + tailwind plugins). Testing Library + jest-dom.
- `src/test/setup.ts` (14): jest-dom matchers, `afterEach(cleanup)`, stubs `Element.prototype.scrollIntoView`, `scrollTo`, `ResizeObserver`. No global WebSocket/fetch stubs; no sonner reset (AGENTS.md says tests must clear toasts themselves).
- `src/test/mockFetch.ts` (40): `mockFetch(handler)` → `vi.spyOn(globalThis,"fetch")`; handler gets `{method,url,body(parsed JSON)}`; returns JSON (200) / `Response` as-is / `undefined` (204); returns `{calls, writes(), spy}`. Also `bodyOf<T>(call)`, `httpError(status, detail)`, type `FetchCall`.
- `src/test/fixtures.ts` (200): `player`, `snapshotBase`, `voice`, `message`, `session`, `savedSession`, `recordMessage`, `sessionRecord`, `entity`, `campaignJob`, `campaign`, `audioQuality`, `mic`.
- WebSocket is never instantiated in tests. Store tests call `applyEvent({type,data})` directly (after `useStore.setState(initial, true)`); component tests push events via `applyEvent` inside `act` (`WriteUpButton.test.tsx`, `ModelsDialog.test.tsx`) or `useStore.setState`. `App.test.tsx` mocks `@/lib/route` (`startRouting`) and `@/lib/store` (`connect` no-op, rest original). API mocked per-test with `mockFetch`.
- Other: `ChatFeed.test.tsx` replaces `react-virtuoso` Virtuoso with a plain-list wrapper; `vi.useFakeTimers()` in `StartPanel.test.tsx`, `WriteUpButton.test.tsx`; `resetAudio()` in audio tests.
- Test files (35): App.test; AccountMenu, CampaignSwitcher, ModelsDialog; transcript/FixedText; setup/{LibraryList,StartPanel}; session/{ChatFeed,ExportLinks,LineSpeakerPicker,PlayerGrid,SessionHeader,VoicesPanel}; history/{HistoryView,SessionViewer,TranscriptTools}; clone/VoiceCloneDialog; campaign/{AskPanel,CampaignView,CloudBackupButton,WriteUpButton}; audio/{LevelMeter,LiveQualityBox,MicSetup,RecordingQualityPanel}; lib/{campaign,campaignStore,fixes,format,record,route,source,speaker,store,talkTime,time}.
- Components with no test file: PlayerAvatar, DprcalcMark, ErrorBoundary, TranscriptRow, PlayerBox, SetupView, PlayerCard, TrainDialog, SessionView, SessionAudio, SamplePlayer, SavedSessionRow (partial), SpeechProfile, ReadAloud (indirect), TheirWordsSwitch, JobProgress, ImportDialog/GlossaryList/EntityEditor/etc. (indirect via CampaignView.test), MicDetails/MicTest (MicSetup.test), QualityRows. Lib without test: audio, cloneStore, cloudStore, llmStore, useSavedSessions, useSessionTime, utils, api.

---
## 8. Package / build config

`package.json`: name `web`, private, type module, `packageManager pnpm@11.5.2`.
Scripts: `dev` vite; `build` `tsc -b && vite build`; `preview` vite preview; `typecheck` `tsc -b --noEmit`; `lint` oxlint; `test` `vitest run`; `test:watch` vitest; `format` `prettier --write .`; `format:check` `prettier --check .`.
Dependencies: `@base-ui/react ^1.8.0`, `@fontsource-variable/geist ^5.3.0`, `@tailwindcss/vite ^4.3.3`, `class-variance-authority ^0.7.1`, `clsx ^2.1.1`, `cmdk ^1.1.1`, `lucide-react ^1.52.0`, `react ^19.2.8`, `react-dom ^19.2.8`, `react-virtuoso ^4.18.16`, `shadcn ^4.21.4`, `sonner ^2.0.8`, `tailwind-merge ^3.7.0`, `tailwindcss ^4.3.3`, `tw-animate-css ^1.4.0`, `zustand ^5.0.15`.
devDependencies: `@testing-library/jest-dom ^7.0.1`, `@testing-library/react ^16.3.3`, `@types/node ^24.19.1`, `@types/react ^19.2.18`, `@types/react-dom ^19.2.7`, `@vitejs/plugin-react ^6.1.1`, `jsdom ^30.1.2`, `oxlint ^1.81.0`, `prettier ^3.9.9`, `prettier-plugin-tailwindcss ^0.8.1`, `typescript ~6.0.2`, `vite ^8.3.0`, `vitest ^5.0.3`.
`tailwindcss`, `@tailwindcss/vite`, `shadcn` sit in `dependencies`.
`vite.config.ts`: plugins react + tailwind; alias `@` → `src`; `build.chunkSizeWarningLimit 800`; proxy `/api` → http://127.0.0.1:8765, `/ws` → ws://127.0.0.1:8765. Build → `dist/` served by backend.
Other: `tsconfig.json/.app/.node`, `.oxlintrc.json`, `.prettierrc.json`, `.prettierignore`, `CLAUDE.md`, `index.html`, `public/{favicon.svg,icons.svg}`, `pnpm-lock.yaml`.
Acceptance (AGENTS.md): `pnpm typecheck && pnpm test && pnpm lint && pnpm exec prettier --check src && pnpm build`.

---
## 9. Duplicated logic (2+ files)

1. **try/catch → `toast.error((e as Error).message)`** hand-written in ≥12 components (CampaignSwitcher ×2, LiveQualityBox, HistoryView ×2, LineSpeakerPicker, SessionHeader ×3, VoicesPanel ×2, LibraryList ×2, PlayerCard ×2, SetupView, StartPanel) while `campaignStore.attempt()`, private `cloudStore.run()`, and `ModelsDialog.ProviderPanel.run` do the same.
2. **busy flag + try/finally** (`setBusy(true) … finally setBusy(false)`): SessionHeader ×3, LiveQualityBox, LineSpeakerPicker, SetupView, StartPanel, CampaignNameDialog, HistoryView.
3. **Open sign-in in new tab** (`window.open("about:blank")`, null `opener`, set href after await, close on error): `lib/cloudStore.ts` `connect` and `components/ModelsDialog.tsx` `ProviderPanel.signIn`.
4. **Date/time/duration formatters**: `format.dateTime` ≡ `time.when` (identical `toLocaleString`); three duration formatters with the same floor/pad logic: `format.mmss`/`hms`, `talkTime.talkDuration`, `JobProgress.elapsed`.
5. **Transcript download links** (md/json/audio): `ExportLinks.tsx` (live), `SavedSessionRow.SessionDownloads`, `SessionViewer.tsx` transcript tab loop + audio link; `linkClass` vs `downloadClass` both `buttonVariants(...)`.
6. **Job UIs/start sequence**: `JobProgress` (`JobChip/JobBar/JobStatus/JobSteps`) vs hand-written spinner+`jobCount`+error spans in `TranscriptTools`, `EntityEditor.LookForFacts`, `WriteUpButton`, `ReadAloud`, `VoiceCloneDialog`, `SpeechProfile`; bespoke `role="progressbar"` in `HistoryView` vs `ui/progress` in `JobProgress`/`TrainDialog`. "`attempt(() => api.x)` → `putJob`" is `campaignActions.startJob` but re-implemented in `TranscriptTools.start`, `EntityEditor.LookForFacts`, `ImportDialog.submit`, `cloudStore.backup/restore`.
7. **Latest job lookup**: `latestJob()` (lib/campaign.ts) vs inline `Object.values(jobs).filter(...).at(-1)` in `TranscriptTools.tsx` and `EntityEditor.LookForFacts`.
8. **Job kind → label/metadata** maps in three places: `JobChip` nested ternary, `TOOLS` in `TranscriptTools`, `CLONE_JOBS` in `cloneStore.ts`.
9. **Dialog scaffolding** (Dialog/Content/Header/Title/Description/Footer + Cancel/primary + inline error box): `CampaignSwitcher`, `ImportDialog`, `TrainDialog`, `VoiceCloneDialog`, `ModelsDialog`, `StartPanel` warning, `TranscriptTools` report. Inline Confirm/Cancel blocks: `TranscriptTools` ×2, `EntityEditor.EntityFooter` ×2, `LibraryList.LibraryChip`.
10. **Speaker identity**: `speakerFor`+`speakerKey` pair duplicated for current and previous message in `ChatFeed.itemContent`; `record.ts` computes `speakerKey` separately for saved lines.
11. **Players header block** (`PlayerBox` list + `UnnamedShareChip` + talk-time) in `PlayerGrid.tsx` and `SessionViewer.RecordBody`.
12. **Rail layout** (expanded aside / collapsed icon strip with `lg:w-80`/`lg:w-12`) in `SessionView.tsx` and `SessionViewer.tsx`; sidebar+main layout in `HistoryView`, `AskPanel`, `CampaignView`.
13. **Fetch-on-mount with `alive`/`gone` flag + loading/error/ready state**: `useSavedSessions`, `SessionViewer`, `RecordingQualityPanel` (same `{status:"loading"|"error"|"ready"}` shape), `MicDetails`, `ModelsDialog`.
14. **Hand-rolled controls where no ui primitive exists/used**: raw `<input>/<select>` in `ModelsDialog`; raw checkbox/color input in `SavedSessionRow`/`PlayerCard`; hand-rolled tabs/pills in `App.tsx`, `SessionViewer.RailTabButton`, `GlossaryList.chip`, `StartPanel` source toggle (no `tabs`/`toggle-group` primitive in ui/).
15. **Status→class maps** re-declaring dot colours: `ASR_STATUS` (SessionHeader), `VERDICT` (qualityVerdict), `ZONE_*`/`GRADE_DOT` (audio.ts), `PROGRESS` (AskPanel).
16. **API URLs outside `api.ts`**: `/api/files/…` in `SessionAudio.tsx`; server-supplied media URLs used raw in `VoicesPanel`/`SamplePlayer`/`VoiceCloneDialog`/`ReadAloud`.
17. **Doc/code drift**: AGENTS.md map (tabs, `Sheet` editor, `hooks` alias) ≠ code; `ui/sheet.tsx`, `ui/input-group.tsx` appear unreferenced; `api.ts` has orphaned comment blocks.
