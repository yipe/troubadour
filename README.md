# Troubadour

Live transcription for an in-person D&D table, from one shared microphone. Troubadour shows who is
speaking and what they said as the game happens, and keeps a campaign wiki (plain Markdown, an
Obsidian vault) that grows every session.

**Everything runs locally** on one computer: speech-to-text, speaker recognition and the language model.
No audio or text leaves the machine unless you opt in to a hosted language model or cloud backup.
Runs best on a Mac with Apple Silicon; Linux and Windows work too (an NVIDIA GPU helps).

## What it does

- **Live transcript** with speaker labels. Whisper (large-v3-turbo) transcribes; voiceprints from pyannote's
  speaker-embedding model tell the voices apart.
- **No setup recording needed.** Unknown voices show up as "Voice 1", "Voice 2"…; tap a name once
  and every past and future line from that voice is relabeled. Optional 15–30 s training helps
  quiet players.
- **Character voices.** A distinct NPC voice can be named as its own character (GM + NPC name).
- **Names spelled right.** Whisper is prompted with the campaign's names, and a spelling cleanup
  fixes misheard names and D&D terms, asking the local LLM only when a word is ambiguous. Every
  fix keeps what was heard.
- **Campaign wiki.** Import your notes, then write up each session: events, facts, new names and
  suggested spellings, all for you to review. Notes stay editable in Obsidian.
- **Ask about the campaign.** "Who did we suspect has the diamond?" The local LLM searches every
  transcript and note, knows who's a player, a PC or an NPC, and answers with its sources.
- **Sessions.** Every session autosaves its transcript, recording and setup, with Markdown/JSON
  export, an audio-quality report and an "Improve transcript" pass.
- **Voice clones** (Mac only, with each player's consent): speak typed lines or read a session page aloud in
  a player's voice.

## Install

**[INSTALL.md](INSTALL.md)** has step-by-step instructions for Mac, Linux and Windows. In short:

```sh
git clone https://github.com/yipe/troubadour && cd troubadour
./install.sh                 # Windows: .\install.ps1. Checks prerequisites and offers to install them
HF_TOKEN=hf_… yarn start     # → http://127.0.0.1:8765
```

You need a free [Hugging Face token](https://huggingface.co/settings/tokens) with access to
[`pyannote/speaker-diarization-community-1`](https://huggingface.co/pyannote/speaker-diarization-community-1).
Transcription works without a language model; spelling cleanup, write-ups and questions use
[LM Studio](https://lmstudio.ai/) on port 1235, or a hosted model you pick in **Settings → Models**
(ChatGPT plan, OpenRouter, Anthropic, DeepSeek). Transcripts and notes then go to that provider; audio and
voices never do.

## Configuration

Environment variables (see `backend/packages/core/src/troubadour/core/config.py`):

| Variable | Default | |
|---|---|---|
| `HF_TOKEN` | — | Hugging Face token (`HUGGING_FACE_TOKEN` also works) |
| `TROUBADOUR_HOST` / `TROUBADOUR_PORT` | `127.0.0.1` / `8765` | where the app listens |
| `TROUBADOUR_DATA` | `~/troubador` | players, voiceprints, sessions, recordings |
| `TROUBADOUR_VAULT` | `$TROUBADOUR_DATA/campaign` | campaign wiki; point it at a folder in an existing Obsidian vault |
| `TROUBADOUR_LLM_URL` / `TROUBADOUR_LLM_MODEL` | LM Studio, gemma | LLM for spelling cleanup |
| `TROUBADOUR_MEMORY_MODEL` / `TROUBADOUR_MEMORY_REASONING` | same model / `none` | LLM for notes and write-ups |
| `TROUBADOUR_WHISPER` | turbo (`mlx-community/whisper-large-v3-turbo` on a Mac; `large-v3-turbo` with an NVIDIA GPU, else `small`) | Whisper model for the live session |
| `TROUBADOUR_WHISPER_IMPROVE` | large-v3 (`mlx-community/whisper-large-v3-mlx` on a Mac; `large-v3` with an NVIDIA GPU, else `large-v3-turbo`) | Whisper model for Improve transcript |
| `TROUBADOUR_RECORD=0`, `TROUBADOUR_CLEANUP=0`, `TROUBADOUR_ASR_PROMPT=0` | on | turn off recording, spelling cleanup, name prompting |

Troubadour was called Bard before. Setups from then keep working: a `BARD_*` variable is read when its
`TROUBADOUR_*` twin isn't set.

## Privacy and safety

- Troubadour binds to `127.0.0.1` with no auth, by design; Host and Origin checks stop other websites in
  your browser from reaching the API.
- Everything Troubadour stores lives in `~/troubador/` (`%USERPROFILE%\troubador` on Windows): voiceprints
  and recordings of the people at your table. Ask before you record people.

## Development

```sh
yarn setup        # = ./install.sh --dev: all Python groups, web packages, Playwright Chromium
yarn dev          # API + Vite with fast refresh
yarn check        # format check, lint, typecheck, tests, build: run before every commit
yarn test         # backend pytest + web vitest (no models, GPU or network needed)
yarn format
```

| Path | |
|---|---|
| `backend/packages/` | Python packages: `core`, `sound`, `lore`, `cloud`, `engine`, `server` |
| `backend/tests/` | pytest |
| `backend/spike/` | benchmarks, research scripts (`uv run --group spike …`) and the demo seed |
| `web/app/`, `web/packages/` | React 19, Vite, Tailwind v4: the app, `ui`, `api`, `tokens` |
| `docs/` | architecture, conventions, glossary, decision records (`docs/adr/`) |

To look around without touching your data or loading models, `scripts/scratch.sh 8790` starts a seeded
throwaway server on another port.

Design notes, measurements and the reasoning behind the thresholds are in [PLAN.md](PLAN.md).
Contributor/agent guides: [AGENTS.md](AGENTS.md), [backend/AGENTS.md](backend/AGENTS.md),
[web/AGENTS.md](web/AGENTS.md); [docs/architecture.md](docs/architecture.md), [docs/conventions.md](docs/conventions.md).

## License

[MIT](LICENSE).

The built-in D&D vocabulary (`backend/packages/lore/src/troubadour/lore/srd_terms.json`) holds names from the System
Reference Document 5.1 and 5.2 by Wizards of the Coast LLC, available at
<https://www.dndbeyond.com/srd>, licensed under
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/legalcode). Troubadour is unofficial and not
affiliated with or endorsed by Wizards of the Coast.

Also bundled: Whisper's tokenizer vocabulary (`backend/packages/sound/src/troubadour/sound/whisper-multilingual.tiktoken`)
from [openai/whisper](https://github.com/openai/whisper), MIT license, Copyright (c) 2022 OpenAI; and
Webster's Second International word list (`backend/packages/lore/src/troubadour/lore/web2.txt.gz`, 1934,
public domain, as distributed by BSD as `/usr/share/dict/web2`).
