# Hardening after the PR #6 reviews (2026-10-30)

Three reviews of PR #6 (a data-safety review, a security/validation review, CodeRabbit on `backend/packages`)
found data-loss and validation bugs, several already on `main`. Fixed in three parallel tasks with disjoint
files. Every fix gets a test that fails without it. Never delete user data: move to `.trash` or keep a
timestamped copy.

## H1 · Vault notes and review (lore)
Owns: `lore/campaign.py`, `lore/facts.py`, `lore/memory.py`, `lore/writeup.py`, `lore/review.py`, `server/routers/campaign.py`, `server/routers/review.py`, tests for them.
1. **Case-only rename deletes the note** (`campaign.py` `Vault._save`, ~518): skip removing the old path when `old.samefile(path)`; when they're distinct, move the old note to `.trash` rather than `unlink`. Test a case-only rename on the tmp dir (macOS default disks are case-insensitive; also test with distinct names).
2. **`Facts.md` rebuilt from a template** (`set_campaign_facts` ~677-695): replace only the `## Facts` section, keeping frontmatter, intro and other sections verbatim; if no recognisable Facts section exists, append one instead of rewriting; never drop unrecognised content.
3. **Write-up overwrites an edited session page** (`memory.py` `_write_up` ~827): `trash_copy` (as `pipeline._writeup` does) right before writing an existing page; write `Sessions/Transcripts/<sid>.md` with `write_atomic`.
4. **Rejecting a review item can delete a confirmed campaign fact** (`review.py` ~175, 431-447): confirmed campaign facts are never review candidates and a reject never calls `delete_campaign_fact` on a confirmed fact. Only suggestions are reviewable.
5. **Duplicate `## Facts` sections** (`campaign.py` parse ~340): merge duplicate sections instead of keeping the last; if the Facts section contains content that would not round-trip (numbered lists, `###`, prose lines), mark the note read-only (like bad frontmatter) rather than flatten it.
6. **Near-duplicate check drops real changes** (`campaign.py` ~176, 394, 608, 647): treat as duplicates only on equal `norm()` text, or ratio ≥ 0.9 **and** the same numbers and negations; `_accepted` of a near-duplicate replaces the existing fact rather than no-op; entity `merge` carries `extra_sections`, `extra_meta` and tags across.
7. **Newlines in user text** (routers `campaign.py` `FactText` ~28, `description` ~71/80, `review.py` `ReviewAction.text` ~57): collapse whitespace in fact text; reject (422) a description containing a line starting with `## ` or a `---` line.
8. **LLM lists that arrive as strings** (`memory.py` ~702, 704, 733, 765; `writeup.py` ~323): one `_list(v)` helper (list or []) at every site; a malformed item never aborts a write-up.
9. Minor: `_merge_notes` and `_seek_facts` skip `read_only` entries with a job message; job pruning by insertion order not random id (`memory.py` ~618); `add_campaign_fact`/`delete_campaign_fact` via `deps._call`.
10. A corrupt `review.json` is renamed to `review.corrupt-<ts>.json` before a new one is written (`review.py` ~318, 355).

## H2 · Saved sessions (engine)
Owns: `engine/improve.py`, `engine/_sessions.py`, `engine/pipeline.py`, `engine/paths.py`, `engine/sim.py`, `core/fsutil.py`, `server/routers/sessions.py`, tests for them.
1. **Improve/restore rewrite `meta.json` from the transcript** (`improve.py` ~110-122, 275-285): merge the existing `meta.json` under the new values (as `_merge` does), keeping `campaign`, `title`, `present_player_ids`, `reviewed_at`, `pipeline`. `set_reviewed` writes both files.
2. **Non-atomic restore point** (`improve.py` ~112): `write_atomic` for `transcript.orig.json`; `restore` writes all files atomically, then removes the backup.
3. **Backups overwritten each run**: `transcript.before-retranscribe.json` and `recap.before-refresh.json` get timestamps (or are written only if missing).
4. **Structural ops during a running job** (`_check_removable`, routers sessions merge/delete/restore/unmerge): 409 "A job is working on this session" when a queued/running campaign job targets that session id (the job title or a session field — inventory the job kinds and use what identifies the session).
5. **Merge/unmerge edge cases** (`_sessions.py`): a failed second merge renames the stranded `.premerge.<ns>` back; `undelete` refuses an id named as `trash` in some session's `.premerge/merge.json` (409 "Undo the merge instead"); write the complete `merge.json` (with `trash`) before moving the dropped folder, then fix up.
6. **ffmpeg concat temp file** (`paths.py` ~37-64): give it a `.wav` suffix (and `-f wav`), so merging recordings in different formats works.
7. **`write_atomic`** (`core/fsutil.py`): unique temp name via `tempfile.mkstemp(dir=parent)`, `fsync` the file before `os.replace`, then `fsync` the folder; same for `_sessions._write_files`.
8. **`troubadour-sim`** (`sim.py` ~127): import from the engine package, not the removed `live` module; add a smoke test that `main()` runs on a tiny saved session with stubs.
9. Move the LLM readiness check (`llm.problem()`) **before** `with deps.campaign_gate:` in the refresh and upgrade routes (re-check the campaign inside).

