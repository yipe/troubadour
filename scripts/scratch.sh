#!/bin/sh
# A throwaway Troubadour server: its own data dir under /tmp, seeded with the demo campaign, no models,
# and no LLM unless asked. Port 8765 belongs to the real app, so it is refused.
# Usage: scripts/scratch.sh [PORT] [--keep] [--llm]
set -eu

PORT=8767
KEEP=0
LLM=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    --llm) LLM=1 ;;
    *[!0-9]* | '') echo "usage: scripts/scratch.sh [PORT] [--keep] [--llm]" >&2; exit 2 ;;
    *) PORT="$arg" ;;
  esac
done

if [ "$PORT" = 8765 ]; then
  echo "scratch.sh: port 8765 is the real app; pick another (default 8767)" >&2
  exit 2
fi

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DATA="/tmp/troubadour-scratch-$PORT"
echo "Scratch server: http://127.0.0.1:$PORT"
echo "Data dir:       $DATA"

if [ "$KEEP" = 0 ]; then
  rm -rf "$DATA"
fi
mkdir -p "$DATA"

cd "$ROOT/backend"
if [ "$KEEP" = 1 ] && [ -f "$DATA/.troubadour-seed" ]; then
  # Reseeding would reset the seed-owned files and lose what was changed in the last run.
  echo "(--keep: reusing the seeded data dir as it is)"
elif [ -f spike/seed_demo.py ]; then
  uv run python spike/seed_demo.py "$DATA"
else
  echo "(no spike/seed_demo.py yet: starting with an empty data dir)"
fi

# The default LLM URL is a dead port, so nothing reaches a model by accident; --llm uses LM Studio.
if [ "$LLM" = 1 ]; then
  exec env -u TROUBADOUR_VAULT -u BARD_VAULT -u TROUBADOUR_LLM_URL -u BARD_LLM_URL \
    TROUBADOUR_DATA="$DATA" TROUBADOUR_PORT="$PORT" TROUBADOUR_SAMPLES="$DATA/samples" \
    TROUBADOUR_OBSIDIAN_REGISTRY="$DATA/obsidian.json" TROUBADOUR_MODELS=0 \
    uv run troubadour
fi
exec env -u TROUBADOUR_VAULT -u BARD_VAULT \
  TROUBADOUR_DATA="$DATA" TROUBADOUR_PORT="$PORT" TROUBADOUR_SAMPLES="$DATA/samples" \
  TROUBADOUR_OBSIDIAN_REGISTRY="$DATA/obsidian.json" TROUBADOUR_MODELS=0 \
  TROUBADOUR_LLM_URL="${LLM_URL:-http://127.0.0.1:9/v1}" \
  uv run troubadour
