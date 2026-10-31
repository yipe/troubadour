"""Hosted language models: an opt-in alternative to the local LLM for spelling cleanup, session write-ups,
note import and Ask. Nothing here contacts a provider until the user picks one in Models and signs in or
pastes a key. Whisper and voices stay on this computer whichever model is chosen.

- openai: Sign in with ChatGPT with ChatGPT plan usage. Requests go to the Responses API and count against
  the user's ChatGPT plan, not an API key (https://developers.openai.com/siwc/token-sharing-open-source).
- openrouter: OAuth PKCE that mints a key on the user's OpenRouter account (billed to their credits).
- anthropic, deepseek: a key the user pastes. Anthropic doesn't let third-party apps use Claude
  subscriptions, so this bills the user's API account.

Secrets live in DATA_DIR/llm_accounts.json, readable by this user only.
"""

import base64
import hashlib
import json
import logging
import os
import secrets
import threading
import time
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlencode

import httpx
import jwt

from . import config

log = logging.getLogger("troubadour")

LOCAL = "local"  # LM Studio or any OpenAI-compatible server at the address in Models


@dataclass(frozen=True)
class Provider:
    label: str
    url: str  # API base
    wire: str  # "chat" (OpenAI-compatible chat completions), "anthropic" (Messages), "responses" (ChatGPT plan)
    sign_in: bool  # a browser sign-in; every provider but ChatGPT also takes a pasted key
    manage_url: str  # where the user sees usage and keys
    defaults: tuple[str, str] = ("", "")  # (live spelling, write-ups and Ask) until the user picks; "" = none
    # Shown when the provider's model list carries no prices (only OpenRouter's does).
    price_note: str = ""


PROVIDERS = {
    "openai": Provider(
        "ChatGPT plan",
        "https://api.openai.com/v1",
        "responses",
        True,
        "https://chatgpt.com/settings/usage",
        price_note="No per-token price: requests count against your ChatGPT plan's usage.",
    ),
    "openrouter": Provider(
        "OpenRouter",
        "https://openrouter.ai/api/v1",
        "chat",
        True,
        "https://openrouter.ai/settings/keys",
        # The hosted model PLAN.md measured for write-ups (+4–8 points over the best local one).
        ("anthropic/claude-sonnet-5.5", "anthropic/claude-sonnet-5.5"),
    ),
    "anthropic": Provider(
        "Anthropic API",
        "https://api.anthropic.com/v1",
        "anthropic",
        False,
        "https://platform.claude.com/settings/keys",
        ("claude-haiku-5-5", "claude-sonnet-5-5"),
        "Anthropic's model list has no prices; see https://platform.claude.com/docs/en/about-claude/pricing",
    ),
    "deepseek": Provider(
        "DeepSeek API",
        "https://api.deepseek.com",
        "chat",
        False,
        "https://platform.deepseek.com/api_keys",
        ("deepseek-flash", "deepseek-v4-pro"),
        "DeepSeek's model list has no prices; see https://api-docs.deepseek.com/quick_start/pricing",
    ),
}

APP_NAME = "Troubadour"
LOGIN_TTL_S = 600  # an unfinished sign-in is forgotten after 10 minutes
REFRESH_EARLY_S = 60
KEY_MAX = 400
ANTHROPIC_VERSION = "2023-06-01"

OPENAI_ISSUER = "https://auth.openai.com"
OPENAI_AUTHORIZE = f"{OPENAI_ISSUER}/api/accounts/authorize"
OPENAI_TOKEN = f"{OPENAI_ISSUER}/api/accounts/oauth/token"
OPENAI_DISCOVERY = f"{OPENAI_ISSUER}/.well-known/openid-configuration"
OPENAI_RESOURCE = "https://api.openai.com/v1"
PLAN_SCOPE = "chatgpt.tokens.use.direct"
OPENAI_SCOPES = f"openid profile email offline_access resource.invoke {PLAN_SCOPE}"
DYNAMIC_CLIENT = "dynamic_agent_client"  # first-time registration only; never saved or used for tokens
USAGE_URL = "https://chatgpt.com/settings/usage"
# Refresh errors that mean "sign in again", not "try later".
UNUSABLE_REFRESH = {
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
}
OPENAI_TOKEN_KEYS = ("access_token", "refresh_token", "id_token", "expires_at", "scopes")