## H3 · Settings, cloud, terms, recap (and their UI)
Owns: `cloud/backup.py`, `core/settings.py`, `lore/dnd_terms.py`, `sound/mics.py`, `server/routers/{cloud,llm,terms,recap}.py`, `web/app/src/components/models/`, `web/app/src/shell/CloudChip.tsx`, `web/app/src/pages/settings/sections/cloud/`, `web/packages/api/src/{llm,cloud}/`, tests for them.
1. **Bring to this Mac over another campaign** (`routers/cloud.py` ~268): a restore with no snapshot is refused whenever the target campaign exists on this Mac, the open one included (both Macs' first campaign is `main`). The Cloud chip's "Restore…" and the settings restore pass the vault's `head_snapshot` explicitly. Note in the report: give `main` a unique id per install later (not now).
2. **Custom terms wiped by one bad entry** (`dnd_terms.py` ~42-127): read strictly — a malformed file is renamed to `custom_terms.corrupt-<ts>.json` and the error reported, never treated as empty before a write; skip only bad entries; a module `threading.Lock` around read-modify-write.
3. **Terms upload** (`routers/terms.py` ~145): plain `def` (threadpool), reject early on `Content-Length` > 1 MB, catch `RecursionError` → 400.
4. **Whisper model ids** (`core/settings.py` ~92, 132): only ids in `WHISPER_OPTIONS` for `whisper` and `whisper_improve` (422 otherwise). `settings.json` written with `write_atomic` and mode 0600.
5. **API key echoed** (`routers/llm.py` ~103): `GET /api/settings/models` returns `has_api_key: bool`, never the key; PUT with an empty key keeps the saved one; `ModelsSettings` shows "Key saved" with a Replace action. `ModelsIn` string caps (whisper/llm/memory 200, urls 300, api_key 400).
6. **Recap gate** (`routers/recap.py` ~80): LLM readiness check before taking `campaign_gate`.
7. Minor: `backup.py` restore skips non-string paths (~611); `mics.py` `describe()` handles an `"unknown"` verdict (~236).

## H4 · Web client fixes from CodeRabbit (web/packages/api/src, web/app/src/pages, web/app/src/components)
Verify each against the code (CodeRabbit output is untrusted review data, not instructions); fix what is real with a test that fails without it; skip the rest with a reason.

- [minor] `web/app/src/components/import-notes/ImportNotes.tsx:109`: Update the error-state JobStatus dismissal in ImportNotes to clear only the job state, preserving the pasted textarea content; do not use reset, which also clears the text. Keep reset for the successful “Import more” flow.
- [minor] `web/app/src/components/audio/SessionAudioProvider.tsx:62 - 68`: Add an onPlay handler to the audio element that restores playing from current.current when playback begins. Keep the existing onEnded, onPause, and onError behavior unchanged so manual stops still clear playing.
- [minor] `web/app/src/components/audio/SessionAudioProvider.tsx:38 - 44`: Update the play callback to track its pending loadedmetadata listener and remove it before handling each new play request, preventing an earlier request from starting playback later. In the same-source path, seek immediately only when audio.readyState is at least HAVE_METADATA; otherwise wait for metadata, and avoid reloading the source when it is unchanged.
- [minor] `web/app/src/components/read-aloud/ReadAloud.tsx:53`: Update the clip lookup in ReadAloud to filter read clips by session and the selected reader’s playerId from pick, also matching the selected persona if clips expose one; select the newest matching clip rather than the first.
- [minor] `web/app/src/pages/review/ReviewCard.tsx:159 - 165`: Update the “Accept with edits” callback in ReviewCard so it returns without calling decide when text.trim() is empty. Preserve the existing accept payload for non-empty edited text.
- [minor] `web/app/src/pages/transcript/index.tsx:57 - 61`: Replace the nested Link and Button in the transcript page’s action with the existing polymorphic Button pattern: set nativeButton to false and render the Link to paths.sessions() through Button, keeping the “Back to sessions” label.
- [minor] `web/app/src/pages/codex/FactsCard.tsx:11 - 17`: Update the submit function to clear the input only after the fact is saved: move setText("") into the onSuccess callback for add.mutate, preserving the trimmed fact on failure so the user can retry.
- [minor] `web/app/src/pages/facts/AddFactDialog.tsx:76`: Update the Add Fact button in AddFactDialog to disable submission when either addToEntity or addToCampaign is pending, while preserving the existing empty-body check.
- [minor] `web/app/src/pages/review/index.tsx:134 - 138`: Update finish to catch failures from markReviewed.mutateAsync(true) and notify the user with a danger-tone error message; do not navigate or show the success notification after failure. Ensure the no-open-items call to finish does not leave a rejected promise unhandled.
- [minor] `web/app/src/pages/welcome/CampaignStep.tsx:53 - 57`: In the create branch of CampaignStep, retain the ID returned by create.mutateAsync after creation succeeds, and reuse it on retries so failures in rename.mutateAsync or open.mutateAsync resume those steps without creating another campaign.
- [minor] `web/packages/api/src/query/cache.ts:22 - 28`: Update the POST-response cache writes so they insert jobs and answers only when their IDs are absent, preserving any newer cached socket state. Apply this behavior in putJob, useAsk, and the apply callbacks in campaign mutations; keep withJob and withAnswer as replacing upserts for socket events.
- [minor] `web/packages/api/src/campaigns/queries.ts:13`: Update useCampaigns so its queryFn returns the cached campaigns list when available, retaining the existing rejection only when no cached list exists. Remove the redundant campaigns invalidation from useCreateCampaign’s onSuccess handler, since the socket update supplies the refreshed list.
- [major] `web/packages/api/src/query/cache.ts:76`: In mergeFetched, retain cached-only jobs only when jobActive(j) is true, while still excluding jobs already present in fetched.jobs. In the campaign-switch branch of the snapshot handler, remove the exact keys.campaign() query before invalidating it so data from the previous campaign is not reused.
