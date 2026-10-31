repo: yipe/troubadour
branch: main
path: web/src

## Last sync
date: 2026-10-30T19:23:14Z

### Updated in this project
- Redesign of every main flow in the DPRcalc UI style (no 1:1 recreation of the current UI)
- New lifecycle navigation: Home, Sessions, Codex, Facts, Ask
- Three options each for the live session, post-session review and facts
- Three app icon concepts

## Screen map
| Screen | Repo files |
|---|---|
| Troubadour Nav | web/src/App.tsx, web/src/components/CampaignSwitcher.tsx |
| Screen Setup | web/src/components/setup/SetupView.tsx, PlayerCard.tsx, CampaignSwitcher.tsx |
| Screen Home | web/src/App.tsx, web/src/components/history/HistoryView.tsx |
| Screen Lobby | web/src/components/setup/StartPanel.tsx, web/src/components/audio/MicTest.tsx |
| Screen Live A/C | web/src/components/session/SessionView.tsx, SessionHeader.tsx, PlayerGrid.tsx, VoicesPanel.tsx, web/src/components/transcript/TranscriptRow.tsx, PlayerBox.tsx |
| Screen Ask Overlay | web/src/components/campaign/AskPanel.tsx |
| Screen Review A/B/C | web/src/components/campaign/SuggestionsCard.tsx, EntityEditor.tsx, WriteUpButton.tsx, web/src/components/history/SessionViewer.tsx |
| Screen Facts A/B/C | web/src/components/campaign/FactList.tsx, CampaignFacts.tsx |
| Screen Codex | web/src/components/campaign/CampaignView.tsx, GlossaryList.tsx, EntityEditor.tsx, web/src/lib/campaign.ts |
| Screen History | web/src/components/history/HistoryView.tsx, SavedSessionRow.tsx, SessionViewer.tsx |
| Screen Recap | web/src/components/campaign/WriteUpButton.tsx, web/src/components/clone/ReadAloud.tsx |
| Screen Cloud Connect/Popover/Settings | web/src/components/campaign/CloudBackupButton.tsx, web/src/lib/cloudStore.ts |
| Live Prototype | web/src/components/session/SessionView.tsx, ChatFeed.tsx, VoicesPanel.tsx, web/src/components/campaign/AskPanel.tsx |
| Screen Timeline A/B/C | web/src/lib/talkTime.ts, web/src/components/history/HistoryView.tsx |
| Screen Cloud Player | web/src/components/campaign/CloudBackupButton.tsx |
| Screen Settings | web/src/components/ModelsDialog.tsx, README.md |