OPENROUTER_AUTH = "https://openrouter.ai/auth"
OPENROUTER_KEYS = "https://openrouter.ai/api/v1/auth/keys"


def openai_redirect() -> str:
    # The documented loopback form: 127.0.0.1 (never localhost) and /auth/callback.
    return f"http://127.0.0.1:{config.PORT}/auth/callback"


def openrouter_redirect() -> str:
    return f"http://localhost:{config.PORT}/api/llm/openrouter/callback"


class ProviderError(RuntimeError):
    """A provider refused or couldn't be reached; the message is for the user."""


class NotConnected(ProviderError):
    pass


# ------------------------------------------------------------------ wire formats (used by memory.MemoryLLM)


def headers(wire: str, secret: str) -> dict:
    if not secret:
        return {}
    if wire == "anthropic":
        return {"x-api-key": secret, "anthropic-version": ANTHROPIC_VERSION}
    return {"Authorization": f"Bearer {secret}"}


def models_path(wire: str) -> str:
    return "/models?limit=1000" if wire == "anthropic" else "/models"


def models(wire: str, body) -> list[dict]:
    """A GET /models reply → [{id, name, price}]. ChatGPT's account catalog is `models` (slugs; only the listed
    ones are meant for a picker); everyone else's is OpenAI's `data`. Display names come from `display_name`
    (ChatGPT, Anthropic) or `name` (OpenRouter, DeepSeek); a price only from OpenRouter's `pricing`."""
    if not isinstance(body, dict):
        return []
    key, id_field = ("models", "slug") if wire == "responses" else ("data", "id")
    rows = body.get(key) if isinstance(body.get(key), list) else []
    out = []
    for m in rows:
        if not isinstance(m, dict) or not isinstance(m.get(id_field), str):
            continue
        if wire == "responses" and m.get("visibility") != "list":
            continue
        name = m.get("display_name") or m.get("name")
        out.append(
            {"id": m[id_field], "name": name[:120] if isinstance(name, str) else m[id_field], "price": price(m.get("pricing"))}
        )
    return out


def model_ids(wire: str, body) -> list[str]:
    return [m["id"] for m in models(wire, body)]


def price(pricing) -> str | None:
    """OpenRouter's USD-per-token strings → "$3.00 in · $15.00 out per 1M tokens". None when absent or not a
    plain price (OpenRouter's auto-router reports -1: it depends on the model it picks)."""
    if not isinstance(pricing, dict):
        return None
    try:
        prompt, completion = float(pricing["prompt"]) * 1e6, float(pricing["completion"]) * 1e6
    except (KeyError, TypeError, ValueError):
        return None
    if not (0 <= prompt < 1e6 and 0 <= completion < 1e6):  # also rules out nan and inf
        return None
    if prompt == completion == 0:
        return "free"
    return f"{_usd(prompt)} in · {_usd(completion)} out per 1M tokens"


def _usd(x: float) -> str:
    return f"${x:.2f}" if x == 0 or x >= 0.01 else f"${x:.2g}"


def anthropic_payload(model: str, system: str, user: str, schema: dict, max_tokens: int) -> dict:
    # No temperature: current Claude models refuse anything but the default.
    return {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
        "output_config": {"format": {"type": "json_schema", "schema": schema}},
    }


def anthropic_text(body) -> tuple[str, bool]:
    """(the reply's text, whether it was cut off at max_tokens)."""
    body = body if isinstance(body, dict) else {}
    blocks = body.get("content") if isinstance(body.get("content"), list) else []
    text = "".join(
        b["text"] for b in blocks if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str)
    )
    return text, body.get("stop_reason") == "max_tokens"


def responses_payload(model: str, system: str, user: str, schema: dict) -> dict:
    """The ChatGPT plan route requires store false and stream true, and refuses temperature, max_output_tokens
    and system-role input items (https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)."""
    return {
        "model": model,
        "instructions": system,
        "input": [{"role": "user", "content": user}],
        "store": False,
        "stream": True,
        "text": {"format": {"type": "json_schema", "name": "out", "schema": schema, "strict": True}},
    }


