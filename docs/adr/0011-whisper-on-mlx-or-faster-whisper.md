# 0011. Whisper on MLX on Apple Silicon, faster-whisper everywhere else

Status: accepted

## Context

Troubadour was built and measured on Apple Silicon: Whisper and the voice clones run on MLX, the speaker
embedder on torch MPS. MLX doesn't run on Windows or on Linux without Apple hardware, and the project is
open source: people want to run it on the machine they have, including ones without a GPU.

## Decision

- `troubadour.core.config.MLX` (arm64 macOS) picks the Whisper backend: `sound/asr_mlx.py` (mlx-whisper) or
  `sound/asr_ct2.py` (faster-whisper on CTranslate2: fp16 on an NVIDIA GPU when its CUDA libraries load,
  else int8 on the CPU). `asr.py` keeps everything both share: the prompt, the hallucination checks and
  `model_lock`. Both decode greedily with the settings PLAN.md benchmarked on MLX.
- The live default follows the hardware (`config.whisper_defaults`): turbo on MLX or an NVIDIA GPU, `small` on
  a CPU. On a fast CPU, turbo int8 took 0.6× real time and small 0.3×; an ordinary CPU running turbo would
  fall behind a live table. The background re-listen uses turbo on a CPU. The models menu lists what the
  machine can run.
- The speaker embedder runs on CUDA, else MPS, else the CPU (`voices.torch_device`).
- Voice clones (Chatterbox and DeepFilterNet on MLX) stay Apple Silicon only: `config.VOICE_CLONES`, the
  `available` flag on `GET /api/clones`, and the dialog says so. Speech profiles need only the LLM and
  work everywhere.
- What used to come from macOS ships in the repo: Whisper's tokenizer vocabulary (openai/whisper, MIT) for
  counting prompt tokens without a model, and the 1934 dictionary (`/usr/share/dict/web2`, public domain)
  behind `everyday()`.
- Dependencies are split with environment markers in `backend/packages/sound/pyproject.toml`; `uv.lock`
  stays universal. `install.sh` covers macOS and Linux, `install.ps1` Windows. CI runs the backend tests on
  Linux (required) and Windows (reported until it's green).

## Consequences

Accuracy and speed numbers in PLAN.md are MLX measurements; faster-whisper and `small` are not
re-benchmarked on real sessions yet. Missing CUDA libraries fall back to the CPU with a logged message
rather than failing. Windows developer scripts (`yarn dev`, `yarn setup`, the web `test` script) assume a
POSIX shell.

## Alternatives

- whisper.cpp: fast on every platform, but a native build or a less maintained binding; faster-whisper
  installs from wheels.
- openai-whisper on torch: one code path everywhere, but several times slower than either backend.
- Asking for an NVIDIA GPU off the computer: simpler, but it shuts out most laptops.
