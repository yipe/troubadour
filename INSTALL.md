# Installing Troubadour

Troubadour runs on one computer: a Mac with Apple Silicon (best tested), Linux, or Windows (new: please
[open an issue](../../issues) if something breaks). Everything runs locally; nothing is sent anywhere unless
you choose a hosted language model or cloud backup later.

| | Mac (M1 or newer) | Linux | Windows |
|---|---|---|---|
| Speech-to-text | Whisper large-v3-turbo on MLX | large-v3-turbo with an NVIDIA GPU, else `small` on the CPU | same as Linux |
| Speaker recognition | yes | yes | yes |
| Voice clones | yes | no | no |
| Installer | `./install.sh` | `./install.sh` | `.\install.ps1` |

Without an NVIDIA GPU, Whisper uses the smaller `small` model so it keeps up with a live table. It misses
more character names than the large model. You can change models later in **Settings → Models**.

## 1. Get the code

```sh
git clone https://github.com/yipe/troubadour
cd troubadour
```

No git? Use **Code → Download ZIP** on GitHub and unzip it.

## 2. Run the installer

### Mac or Linux

```sh
./install.sh
```

### Windows (PowerShell)

```powershell
.\install.ps1
```

If Windows refuses to run the script, allow local scripts once and try again:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### What the installer does

1. Checks your machine and lists everything missing, with the command that fixes it.
2. Asks before installing anything: `brew` on a Mac, `apt`, `dnf` or `pacman` on Linux, `winget` on Windows.
   Linux package installs use `sudo`, so it may ask for your password.
3. Installs Python 3.12 and Troubadour's packages (`uv`), then the web packages (`pnpm`), and builds the UI.

The first run downloads a few GB (PyTorch and Whisper) and takes a few minutes. Running it again is safe and
fast: it only checks.

To see what's missing without installing anything: `./install.sh --check` (or `.\install.ps1 -Check`).

### What it needs

| | Mac | Linux | Windows |
|---|---|---|---|
| `uv` (Python) | `brew install uv` | `curl -LsSf https://astral.sh/uv/install.sh \| sh` | `winget install astral-sh.uv` |
| `ffmpeg` | `brew install ffmpeg` | your package manager | `winget install Gyan.FFmpeg` |
| Node 24 or newer | `brew install node` | [nodejs.org](https://nodejs.org) or `nvm install 24` (distributions often ship an older one) | `winget install OpenJS.NodeJS.LTS` |
| Corepack (Yarn and pnpm) | comes with Node 24; on Node 25+: `npm install -g corepack` | same | same |
| PortAudio (the microphone) | built in | `libportaudio2` (apt) or `portaudio` (dnf, pacman) | built in |

On a Mac without Homebrew, install it first from [brew.sh](https://brew.sh).

## 3. Get a Hugging Face token (speaker recognition)

1. Make a free account at [huggingface.co](https://huggingface.co) and create a token at
   [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) (type: Read).
2. Open [pyannote/speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1)
   and accept its terms once.

The models download on the first start, then stay on your machine.

## 4. Optional: a local language model

Transcription works without one. Spelling cleanup, session write-ups and questions about the campaign need
a language model. Either:

- **Local:** install [LM Studio](https://lmstudio.ai/), load a model (default `google/gemma-4-26b-a4b-qat`) and
  start its server on port 1235:

  ```sh
  lms server start --port 1235 && lms load google/gemma-4-26b-a4b-qat --yes
  ```

- **Hosted:** skip this and pick a provider later in **Settings → Models** (ChatGPT plan, OpenRouter, Anthropic or
  DeepSeek). Transcripts and notes then go to that provider; audio and voices never do.

## 5. Start it

Mac or Linux:

```sh
HF_TOKEN=hf_your_token yarn start
```

Windows (PowerShell):

```powershell
$env:HF_TOKEN = "hf_your_token"; yarn start
```

Open <http://127.0.0.1:8765>. The welcome steps add your players and campaign; pick your microphone on the
ready check and start a session. An omnidirectional or boundary mic in the middle of the table works best.

## Updating

```sh
git pull
./install.sh        # or .\install.ps1
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `yarn: command not found` | Run `corepack enable`. If that needs admin rights, the installer put Yarn in `~/.local/bin` (Linux) or `%LOCALAPPDATA%\Troubadour\bin` (Windows): open a new terminal, or add that folder to your `PATH`. |
| "Models failed to load" in the app | Check `HF_TOKEN` is set and that you accepted the terms of `pyannote/speaker-diarization-community-1`. |
| Transcription falls behind on a slow computer | In **Settings → Models**, pick Whisper `small` for live; Improve transcript can re-listen later with a bigger model. |
| NVIDIA GPU isn't used | Install the CUDA 12 cuBLAS and cuDNN 9 libraries. The server log says when Whisper falls back to the CPU. |
| "This terminal runs under Rosetta" (Mac) | Open Terminal without "Open using Rosetta" and run the installer again. |
| No microphone on Linux | Install PortAudio (`sudo apt-get install libportaudio2`) and check the mic works in your desktop's sound settings. |

## Where your data lives

Everything Troubadour saves (players, voiceprints, recordings, the campaign notes) is in `~/troubador/`
(`%USERPROFILE%\troubador` on Windows). Set `TROUBADOUR_DATA` to put it elsewhere. Ask your table before you
record them.

## Developing on Troubadour

Use `yarn setup` (the same installer with `--dev`: test tools and the browser for UI tests), then see
[AGENTS.md](AGENTS.md). Developer scripts assume a POSIX shell, so on Windows use WSL or Git Bash for now.
