"""Language models: the Models dialog, local server scans and hosted sign-in."""

import concurrent.futures
import html
from typing import Annotated
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, StringConstraints
from troubadour.core import providers, settings
from troubadour.core.providers import PROVIDERS
from troubadour.server import deps

router = APIRouter()


ModelId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class HostedModelsIn(BaseModel):
    llm: ModelId | None = None
    memory: ModelId | None = None


class ModelsIn(BaseModel):
    whisper: str | None = None
    whisper_improve: str | None = None
    llm: str | None = None
    memory: str | None = None
    llm_url: str | None = None
    memory_url: str | None = Field(None, max_length=300)  # "" = auto: llm_url's server
    api_key: str | None = None
    provider: str | None = Field(None, max_length=20)
    hosted: dict[str, HostedModelsIn] | None = Field(None, max_length=len(PROVIDERS))


class LocalModelsIn(BaseModel):
    llm_url: str = Field(max_length=300)
    api_key: str = Field("", max_length=400)


class LlmKeyIn(BaseModel):
    key: str = Field(max_length=providers.KEY_MAX + 100)


class LlmConnectIn(BaseModel):
    fresh: bool = False  # ChatGPT: register again, to sign in to another account


def _llm_choices(installed: list[str] | None = None) -> list[str]:
    """The local server's current models (`installed`, else asked now), plus any this Mac has chosen before."""
    out = list(deps._installed_llms() if installed is None else installed)
    for model in settings.known_llms():
        if model not in out:
            out.append(model)
    return out


def _secret(pid: str) -> str:
    """A hosted provider's key or current ChatGPT token; NotConnected when there is none."""
    return deps.accounts.token() if PROVIDERS[pid].wire == "responses" else deps.accounts.key(pid)


def _apply_models(chosen: dict) -> None:
    pid = chosen["provider"]
    if pid == providers.LOCAL:
        url, wire, key, token = chosen["llm_url"], "chat", chosen.get("api_key") or "", None
        live, memory_model = chosen["llm"], chosen["memory"]
        memory_url = chosen.get("memory_url") or url
    else:
        p = PROVIDERS[pid]
        url, wire = p.url, p.wire
        token = deps.accounts.token if wire == "responses" else None
        try:
            key = "" if token else deps.accounts.key(pid)
        except providers.NotConnected:
            key = ""  # the health check shows the model as unavailable until a key is added
        live, memory_model = chosen["hosted"][pid]["llm"], chosen["hosted"][pid]["memory"]
        memory_url = url
    for llm, model, at in (
        (deps.engine.cleanup_llm, live, url),
        (deps.memory.llm, memory_model, memory_url),
        (deps.asker.llm, memory_model, memory_url),
    ):
        llm.model = model
        llm.url = at.rstrip("/")
        llm.api_key = key
        llm.wire = wire
        llm.token = token


def _llm_providers() -> list[dict]:
    """Every hosted provider, whether it's signed in, and who as. Never a key or token."""
    status = deps.accounts.status()
    return [
        {"id": pid, "label": p.label, "sign_in": p.sign_in, "manage_url": p.manage_url, **status[pid]}
        for pid, p in PROVIDERS.items()
    ]


def _models_response(chosen: dict) -> dict:
    return {
        **chosen,
        "speaker": settings.SPEAKER_MODEL,
        "speaker_label": settings.SPEAKER_LABEL,
        "whisper_options": list(settings.WHISPER_OPTIONS),
        "installed": _llm_choices(),
        "providers": _llm_providers(),
    }


@router.get("/api/settings/models")
def get_models():
    return _models_response(settings.current())


@router.put("/api/settings/models")
def put_models(body: ModelsIn):
    if body.provider in PROVIDERS:
        p = PROVIDERS[body.provider]
        if not deps.accounts.connected(body.provider):
            raise HTTPException(400, f"{'Sign in to' if p.sign_in else 'Add a key for'} {p.label} first.")
        pair = settings.current()["hosted"][body.provider] | {
            role: model for role, model in (body.hosted or {}).get(body.provider, HostedModelsIn()).model_dump().items() if model
        }
        if not (pair["llm"] and pair["memory"]):  # ChatGPT has no defaults: "" would fail every call quietly
            raise HTTPException(400, f"Choose both models for {p.label}.")
    patch = body.model_dump(exclude={"hosted"})
    if body.hosted is not None:
        patch["hosted"] = {pid: models.model_dump() for pid, models in body.hosted.items()}
    try:
        chosen = settings.update(patch)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    _apply_models(chosen)
    deps._recheck_llm_soon()
    return _models_response(chosen)


@router.post("/api/llm/local/models")
def local_models(body: LocalModelsIn):
    """Ask a local model server what it offers now: the address typed in the Models dialog, saved or not (a
    rescan after loading or downloading a model). `installed` also lists models chosen here before."""
    try:
        url = settings.normalize_llm_url(body.llm_url)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    found, error = deps._scan_llms(url, body.api_key.strip())
    return {"installed": _llm_choices(found), "found": len(found), "error": error}


LOCAL_SERVERS = (
    (1234, "LM Studio"),
    (8000, "MTPLX / vLLM"),
    (8080, "llama.cpp / mlx-lm / LocalAI"),
    (11434, "Ollama"),
    (1337, "Jan"),
    (5000, "text-generation-webui"),
    (5001, "KoboldCpp"),
)


