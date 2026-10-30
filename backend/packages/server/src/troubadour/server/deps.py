"""The server's shared objects, created once at import. Routers use `from troubadour.server import deps` and
`deps.engine`, never `from .deps import engine`: that copies the object, and a test patching `deps.engine`
would miss it."""

import threading
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException
from fastapi.responses import Response
from troubadour.cloud.backup import Cloud
from troubadour.core import config, settings
from troubadour.core.providers import Accounts
from troubadour.engine import Bus, Engine
from troubadour.engine.cloning import Cloning
from troubadour.lore.ask import Asker
from troubadour.lore.campaign import Vault
from troubadour.lore.memory import Memory

bus = Bus()


engine = Engine(bus)


vault = Vault(engine.vault_dir)  # the open campaign's notes, looked up on every use


memory = Memory(vault, bus, sessions_dir=engine.sessions_dir, seed=engine.known_names)


cloning = Cloning(engine, llm=lambda: memory.llm, vault=vault, written_up=memory.written_up)


asker = Asker(
    vault,
    bus,
    sessions=engine.campaign_sessions,
    written_up=memory.written_up,
    campaign=lambda: engine.campaign,
    seed=engine.known_names,
)


cloud = Cloud()  # opt-in backup; contacts the service only once the user connects


def session_live() -> bool:
    """A session is running or paused: backups wait until it ends (the mic and Whisper need the Mac)."""
    return engine.status != "idle"


accounts = Accounts()  # hosted language models; contacts one only once the user signs in or adds a key


# Held while switching campaigns and while a job is checked and queued: jobs use the open
# campaign's notes, so one can't be queued for one campaign and then run in another.
campaign_gate = threading.Lock()


LOCAL_HOSTS = {"127.0.0.1", "localhost", config.HOST}


def _origin_ok(origin: str | None) -> bool:
    """No Origin (curl, same-origin GET) or a page served from this machine (any port: Vite dev)."""
    return origin is None or urlparse(origin).hostname in LOCAL_HOSTS


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except KeyError as e:
        raise HTTPException(404, f"not found: {e.args[0] if e.args else ''}") from None
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


def _installed_llms() -> list[str]:
    """Model ids the configured local server is offering. Empty when it is down."""
    chosen = settings.current()
    return _scan_llms(chosen["llm_url"], chosen.get("api_key") or "")[0]


def _scan_llms(url: str, key: str) -> tuple[list[str], str | None]:
    """(model ids a local server offers, why there are none or None)."""
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    try:
        r = httpx.get(f"{url.rstrip('/')}/models", headers=headers, timeout=8)
    except httpx.HTTPError as e:
        return [], f"Couldn't reach {url} ({type(e).__name__})."
    if r.status_code != 200:
        return [], f"{url} answered {r.status_code}."
    try:
        data = r.json().get("data", [])
    except (ValueError, AttributeError):
        return [], f"{url} sent a model list Troubadour can't read."
    ids = [m["id"] for m in data if isinstance(m, dict) and isinstance(m.get("id"), str)] if isinstance(data, list) else []
    return ids[:500], None


def _recheck_llm_soon() -> None:
    """The header's LLM status follows a switch now, not at the next 30 s health check (off the request thread:
    a hosted provider can take seconds to answer)."""
    threading.Thread(target=engine.recheck_llm, name="llm-recheck", daemon=True).start()


def _download(body: str | bytes, sid: str, fmt: str) -> Response:
    media = "text/markdown; charset=utf-8" if fmt == "md" else "application/json"
    return Response(body, media_type=media, headers={"Content-Disposition": f'attachment; filename="troubadour-{sid}.{fmt}"'})


def _require_open_campaign(sid: str) -> None:
    """These jobs use the open campaign's glossary and notes: refuse another campaign's session."""
    campaign = engine.session_campaign(sid)
    if campaign is not None and campaign != engine.campaign:
        raise HTTPException(400, "That session belongs to another campaign; open it first.")