def read_stream(lines: Iterable[str]) -> tuple[str, bool]:
    """A Responses event stream → (the text, whether it was cut short). Only `response.completed` is success;
    a usage limit can arrive as `response.failed` after text has started."""
    parts: list[str] = []
    for line in lines:
        if not line.startswith("data:"):
            continue
        try:
            event = json.loads(line[5:].strip())
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        kind = event.get("type")
        if kind == "response.output_text.delta" and isinstance(event.get("delta"), str):
            parts.append(event["delta"])
        elif kind == "response.completed":
            return "".join(parts), False
        elif kind == "response.incomplete":
            return "".join(parts), True
        elif kind == "response.failed":
            response = event.get("response") if isinstance(event.get("response"), dict) else {}
            raise ProviderError(plan_error(response.get("error")))
        elif kind == "error":
            raise ProviderError(plan_error(event))
    raise ProviderError("ChatGPT stopped before finishing its answer.")


PLAN_ERRORS = {
    "subscription_sharing_usage_limit_exceeded": f"Troubadour has used its share of your ChatGPT plan for now. Manage usage: {USAGE_URL}",
    "subscription_sharing_user_not_eligible": "This ChatGPT account can't use its plan in other apps (it needs Go, Plus or Pro).",
    "subscription_sharing_usage_unavailable": "ChatGPT couldn't check your plan's usage just now. Try again in a few minutes.",
    "subscription_sharing_user_unavailable": "ChatGPT couldn't check your account just now. Try again in a few minutes.",
    "subscription_sharing_invalid_user": "ChatGPT didn't accept the sign-in. Continue with ChatGPT again in Models.",
}


def plan_error(err) -> str:
    """A ChatGPT plan error (a Responses `error` object, or `{"detail": …}` from before a stream opens) for the user."""
    err = err if isinstance(err, dict) else {}
    code = err.get("code") if isinstance(err.get("code"), str) else ""
    if code in PLAN_ERRORS:
        return PLAN_ERRORS[code]
    message = str(err.get("message") or err.get("detail") or "no details")[:200]
    return f"ChatGPT couldn't answer ({code or 'error'}): {message}"


def http_error(r: httpx.Response) -> str:
    try:
        body = json.loads(r.read())
    except ValueError:
        body = {}
    body = body if isinstance(body, dict) else {}
    return plan_error(body.get("error") if isinstance(body.get("error"), dict) else body)


# ------------------------------------------------------------------ accounts


