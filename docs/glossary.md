# Glossary (one word per idea)

The UI, the docs and the code use these words the same way.

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
