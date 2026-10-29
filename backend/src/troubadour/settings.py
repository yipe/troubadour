"""Model choices saved on this machine. Environment defaults apply until the account menu changes them.

`provider` is where the language model runs: "local" (the address in `llm_url`, LM Studio by default) or a
hosted provider from providers.py. `llm` and `memory` are the local models; `hosted` holds each hosted
provider's own pair, so switching back and forth keeps both choices."""

import json
from urllib.parse import urlparse

from . import config, providers

WHISPER_TURBO = "mlx-community/whisper-large-v3-turbo"
WHISPER_LARGE = "mlx-community/whisper-large-v3-mlx"
SPEAKER_MODEL = "pyannote/speaker-diarization-community-1"

# Shown in the menu. A saved id that is not in this list is still kept. Labels name the exact weights:
# both MLX conversions are unquantized fp16 (809M × 2 B ≈ 1.6 GB and 1.55B × 2 B ≈ 3.1 GB on disk).
WHISPER_OPTIONS = (
    {"id": WHISPER_TURBO, "label": "Whisper large-v3-turbo · 809M params · fp16 MLX (faster, live)"},
    {"id": WHISPER_LARGE, "label": "Whisper large-v3 · 1.55B params · fp16 MLX (slower)"},
)
# Only the pipeline's speaker-embedding model runs (voices.py); its weights are fp32 PyTorch on MPS.
SPEAKER_LABEL = "WeSpeaker ResNet34 (256-d voiceprints, from pyannote community-1) · fp32 PyTorch"

_KEYS = ("whisper", "whisper_improve", "llm", "memory")
ROLES = ("llm", "memory")  # live spelling; write-ups, note import and Ask
PROVIDER_IDS = (providers.LOCAL, *providers.PROVIDERS)


def path():
    return config.DATA_DIR / "settings.json"


def defaults() -> dict:
    return {
        "whisper": config.WHISPER_MODEL,
        "whisper_improve": config.WHISPER_IMPROVE_MODEL,
        "llm": config.LLM_MODEL,
        "memory": config.MEMORY_LLM_MODEL,
        "llm_url": config.LLM_URL,
        "api_key": "",
    }


def normalize_llm_url(value: str) -> str:
    """A port, host:port, or full URL. A bare port means this machine. The path defaults to /v1."""
    text = value.strip()
    if not text or len(text) > 300:
        raise ValueError("Address must be a port, host:port, or URL")
    if text.isdigit():
        text = f"http://127.0.0.1:{text}/v1"
    elif "://" not in text:
        text = "http://" + text
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Address must be an http or https URL")
    if parsed.username or parsed.password:
        raise ValueError("Put an API key in the key field, not in the address")
    path = parsed.path.rstrip("/")
    if path in ("", "/"):
        path = "/v1"
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def _read() -> dict:
    try:
        raw = json.loads(path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return raw if isinstance(raw, dict) else {}


def saved() -> dict:
    raw = _read()
    return {k: raw[k] for k in _KEYS if isinstance(raw.get(k), str) and raw[k].strip()}


def known_llms() -> list[str]:
    """Model ids this Mac has used, so the menu still lists them when LM Studio is offline."""
    raw = _read().get("known_llms")
    remembered = [m.strip() for m in raw if isinstance(m, str) and m.strip()] if isinstance(raw, list) else []
    chosen = saved()
    seeds = [config.LLM_MODEL, config.MEMORY_LLM_MODEL, chosen.get("llm", ""), chosen.get("memory", "")]
    out: list[str] = []
    for model in (*remembered, *seeds):
        if model and model not in out:
            out.append(model)
    return out


def _model_id(value, what: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 200:
        raise ValueError(f"{what} must be a model id")
    return value.strip()


def hosted_models(raw: dict | None = None) -> dict[str, dict[str, str]]:
    """Each hosted provider's {llm, memory}: the saved choice, else the provider's default ("" when it has none)."""
    raw = _read() if raw is None else raw
    saved_hosted = raw.get("hosted") if isinstance(raw.get("hosted"), dict) else {}
    out = {}
    for pid, provider in providers.PROVIDERS.items():
        mine = saved_hosted.get(pid) if isinstance(saved_hosted.get(pid), dict) else {}
        out[pid] = {
            role: mine[role].strip() if isinstance(mine.get(role), str) and mine[role].strip() else default
            for role, default in zip(ROLES, provider.defaults, strict=True)
        }
    return out


def current() -> dict:
    raw = _read()
    chosen = {**defaults(), **saved()}
    url = raw.get("llm_url")
    if isinstance(url, str) and url.strip():
        chosen["llm_url"] = url.strip()
    key = raw.get("api_key")
    if isinstance(key, str):
        chosen["api_key"] = key
    chosen["provider"] = raw.get("provider") if raw.get("provider") in PROVIDER_IDS else providers.LOCAL
    chosen["hosted"] = hosted_models(raw)
    return chosen


def update(patch: dict) -> dict:
    raw = _read()
    nxt = {k: raw[k] for k in (*_KEYS, "llm_url", "api_key", "known_llms", "provider", "hosted") if k in raw}
    for key in _KEYS:
        if patch.get(key) is not None:
            nxt[key] = _model_id(patch[key], key)
    if "llm_url" in patch and patch["llm_url"] is not None:
        nxt["llm_url"] = normalize_llm_url(patch["llm_url"])
    if "api_key" in patch and patch["api_key"] is not None:
        key = patch["api_key"]
        if not isinstance(key, str) or len(key) > 400:
            raise ValueError("API key is too long")
        nxt["api_key"] = key.strip()
    if patch.get("provider") is not None:
        if patch["provider"] not in PROVIDER_IDS:
            raise ValueError("Unknown model provider")
        nxt["provider"] = patch["provider"]
    if patch.get("hosted") is not None:
        if not isinstance(patch["hosted"], dict):
            raise ValueError("hosted must map providers to models")
        hosted = nxt["hosted"] if isinstance(nxt.get("hosted"), dict) else {}
        for pid, models in patch["hosted"].items():
            if pid not in providers.PROVIDERS or not isinstance(models, dict):
                raise ValueError("Unknown model provider")
            slot = dict(hosted[pid]) if isinstance(hosted.get(pid), dict) else {}
            for role in ROLES:
                if models.get(role) is not None:
                    slot[role] = _model_id(models[role], role)
            hosted[pid] = slot
        nxt["hosted"] = hosted
    known = known_llms()
    for model in (nxt.get("llm"), nxt.get("memory")):
        if model and model not in known:
            known.append(model)
    nxt["known_llms"] = known
    path().parent.mkdir(parents=True, exist_ok=True)
    path().write_text(json.dumps(nxt, indent=2) + "\n", encoding="utf-8")
    return current()