@router.get("/api/llm/local/servers")
def local_servers():
    """The usual local model server ports, each asked at once whether it answers and how many models it has
    (unanswered ones too: the dialog lists them as choices). The saved port is listed if it's another one."""
    ports = list(LOCAL_SERVERS)
    saved = urlparse(settings.current()["llm_url"])
    if saved.hostname in ("127.0.0.1", "localhost") and saved.port and saved.port not in {p for p, _ in ports}:
        ports.insert(0, (saved.port, "Saved server"))

    def probe(port: int, name: str) -> dict:
        url = f"http://127.0.0.1:{port}/v1"
        try:
            r = httpx.get(f"{url}/models", timeout=1.5)
            models = providers.model_ids("chat", r.json()) if r.status_code == 200 else None
        except (httpx.HTTPError, ValueError):
            models = None
        return {"port": port, "name": name, "url": url, "running": models is not None, "models": len(models or [])}

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(ports)) as pool:
        return list(pool.map(lambda p: probe(*p), ports))


@router.get("/api/llm/models")
def llm_models(provider: str = Query(max_length=20)):
    """What a hosted provider offers this account ({id, name, price}; the Models dialog's lists), or why there's
    nothing. `price_note` stands in for prices when the provider's list has none."""
    if provider not in PROVIDERS:
        raise HTTPException(404, f"not found: {provider}")
    p = PROVIDERS[provider]
    models, error = _provider_models(p, provider)
    return {"models": models[:1000], "error": error, "price_note": p.price_note or None}


def _provider_models(p: providers.Provider, pid: str) -> tuple[list[dict], str | None]:
    try:
        r = httpx.get(f"{p.url}{providers.models_path(p.wire)}", headers=providers.headers(p.wire, _secret(pid)), timeout=10)
    except providers.ProviderError as e:
        return [], str(e)
    except httpx.HTTPError as e:
        return [], f"Couldn't reach {p.label} ({type(e).__name__})."
    if r.status_code != 200:
        return [], f"{p.label} answered {r.status_code}."
    try:
        return providers.models(p.wire, r.json()), None
    except ValueError:
        return [], f"{p.label} sent a model list Troubadour can't read."


def _llm_changed() -> list[dict]:
    """After a sign-in, key or sign-out: use the new credentials now and tell every open tab."""
    chosen = settings.current()
    if chosen["provider"] != providers.LOCAL and not deps.accounts.connected(chosen["provider"]):
        chosen = settings.update({"provider": providers.LOCAL})  # signed out of the one in use: back to this Mac
    _apply_models(chosen)
    deps._recheck_llm_soon()
    status = _llm_providers()
    deps.bus.emit("llm.updated", {"provider": chosen["provider"], "providers": status})
    return status


@router.post("/api/llm/{provider}/connect")
def llm_connect(provider: str, body: LlmConnectIn | None = None):
    """Start a browser sign-in (ChatGPT or OpenRouter): the first time Troubadour contacts that provider."""
    try:
        return {"authorize_url": deps._call(deps.accounts.start_login, provider, fresh=bool(body and body.fresh))}
    except providers.ProviderError as e:
        raise HTTPException(502, str(e)) from None


def _finish_llm_login(provider: str, code: str, state: str, error: str, client_id: str = "") -> str:
    label = PROVIDERS[provider].label
    try:
        first = deps.accounts.finish_login(provider, code, state, error=error, client_id=client_id)
    except (ValueError, providers.ProviderError) as e:
        _llm_changed()  # a declined ChatGPT plan still updates the saved registration
        return _page(f"{label}: not connected", str(e))
    _llm_changed()
    if first:
        return _page(
            "You're using your ChatGPT plan",
            "Spelling cleanup, write-ups, note import and Ask will use your ChatGPT plan once you choose it in "
            f"Models. You can see and limit Troubadour's usage in ChatGPT's settings: {providers.USAGE_URL}",
            action="Got it",
        )
    return _page(f"{label}: connected", "Troubadour can use it now. Choose it in Models. You can close this tab.")


@router.get("/auth/callback", response_class=HTMLResponse)
def openai_callback(
    code: str = Query("", max_length=4000),
    state: str = Query("", max_length=200),
    error: str = Query("", max_length=200),
    client_id: str = Query("", max_length=200),
):
    """Where Sign in with ChatGPT returns (the documented loopback path)."""
    return _finish_llm_login("openai", code, state, error, client_id)


@router.get("/api/llm/openrouter/callback", response_class=HTMLResponse)
def openrouter_callback(
    code: str = Query("", max_length=4000), state: str = Query("", max_length=200), error: str = Query("", max_length=200)
):
    return _finish_llm_login("openrouter", code, state, error)


@router.put("/api/llm/{provider}/key")
def llm_key(provider: str, body: LlmKeyIn):
    """Save a pasted key (Anthropic, DeepSeek or OpenRouter). It is checked by the next request, not now."""
    deps._call(deps.accounts.set_key, provider, body.key)
    return _llm_changed()


@router.post("/api/llm/{provider}/disconnect")
def llm_disconnect(provider: str):
    """Forget a sign-in or key on this Mac. If it was in use, the language model goes back to this Mac's."""
    confirmed = deps._call(deps.accounts.logout, provider)
    return {"providers": _llm_changed(), "revoked": confirmed}


@router.post("/api/llm/recheck")
def recheck_llm():
    """Try the local LLM again right now. The session event carries the new status."""
    return deps.engine.recheck_llm()


def _page(title: str, text: str, action: str = "Back to Troubadour") -> str:
    return (
        f"<!doctype html><meta charset=utf-8><title>{html.escape(title)}</title>"
        f'<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">'
        f'<h1>{html.escape(title)}</h1><p>{html.escape(text)}</p><p><a href="/">{html.escape(action)}</a></p>'
    )