def _s256(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


def _body(r: httpx.Response) -> dict:
    try:
        body = r.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _seconds(value, default: float = 3600) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def key_hint(key: str) -> str:
    return f"key …{key[-4:]}"


class Accounts:
    """Sign-ins and keys for the hosted providers."""

    def __init__(self, path: Callable[[], Path] | None = None, http: httpx.Client | None = None):
        self.path = path or (lambda: config.DATA_DIR / "llm_accounts.json")
        self.http = http or httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=False)
        self._lock = threading.Lock()
        self._refresh_lock = threading.Lock()  # one ChatGPT token refresh at a time: refresh tokens rotate
        self._pending: dict[str, dict] = {}  # state -> sign-in attempt
        self._discovery: dict | None = None

    # ---------------------------------------------------------------- stored state

    def _load(self) -> dict:
        try:
            data = json.loads(self.path().read_text())
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save(self, data: dict) -> None:
        """Atomically, readable by this user only: it holds keys and refresh tokens."""
        path = self.path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
        os.chmod(tmp, 0o600)
        tmp.replace(path)

    def _update(self, change: Callable[[dict], None]) -> dict:
        with self._lock:
            data = self._load()
            change(data)
            self._save(data)
            return data

    def _record(self, pid: str) -> dict:
        rec = self._load().get(pid)
        return rec if isinstance(rec, dict) else {}

    def status(self) -> dict[str, dict]:
        """Per provider: connected, and who (a ChatGPT email, or the end of a key). Never the secrets."""
        out = {}
        for pid in PROVIDERS:
            rec = self._record(pid)
            if pid == "openai":
                connected = bool(rec.get("refresh_token") or rec.get("access_token"))
                account = rec.get("email") if isinstance(rec.get("email"), str) else None
                out[pid] = {"connected": connected, "account": account if connected else None, "known_account": account}
            else:
                key = rec.get("key") if isinstance(rec.get("key"), str) else ""
                out[pid] = {"connected": bool(key), "account": key_hint(key) if key else None, "known_account": None}
        return out

    def connected(self, pid: str) -> bool:
        return pid in PROVIDERS and self.status()[pid]["connected"]

    # ---------------------------------------------------------------- keys

    def set_key(self, pid: str, key: str) -> None:
        if pid not in PROVIDERS or pid == "openai":
            raise KeyError(pid)
        key = key.strip()
        if not key or len(key) > KEY_MAX or any(c.isspace() or not c.isprintable() for c in key):
            raise ValueError("That doesn't look like an API key.")
        self._update(lambda d: d.__setitem__(pid, {"key": key}))

    def key(self, pid: str) -> str:
        key = self._record(pid).get("key")
        if not isinstance(key, str) or not key:
            raise NotConnected(f"Add your {PROVIDERS[pid].label} key in Models first.")
        return key

    # ---------------------------------------------------------------- sign-in

    def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        try:
            return self.http.request(method, url, **kwargs)
        except httpx.HTTPError as e:
            raise ProviderError(f"Couldn't reach {httpx.URL(url).host} ({type(e).__name__}).") from None

    def start_login(self, pid: str, fresh: bool = False) -> str:
        """The page to open in the browser. `fresh`: ChatGPT registers Troubadour again, for another account."""
        if pid not in PROVIDERS or not PROVIDERS[pid].sign_in:
            raise KeyError(pid)
        verifier, state = secrets.token_urlsafe(64), secrets.token_urlsafe(24)
        attempt: dict = {"provider": pid, "verifier": verifier, "started": time.time()}
        if pid == "openrouter":
            attempt["redirect_uri"] = openrouter_redirect()
            query = {
                "callback_url": attempt["redirect_uri"],
                "code_challenge": _s256(verifier),
                "code_challenge_method": "S256",
                "state": state,
                "key_label": APP_NAME,
            }
            url = f"{OPENROUTER_AUTH}?{urlencode(query)}"
        else:
            # This computer's ext_agent_host_id: chosen once, before the first sign-in, and kept across sign-outs.
            data = self._update(lambda d: d.setdefault("host_id", f"urn:uuid:{uuid.uuid4()}"))
            rec = data.get("openai") if isinstance(data.get("openai"), dict) else {}
            returning = not fresh and isinstance(rec.get("client_id"), str)
            nonce = secrets.token_urlsafe(24)
            attempt |= {
                "nonce": nonce,
                "redirect_uri": openai_redirect(),
                "client_id": rec["client_id"] if returning else DYNAMIC_CLIENT,
                "subject": rec.get("subject") if returning else None,
            }
            query = {
                "response_type": "code",
                "client_id": attempt["client_id"],
                "redirect_uri": attempt["redirect_uri"],
                "scope": OPENAI_SCOPES,
                "resource": OPENAI_RESOURCE,
                "state": state,
                "nonce": nonce,
                "code_challenge": _s256(verifier),
                "code_challenge_method": "S256",
                "ext_agent_host_id": data["host_id"],
            }
            if returning:
                if isinstance(rec.get("id_token"), str):
                    query["id_token_hint"] = rec["id_token"]
                if isinstance(rec.get("email"), str):
                    query["login_hint"] = rec["email"]
                if rec.get("plan_declined"):
                    query["prompt"] = "consent"  # they said no to plan use last time: ask again
            else:
                query["agent_name_hint"] = APP_NAME
            url = f"{OPENAI_AUTHORIZE}?{urlencode(query)}"
        with self._lock:
            now = time.time()
            self._pending = {s: a for s, a in self._pending.items() if now - a["started"] < LOGIN_TTL_S}
            self._pending[state] = attempt
        return url

    def finish_login(self, pid: str, code: str, state: str, error: str = "", client_id: str = "") -> bool:
        """Complete a sign-in from the browser's return. True the first time ChatGPT plan use is switched on here."""
        with self._lock:
            attempt = self._pending.get(state)
            if attempt is not None and attempt["provider"] == pid:
                del self._pending[state]
            else:
                attempt = None
        if attempt is None or time.time() - attempt["started"] >= LOGIN_TTL_S:
            raise ValueError("This sign-in expired or didn't start here. Try again from Troubadour.")
        if error:
            raise ValueError(
                "You didn't allow Troubadour access." if error == "access_denied" else f"Sign-in didn't finish ({error})."
            )
        if not code:
            raise ValueError("Sign-in didn't finish. Try again from Troubadour.")
        if pid == "openrouter":
            self._finish_openrouter(code, attempt)
            return False
        return self._finish_openai(code, client_id, attempt)

    def _finish_openrouter(self, code: str, attempt: dict) -> None:
        r = self._request(
            "POST",
            OPENROUTER_KEYS,
            json={"code": code, "code_verifier": attempt["verifier"], "code_challenge_method": "S256"},
        )
        if r.status_code != 200:
            raise ProviderError(f"OpenRouter didn't accept the sign-in ({r.status_code}).")
        key = _body(r).get("key")
        if not isinstance(key, str) or not key or len(key) > KEY_MAX:
            raise ProviderError("OpenRouter sent no key.")
        self._update(lambda d: d.__setitem__("openrouter", {"key": key}))

    def _finish_openai(self, code: str, returned_client: str, attempt: dict) -> bool:
        client_id = attempt["client_id"]
        if client_id == DYNAMIC_CLIENT:
            if not returned_client or returned_client == DYNAMIC_CLIENT:
                raise ProviderError("ChatGPT didn't finish registering Troubadour. Try again.")
            client_id = returned_client
        elif returned_client and returned_client != client_id:
            raise ProviderError("ChatGPT answered for a different registration. Try again.")
        r = self._request(
            "POST",
            OPENAI_TOKEN,
            data={
                "grant_type": "authorization_code",
                "client_id": client_id,
                "code": code,
                "code_verifier": attempt["verifier"],
                "redirect_uri": attempt["redirect_uri"],
                "resource": OPENAI_RESOURCE,
            },
        )
        tokens = _body(r)
        if r.status_code != 200:
            raise ProviderError(f"ChatGPT didn't accept the sign-in ({tokens.get('error') or r.status_code}).")
        if not isinstance(tokens.get("access_token"), str) or not isinstance(tokens.get("id_token"), str):
            raise ProviderError("ChatGPT sent no tokens.")
        claims = self._verify_id_token(tokens["id_token"], client_id, attempt["nonce"])
        if attempt["subject"] and claims["sub"] != attempt["subject"]:
            raise ValueError("That's a different ChatGPT account. To switch, choose Use another account.")
        granted = PLAN_SCOPE in str(tokens.get("scope") or "").split()
        email = claims.get("email") if isinstance(claims.get("email"), str) else None
        first = False

        def change(d: dict) -> None:
            nonlocal first
            old = d.get("openai") if isinstance(d.get("openai"), dict) else {}
            same = old.get("client_id") == client_id
            rec = {
                "client_id": client_id,
                "subject": claims["sub"],
                "email": email,
                "welcomed": same and bool(old.get("welcomed")),
            }
            if granted:
                first = not rec["welcomed"]
                rec |= {
                    "welcomed": True,
                    "access_token": tokens["access_token"],
                    "refresh_token": tokens.get("refresh_token") if isinstance(tokens.get("refresh_token"), str) else None,
                    "id_token": tokens["id_token"],
                    "expires_at": time.time() + _seconds(tokens.get("expires_in")),
                    "scopes": str(tokens.get("scope")).split(),
                }
            else:
                rec["plan_declined"] = True
            d["openai"] = rec

        self._update(change)
        if not granted:
            raise ValueError("Troubadour wasn't allowed to use your ChatGPT plan. Continue with ChatGPT again and allow it.")
        return first

    def _discovered(self, field: str) -> str:
        if self._discovery is None:
            r = self._request("GET", OPENAI_DISCOVERY)
            if r.status_code != 200:
                raise ProviderError(f"ChatGPT's sign-in settings aren't available ({r.status_code}).")
            self._discovery = _body(r)
        value = self._discovery.get(field)
        if not isinstance(value, str) or not value.startswith("https://"):
            raise ProviderError("ChatGPT's sign-in settings don't look right.")
        return value

    def _verify_id_token(self, token: str, client_id: str, nonce: str) -> dict:
        """Signature (OpenAI's published keys), issuer, audience, expiry and this attempt's nonce."""
        r = self._request("GET", self._discovered("jwks_uri"))
        try:
            keys = jwt.PyJWKSet.from_dict(_body(r))
            kid = jwt.get_unverified_header(token).get("kid")
            key = next(k for k in keys.keys if k.key_id == kid)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["RS256", "ES256"],
                audience=client_id,
                issuer=OPENAI_ISSUER,
                options={"require": ["exp", "iat", "sub", "aud", "iss"]},
                leeway=60,  # this computer's clock a little ahead of or behind OpenAI's must not break sign-in
            )
        except (jwt.PyJWTError, StopIteration) as e:
            raise ProviderError(f"ChatGPT's sign-in couldn't be verified ({type(e).__name__}).") from None
        if claims.get("nonce") != nonce or not isinstance(claims.get("sub"), str):
            raise ProviderError("ChatGPT's sign-in couldn't be verified (nonce).")
        return claims

    def token(self, rejected: str | None = None) -> str:
        """ChatGPT's current access token, refreshed when it's about to expire or the API just `rejected` it.
        Serialized and re-checked: two callers must not both spend the same (rotating) refresh token."""
        with self._refresh_lock:
            rec = self._record("openai")
            token = rec.get("access_token")
            if not isinstance(token, str) or not token:
                raise NotConnected("Sign in with ChatGPT in Models first.")
            if time.time() < _seconds(rec.get("expires_at"), 0) - REFRESH_EARLY_S and token != rejected:
                return token
            if not isinstance(rec.get("refresh_token"), str):
                self._clear_openai()
                raise NotConnected("Your ChatGPT sign-in ended. Continue with ChatGPT again in Models.")
            r = self._request(
                "POST",
                OPENAI_TOKEN,
                data={
                    "grant_type": "refresh_token",
                    "client_id": rec["client_id"],
                    "refresh_token": rec["refresh_token"],
                    "resource": OPENAI_RESOURCE,
                },
            )
            tokens = _body(r)
            if r.status_code != 200:
                if tokens.get("error") in UNUSABLE_REFRESH:
                    self._clear_openai()
                    raise NotConnected("Your ChatGPT sign-in ended. Continue with ChatGPT again in Models.")
                raise ProviderError(f"Couldn't renew the ChatGPT sign-in ({tokens.get('error') or r.status_code}).")
            if not isinstance(tokens.get("access_token"), str):
                raise ProviderError("ChatGPT sent no access token.")

            def change(d: dict) -> None:
                o = d.setdefault("openai", {})
                o["access_token"] = tokens["access_token"]
                if isinstance(tokens.get("refresh_token"), str):
                    o["refresh_token"] = tokens["refresh_token"]
                if isinstance(tokens.get("id_token"), str):
                    o["id_token"] = tokens["id_token"]
                if isinstance(tokens.get("scope"), str):
                    o["scopes"] = tokens["scope"].split()
                o["expires_at"] = time.time() + _seconds(tokens.get("expires_in"))

            self._update(change)
            return tokens["access_token"]

    def _clear_openai(self) -> None:
        """Forget the tokens; keep the registration (client id, account) and this computer's host id for next time."""

        def change(d: dict) -> None:
            rec = d.get("openai") if isinstance(d.get("openai"), dict) else {}
            for key in OPENAI_TOKEN_KEYS:
                rec.pop(key, None)

        self._update(change)

    def logout(self, pid: str) -> bool:
        """Forget the sign-in or key. For ChatGPT, also end the session at OpenAI; False if that wasn't confirmed
        (the user can still disconnect Troubadour in ChatGPT's settings)."""
        if pid not in PROVIDERS:
            raise KeyError(pid)
        if pid != "openai":
            self._update(lambda d: d.pop(pid, None))
            return True
        rec = self._record("openai")
        confirmed = True
        if isinstance(rec.get("refresh_token"), str):
            confirmed = self._revoke(rec["refresh_token"], rec.get("client_id"))
        self._clear_openai()
        return confirmed

    def _revoke(self, refresh_token: str, client_id) -> bool:
        for attempt in range(3):
            try:
                r = self._request(
                    "POST",
                    self._discovered("revocation_endpoint"),
                    data={"token": refresh_token, "token_type_hint": "refresh_token", "client_id": client_id},
                )
            except ProviderError:
                r = None
            if r is not None and r.status_code < 500:
                return r.status_code == 200
            if attempt < 2:
                time.sleep(0.5 * (attempt + 1))
        log.warning("couldn't confirm the ChatGPT sign-out with OpenAI")
        return False
