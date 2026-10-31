#!/bin/sh
# Sets up Troubadour from a fresh clone on macOS (Apple Silicon) or Linux; on Windows, use install.ps1.
# Checks prerequisites, installs the Python and web packages and builds the UI. Safe to re-run; a second
# run only checks.
#
#   ./install.sh          run the app: packages + built UI, then `yarn start`
#   ./install.sh --dev    develop on it (what `yarn setup` runs): all Python groups + the test browser
#   ./install.sh --check  only report missing prerequisites and how to fix them
set -eu
cd "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"

mode=user
case "${1:-}" in
  "") ;;
  --dev) mode=dev ;;
  --check) mode=check ;;
  *) echo "usage: ./install.sh [--dev | --check]" >&2; exit 2 ;;
esac

step() { printf '\n==> %s\n' "$*"; }
fail() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

os=$(uname -s)
case "$os" in
  Darwin)
    if [ "$(uname -m)" != arm64 ]; then
      [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ] &&
        fail "This terminal runs under Rosetta (x86_64). Open a native terminal and run ./install.sh again."
      # PyTorch no longer publishes builds for Intel Macs.
      fail "On a Mac, Troubadour needs Apple Silicon (M1 or newer); this Mac is $(uname -m)."
    fi
    ;;
  Linux) ;;
  MINGW* | MSYS* | CYGWIN*) fail "On Windows, run .\\install.ps1 in PowerShell instead." ;;
  *) fail "Troubadour runs on macOS (Apple Silicon), Linux and Windows; this is $os." ;;
esac

# What installs a missing system package here (Linux package names differ per family).
if [ "$os" = Darwin ]; then
  install_cmd="brew install" portaudio=""
elif have apt-get; then
  install_cmd="sudo apt-get install -y" portaudio=libportaudio2
elif have dnf; then
  install_cmd="sudo dnf install -y" portaudio=portaudio
elif have pacman; then
  install_cmd="sudo pacman -S --needed" portaudio=portaudio
else
  install_cmd="" portaudio=portaudio
fi

# Collect every problem before fixing any, so one run lists them all.
missing=""   # "  - tool: why" lines
packages=""  # system packages that fix them
blocked=""   # problems this script can't fix
after=""     # fixes that run after the packages
note() { missing="$missing  - $1: $2
"; }
block() { blocked="$blocked  - $*
"; }

if ! have uv; then
  note uv "installs Python 3.12 and Troubadour's packages"
  if [ "$os" = Darwin ]; then packages="$packages uv"; else after="curl -LsSf https://astral.sh/uv/install.sh | sh"; fi
fi
have ffmpeg || { note ffmpeg "decodes audio files"; packages="$packages ffmpeg"; }
if [ "$os" = Linux ]; then
  case "$(ldconfig -p 2>/dev/null || /sbin/ldconfig -p 2>/dev/null || true)" in
    *libportaudio.so.2*) ;;
    *) note "$portaudio" "lets Troubadour hear the microphone (PortAudio)"; packages="$packages $portaudio" ;;
  esac
fi
if have node; then
  node_major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$node_major" -ge 24 ] ||
    block "Node $node_major is too old; Troubadour needs Node 24 or newer (https://nodejs.org, or nvm install 24)."
elif [ "$os" = Darwin ]; then
  note node "builds the web UI (Node 24 or newer)"
  packages="$packages node"
else
  block "node: builds the web UI. Install Node 24 or newer from https://nodejs.org (or nvm install 24): distributions often ship an older one."
fi
# Node 25+ no longer ships Corepack, which provides the pinned Yarn and pnpm.
if ! have corepack; then
  note corepack "runs the pinned Yarn and pnpm"
  after="${after:+$after && }npm install -g corepack"
fi

fix=""
if [ -n "$packages" ]; then
  if [ -n "$install_cmd" ] && { [ "$os" != Darwin ] || have brew; }; then
    fix="$install_cmd$packages"
  elif [ "$os" = Darwin ]; then
    block "Homebrew isn't installed: get it from https://brew.sh, then run ./install.sh again."
  else
    block "Install these with your package manager, then run ./install.sh again:$packages"
  fi
fi
[ -n "$after" ] && fix="${fix:+$fix && }$after"

if [ -n "$missing$blocked" ]; then
  printf 'Missing prerequisites:\n%s%s' "$missing" "$blocked" >&2
  [ -n "$fix" ] && printf '\nFix with:\n  %s\n' "$fix" >&2
  # Install only when someone is there to say yes: never surprise CI or a piped run.
  if [ -n "$blocked" ] || [ "$mode" = check ] || [ ! -t 0 ]; then
    exit 1
  fi
  printf '\nRun that now? [Y/n] '
  read -r answer || answer=n
  case "$answer" in [nN]*) exit 1 ;; esac
  sh -c "$fix"
  PATH="$HOME/.local/bin:$PATH" # where uv's installer puts it
fi
if [ "$mode" = check ]; then
  echo "All prerequisites found."
  exit 0
fi

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# The web scripts call `pnpm` and the root ones `yarn` by name: Corepack's shims provide both, at the versions
# package.json pins. Next to node when that's writable, else in ~/.local/bin (a system-wide Node needs sudo).
if ! have pnpm || ! have yarn; then
  if ! corepack enable 2>/dev/null; then
    corepack enable --install-directory "$HOME/.local/bin"
    PATH="$HOME/.local/bin:$PATH"
    echo "Put Yarn and pnpm in ~/.local/bin: add it to your PATH if 'yarn' isn't found later." >&2
  fi
fi

step "Python packages (uv sync; the first run downloads PyTorch and Whisper, a few minutes)"
if [ "$mode" = dev ]; then
  (cd backend && uv sync --all-groups)
else
  # --inexact: keep the extra groups a developer may have installed with --dev.
  (cd backend && uv sync --frozen --inexact)
fi

# From web/, where packageManager pins pnpm.
step "Web packages (pnpm install)"
(cd web && pnpm install)

if [ "$mode" = dev ]; then
  step "Test browser (Playwright Chromium, for the browser tests in yarn check)"
  (cd web && pnpm -C app exec playwright install chromium)
else
  step "Building the web UI"
  (cd web && pnpm build)
fi

if [ "$mode" = dev ]; then
  cat <<'EOF'

Ready. yarn dev (API + Vite), yarn check before every commit. See AGENTS.md.
EOF
else
  cat <<'EOF'

Ready. To start:
  1. A Hugging Face token with access to pyannote/speaker-diarization-community-1 (see README).
  2. Optional: LM Studio serving on port 1235, or pick a hosted model later in Models.
  3. HF_TOKEN=hf_... yarn start   then open http://127.0.0.1:8765
EOF
fi
