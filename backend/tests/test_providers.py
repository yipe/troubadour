"""Hosted language models (providers.py): sign-ins and keys against in-process fakes (httpx.MockTransport),
the wire formats MemoryLLM speaks to them, and the endpoints that switch every LLM over. No network."""

import base64
import hashlib
import json
import time
import uuid
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from conftest import assert_mode
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from troubadour.core import config, providers, settings
from troubadour.core.providers import Accounts, NotConnected, ProviderError
from troubadour.lore import memory as mem
from troubadour.server import deps
from troubadour.server.app import app
from troubadour.server.routers import llm as llm_router

ISSUER = providers.OPENAI_ISSUER
FULL_SCOPE = "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke"
LOCAL = "http://127.0.0.1:8765"


def s256(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


class FakeOpenAI:
    """auth.openai.com for Sign in with ChatGPT: dynamic registration, PKCE, signed ID tokens, rotating refresh."""

    def __init__(self):
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.codes: dict[str, dict] = {}
        self.refresh: dict[str, str] = {}  # refresh token -> client id
        self.sub, self.email = "user-1", "gm@example.com"
        self.scope = FULL_SCOPE
        self.revoked: list[str] = []
        self.registrations = 0
        self.nonce_override: str | None = None
        self.clock_skew = 0  # seconds OpenAI's clock is ahead of this computer's

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def approve(self, authorize_url: str) -> dict:
        """The browser: sign in and consent, then come back to the callback with these query parameters."""
        q = {k: v[0] for k, v in parse_qs(urlparse(authorize_url).query).items()}
        assert authorize_url.startswith(providers.OPENAI_AUTHORIZE)
        assert q["redirect_uri"] == f"http://127.0.0.1:{config.PORT}/auth/callback"
        assert q["code_challenge_method"] == "S256"
        assert q["resource"] == "https://api.openai.com/v1"
        assert set(q["scope"].split()) == set(FULL_SCOPE.split())
        assert q["ext_agent_host_id"].startswith("urn:uuid:")
        client = q["client_id"]
        back = {}
        if client == providers.DYNAMIC_CLIENT:
            assert q["agent_name_hint"] == "Troubadour"
            self.registrations += 1
            client = f"oaiapp_{self.registrations}"
            back["client_id"] = client
        else:
            assert "agent_name_hint" not in q
        code = uuid.uuid4().hex
        self.codes[code] = {
            "challenge": q["code_challenge"],
            "client": client,
            "nonce": q["nonce"],
            "redirect": q["redirect_uri"],
        }
        return {"code": code, "state": q["state"], **back}

    def id_token(self, client: str, nonce: str) -> str:
        now = int(time.time()) + self.clock_skew
        claims = {"iss": ISSUER, "aud": client, "sub": self.sub, "email": self.email, "iat": now, "exp": now + 3600}
        claims["nonce"] = self.nonce_override or nonce
        return jwt.encode(claims, self.key, algorithm="RS256", headers={"kid": "k1"})

    def _issue(self, client: str, nonce: str) -> dict:
        refresh = f"rt-{uuid.uuid4().hex}"
        self.refresh[refresh] = client
        return {
            "access_token": f"at-{uuid.uuid4().hex}",
            "refresh_token": refresh,
            "id_token": self.id_token(client, nonce),
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": self.scope,
        }

    def handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == providers.OPENAI_DISCOVERY:
            return httpx.Response(200, json={"jwks_uri": f"{ISSUER}/jwks", "revocation_endpoint": f"{ISSUER}/oauth/revoke"})
        if url == f"{ISSUER}/jwks":
            jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
            return httpx.Response(200, json={"keys": [jwk | {"kid": "k1", "use": "sig", "alg": "RS256"}]})
        form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
        if url == f"{ISSUER}/oauth/revoke":
            self.revoked.append(form["token"])
            return httpx.Response(200)
        assert url == providers.OPENAI_TOKEN, url
        assert form["resource"] == "https://api.openai.com/v1"
        if form["grant_type"] == "authorization_code":
            pending = self.codes.pop(form["code"], None)
            if not pending or s256(form["code_verifier"]) != pending["challenge"] or form["client_id"] != pending["client"]:
                return httpx.Response(400, json={"error": "invalid_grant"})
            assert form["redirect_uri"] == pending["redirect"]
            return httpx.Response(200, json=self._issue(pending["client"], pending["nonce"]))
        client = self.refresh.pop(form["refresh_token"], None)
        if client != form["client_id"]:
            return httpx.Response(400, json={"error": "invalid_grant"})
        return httpx.Response(200, json=self._issue(client, "") | {"id_token": None})


@pytest.fixture
def openai(dirs):
    fake = FakeOpenAI()
    return fake, Accounts(http=httpx.Client(transport=fake.transport()))


def sign_in(fake: FakeOpenAI, accounts: Accounts, fresh: bool = False) -> bool:
    back = fake.approve(accounts.start_login("openai", fresh=fresh))
    return accounts.finish_login("openai", back["code"], back["state"], client_id=back.get("client_id", ""))


def test_sign_in_with_chatgpt_registers_once_and_keeps_secrets_private(openai):
    fake, accounts = openai
    assert sign_in(fake, accounts) is True  # the first time: the "You're using your ChatGPT plan" page
    assert accounts.status()["openai"] == {"connected": True, "account": "gm@example.com", "known_account": "gm@example.com"}
    saved = json.loads(accounts.path().read_text())
    assert saved["openai"]["client_id"] == "oaiapp_1"
    assert_mode(accounts.path(), 0o600)
    host = saved["host_id"]
    # Signing in again reuses the registration and this computer's host id, and says hello only once.
    url = accounts.start_login("openai")
    q = parse_qs(urlparse(url).query)
    assert q["client_id"] == ["oaiapp_1"]
    assert q["ext_agent_host_id"] == [host]
    assert q["login_hint"] == ["gm@example.com"]
    back = fake.approve(url)
    assert accounts.finish_login("openai", back["code"], back["state"]) is False
    assert fake.registrations == 1


def test_a_forged_or_replayed_id_token_is_refused(openai):
    fake, accounts = openai
    fake.nonce_override = "someone-elses-nonce"
    with pytest.raises(ProviderError, match="verified"):
        sign_in(fake, accounts)
    assert not accounts.connected("openai")
    fake.nonce_override = None
    fake.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)  # signed with a key OpenAI didn't publish
    back = fake.approve(accounts.start_login("openai"))
    real_jwks = fake.handle

    def stale_keys(request):
        if str(request.url) == f"{ISSUER}/jwks":
            other = rsa.generate_private_key(public_exponent=65537, key_size=2048).public_key()
            return httpx.Response(200, json={"keys": [json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(other)) | {"kid": "k1"}]})
        return real_jwks(request)

    accounts.http = httpx.Client(transport=httpx.MockTransport(stale_keys))
    with pytest.raises(ProviderError, match="verified"):
        accounts.finish_login("openai", back["code"], back["state"], client_id=back["client_id"])
    assert not accounts.connected("openai")


def test_declining_plan_use_keeps_the_registration_and_asks_again(openai):
    fake, accounts = openai
    fake.scope = "email openid profile offline_access"
    with pytest.raises(ValueError, match="wasn't allowed"):
        sign_in(fake, accounts)
    assert not accounts.connected("openai")
    q = parse_qs(urlparse(accounts.start_login("openai")).query)
    assert q["client_id"] == ["oaiapp_1"]
    assert q["prompt"] == ["consent"]


def test_another_account_needs_a_fresh_registration(openai):
    fake, accounts = openai
    sign_in(fake, accounts)
    accounts.logout("openai")
    fake.sub, fake.email = "user-2", "player@example.com"
    with pytest.raises(ValueError, match="different ChatGPT account"):
        sign_in(fake, accounts)
    assert sign_in(fake, accounts, fresh=True) is True
    assert accounts.status()["openai"]["account"] == "player@example.com"
    assert fake.registrations == 2


def test_a_callback_must_match_the_sign_in_that_started_here(openai):
    fake, accounts = openai
    sign_in(fake, accounts)
    back = fake.approve(accounts.start_login("openai"))
    with pytest.raises(ProviderError, match="different registration"):
        accounts.finish_login("openai", back["code"], back["state"], client_id="oaiapp_other")
    with pytest.raises(ValueError, match="expired or didn't start here"):
        accounts.finish_login("openai", back["code"], back["state"])  # the attempt was used up
    with pytest.raises(ValueError, match="expired or didn't start here"):
        accounts.finish_login("openai", "code", "made-up-state")


def test_tokens_refresh_and_rotate_and_a_dead_refresh_signs_out(openai):
    fake, accounts = openai
    sign_in(fake, accounts)
    first = accounts.token()
    assert accounts.token() == first  # still fresh: no refresh
    renewed = accounts.token(rejected=first)  # the API refused it: refresh once
    assert renewed != first
    saved = json.loads(accounts.path().read_text())["openai"]
    assert saved["refresh_token"] in fake.refresh  # the rotated one
    assert saved["id_token"]  # a refresh without an ID token keeps the last one
    fake.refresh.clear()  # revoked at OpenAI (say, disconnected in ChatGPT's settings)
    with pytest.raises(NotConnected):
        accounts.token(rejected=renewed)
    saved = json.loads(accounts.path().read_text())
    assert "access_token" not in saved["openai"]
    assert saved["openai"]["client_id"] == "oaiapp_1"
    assert saved["host_id"]


def test_sign_out_revokes_the_session_and_keeps_the_registration(openai):
    fake, accounts = openai
    sign_in(fake, accounts)
    refresh = json.loads(accounts.path().read_text())["openai"]["refresh_token"]
    assert accounts.logout("openai") is True
    assert fake.revoked == [refresh]
    assert accounts.status()["openai"] == {"connected": False, "account": None, "known_account": "gm@example.com"}
    q = parse_qs(urlparse(accounts.start_login("openai")).query)
    assert q["client_id"] == ["oaiapp_1"]
    assert "id_token_hint" not in q


def test_openrouter_sign_in_mints_a_key(dirs):
    seen = {}

    def handle(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == providers.OPENROUTER_KEYS
        body = json.loads(request.content)
        if s256(body["code_verifier"]) != seen["challenge"] or body["code"] != "the-code":
            return httpx.Response(403, json={"error": "Invalid code or code_verifier"})
        return httpx.Response(200, json={"key": "sk-or-v1-abcd1234"})

    accounts = Accounts(http=httpx.Client(transport=httpx.MockTransport(handle)))
    q = {k: v[0] for k, v in parse_qs(urlparse(accounts.start_login("openrouter")).query).items()}
    assert q["callback_url"] == f"http://localhost:{config.PORT}/api/llm/openrouter/callback"
    assert q["code_challenge_method"] == "S256"
    seen["challenge"] = q["code_challenge"]
    accounts.finish_login("openrouter", "the-code", q["state"])
    assert accounts.key("openrouter") == "sk-or-v1-abcd1234"
    assert accounts.status()["openrouter"]["account"] == "key …1234"


def test_pasted_keys(dirs):
    accounts = Accounts(http=httpx.Client(transport=httpx.MockTransport(lambda r: pytest.fail("no network for keys"))))
    with pytest.raises(NotConnected):
        accounts.key("deepseek")
    accounts.set_key("deepseek", "  sk-deep-5678 ")
    assert accounts.key("deepseek") == "sk-deep-5678"
    for bad in ("", "has space", "x" * 401, "line\nbreak"):
        with pytest.raises(ValueError, match="API key"):
            accounts.set_key("anthropic", bad)
    with pytest.raises(KeyError):
        accounts.set_key("openai", "sk-nope")  # ChatGPT is a sign-in, never a key
    accounts.logout("deepseek")
    assert not accounts.connected("deepseek")


# ------------------------------------------------------------------ wire formats


def sse(*events: dict) -> bytes:
    return b"".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n".encode() for e in events)


def chatgpt_llm(handler, tokens: list) -> mem.MemoryLLM:
    def token(rejected=None):
        tokens.append(rejected)
        return "at-2" if rejected else "at-1"

    llm = mem.MemoryLLM(url="https://api.openai.com/v1", model="gpt-test", wire="responses", token=token)
    llm.client = httpx.Client(transport=httpx.MockTransport(handler))
    return llm


def test_chatgpt_plan_requests_stream_without_storing(monkeypatch):
    monkeypatch.setattr(mem, "LLM_RETRY_WAIT_S", 0)
    sent = []

    def handle(request: httpx.Request) -> httpx.Response:
        sent.append((request.headers["authorization"], json.loads(request.content)))
        if request.headers["authorization"] == "Bearer at-1":
            return httpx.Response(401, json={"detail": "expired"})
        deltas = [{"type": "response.output_text.delta", "delta": part} for part in ('{"ok"', ": 1}")]
        return httpx.Response(200, content=sse(*deltas, {"type": "response.completed", "response": {}}))

    tokens = []
    assert chatgpt_llm(handle, tokens).json("sys", "user", {"type": "object"}) == {"ok": 1}
    assert tokens == [None, "at-1"]  # refreshed once after the 401
    payload = sent[-1][1]
    assert payload["store"] is False
    assert payload["stream"] is True
    assert payload["instructions"] == "sys"
    assert payload["input"] == [{"role": "user", "content": "user"}]
    assert not {"temperature", "max_output_tokens", "max_tokens"} & payload.keys()


def test_a_rate_limit_is_waited_out_but_a_used_up_plan_is_not(monkeypatch):
    monkeypatch.setattr(mem, "LLM_RETRY_WAIT_S", 0)
    replies = [
        httpx.Response(429, json={"error": {"message": "slow down"}}),
        httpx.Response(200, json={"choices": [{"message": {"content": '{"ok": 1}'}}]}),
    ]
    llm = mem.MemoryLLM(url="https://openrouter.test/api/v1", model="m", api_key="k")
    llm.client = httpx.Client(transport=httpx.MockTransport(lambda r: replies.pop(0)))
    assert llm.json("s", "u", {}) == {"ok": 1}
    sent = []

    def used_up(request):
        sent.append(request)
        return httpx.Response(429, json={"error": {"code": "subscription_sharing_usage_limit_exceeded"}})

    with pytest.raises(ProviderError, match="settings/usage"):
        chatgpt_llm(used_up, []).json("s", "u", {})
    assert len(sent) == 1


def test_a_clock_a_little_off_still_signs_in(openai):
    fake, accounts = openai
    fake.clock_skew = 30  # OpenAI's clock 30 s ahead of this computer's: the ID token is "issued in the future"
    assert sign_in(fake, accounts) is True


def test_chatgpt_usage_limit_says_where_to_manage_it():
    failed = {"type": "response.failed", "response": {"error": {"code": "subscription_sharing_usage_limit_exceeded"}}}
    llm = chatgpt_llm(
        lambda r: httpx.Response(200, content=sse({"type": "response.output_text.delta", "delta": "{"}, failed)), []
    )
    with pytest.raises(ProviderError, match="chatgpt.com/settings/usage"):
        llm.json("s", "u", {})
    cut = chatgpt_llm(lambda r: httpx.Response(200, content=sse({"type": "response.output_text.delta", "delta": "{"})), [])
    with pytest.raises(ProviderError, match="stopped before finishing"):
        cut.json("s", "u", {})
    refused = chatgpt_llm(lambda r: httpx.Response(403, json={"error": {"code": "subscription_sharing_user_not_eligible"}}), [])
    with pytest.raises(ProviderError, match="Go, Plus or Pro"):
        refused.json("s", "u", {})


def test_chatgpt_catalog_lists_only_pickable_models():
    body = {"models": [{"slug": "gpt-a", "visibility": "list"}, {"slug": "internal", "visibility": "hide"}, "junk"]}
    assert providers.model_ids("responses", body) == ["gpt-a"]
    assert providers.model_ids("chat", {"data": [{"id": "m1"}, {"id": 3}]}) == ["m1"]


def test_model_lists_carry_names_and_openrouter_prices():
    body = {"models": [{"slug": "gpt-a", "display_name": "GPT A", "visibility": "list"}]}
    assert providers.models("responses", body) == [{"id": "gpt-a", "name": "GPT A", "price": None}]
    openrouter = {
        "data": [
            {"id": "a/sonnet", "name": "Sonnet", "pricing": {"prompt": "0.000003", "completion": "0.000015"}},
            {"id": "a/free", "name": "Free one", "pricing": {"prompt": "0", "completion": "0"}},
            {"id": "openrouter/auto", "name": "Auto", "pricing": {"prompt": "-1", "completion": "-1"}},
            {"id": "odd", "pricing": {"prompt": "nan", "completion": "x"}},
            {"id": "tiny", "pricing": {"prompt": "0.000000002", "completion": "0.00000001"}},
        ]
    }
    assert [(m["name"], m["price"]) for m in providers.models("chat", openrouter)] == [
        ("Sonnet", "$3.00 in · $15.00 out per 1M tokens"),
        ("Free one", "free"),
        ("Auto", None),
        ("odd", None),
        ("tiny", "$0.002 in · $0.01 out per 1M tokens"),
    ]
    assert providers.model_ids("chat", {"data": "nope"}) == []


def test_anthropic_messages_with_a_schema_and_without(monkeypatch):
    monkeypatch.setattr(mem, "LLM_RETRY_WAIT_S", 0)
    sent = []

    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        sent.append((dict(request.headers), body))
        assert str(request.url) == "https://api.anthropic.com/v1/messages"
        if "output_config" in body:
            return httpx.Response(400, json={"type": "error", "error": {"message": "schema keyword not supported"}})
        return httpx.Response(200, json={"content": [{"type": "text", "text": 'Here: {"ok": 2}'}], "stop_reason": "end_turn"})

    llm = mem.MemoryLLM(url="https://api.anthropic.com/v1", model="claude-test", api_key="sk-ant-1", wire="anthropic")
    llm.client = httpx.Client(transport=httpx.MockTransport(handle))
    assert llm.json("sys", "user", {"type": "object"}, 500) == {"ok": 2}
    headers, first = sent[0]
    assert headers["x-api-key"] == "sk-ant-1"
    assert headers["anthropic-version"] == providers.ANTHROPIC_VERSION
    assert "authorization" not in headers
    assert "temperature" not in first
    assert first["system"] == "sys"
    assert first["max_tokens"] == 500 + mem.REASONING_HEADROOM
    assert "output_config" not in sent[1][1]


# ------------------------------------------------------------------ endpoints


@pytest.fixture
def api(dirs, monkeypatch):
    fake = FakeOpenAI()
    monkeypatch.setattr(deps, "accounts", Accounts(http=httpx.Client(transport=fake.transport())))
    monkeypatch.setattr(deps, "_installed_llms", list)  # never this computer's LM Studio
    events = []
    monkeypatch.setattr(deps.bus, "emit", lambda kind, data: events.append((kind, data)))
    # Never a real health check from these tests; record that one was asked for.
    monkeypatch.setattr(deps, "_recheck_llm_soon", lambda: events.append(("recheck", None)))
    llms = (deps.engine.cleanup_llm, deps.memory.llm, deps.asker.llm)
    before = [dict(vars(llm)) for llm in llms]
    yield TestClient(app, base_url=LOCAL), fake, events
    for llm, saved in zip(llms, before, strict=True):
        vars(llm).clear()
        vars(llm).update(saved)


def test_a_provider_needs_a_sign_in_or_key_before_it_is_chosen(api):
    client, _, _ = api
    r = client.put("/api/settings/models", json={"provider": "anthropic"})
    assert r.status_code == 400
    assert "Add a key for Anthropic API" in r.json()["detail"]
    r = client.put("/api/settings/models", json={"provider": "openai"})
    assert r.status_code == 400
    assert "Sign in to ChatGPT plan" in r.json()["detail"]
    assert client.put("/api/settings/models", json={"provider": "elsewhere"}).status_code == 400


def test_chatgpt_needs_both_models_chosen(api):
    client, fake, _ = api
    sign_in(fake, deps.accounts)
    r = client.put("/api/settings/models", json={"provider": "openai"})  # ChatGPT has no default models
    assert r.status_code == 400
    assert "Choose both models for ChatGPT plan" in r.json()["detail"]
    r = client.put("/api/settings/models", json={"provider": "openai", "hosted": {"openai": {"llm": "gpt-a"}}})
    assert r.status_code == 400
    r = client.put("/api/settings/models", json={"provider": "openai", "hosted": {"openai": {"llm": "a", "memory": "b"}}})
    assert r.status_code == 200


def test_a_key_moves_every_llm_to_the_provider_and_signing_out_brings_it_home(api):
    client, _, events = api
    r = client.put("/api/llm/anthropic/key", json={"key": "sk-ant-secret-9876"})
    assert r.status_code == 200
    assert ("recheck", None) in events  # the header's status follows the new key without waiting 30 s
    assert next(p for p in r.json() if p["id"] == "anthropic")["account"] == "key …9876"
    r = client.put("/api/settings/models", json={"provider": "anthropic", "hosted": {"anthropic": {"memory": "claude-big"}}})
    assert r.status_code == 200, r.text
    assert "sk-ant-secret-9876" not in r.text
    assert r.json()["provider"] == "anthropic"
    live, memory_llm = deps.engine.cleanup_llm, deps.memory.llm
    assert (live.wire, live.url, live.api_key, live.model) == (
        "anthropic",
        "https://api.anthropic.com/v1",
        "sk-ant-secret-9876",
        "claude-haiku-5-5",
    )
    assert (memory_llm.model, deps.asker.llm.model) == ("claude-big", "claude-big")
    r = client.post("/api/llm/anthropic/disconnect")
    assert r.status_code == 200
    assert r.json()["revoked"] is True
    assert settings.current()["provider"] == "local"
    assert (live.wire, live.url, live.api_key) == ("chat", settings.current()["llm_url"], "")
    assert events[-1][0] == "llm.updated"
    assert events[-1][1]["provider"] == "local"
    # The choice of models for Anthropic is kept for next time.
    assert settings.current()["hosted"]["anthropic"]["memory"] == "claude-big"


def test_chatgpt_sign_in_through_the_server(api):
    client, fake, events = api
    r = client.post("/api/llm/openai/connect")
    assert r.status_code == 200
    back = fake.approve(r.json()["authorize_url"])
    page = client.get("/auth/callback", params=back)
    assert page.status_code == 200
    assert "You&#x27;re using your ChatGPT plan" in page.text
    assert events[-1][0] == "llm.updated"
    assert next(p for p in events[-1][1]["providers"] if p["id"] == "openai")["account"] == "gm@example.com"
    r = client.put("/api/settings/models", json={"provider": "openai", "hosted": {"openai": {"llm": "gpt-a", "memory": "gpt-b"}}})
    assert r.status_code == 200, r.text
    live = deps.engine.cleanup_llm
    assert (live.wire, live.url, live.model) == ("responses", "https://api.openai.com/v1", "gpt-a")
    assert live.token() == deps.accounts.token()
    assert "ChatGPT plan: not connected" in client.get("/auth/callback", params={"code": "x", "state": "nope"}).text
    assert client.post("/api/llm/deepseek/connect").status_code == 404  # a key, not a sign-in


def test_rescan_asks_the_typed_local_server_for_its_models(api, monkeypatch):
    client, _, _ = api
    asked = []

    def get(url, headers, timeout):
        asked.append((url, headers))
        if "10.0.0.8" in url:
            raise httpx.ConnectError("refused")
        return httpx.Response(200, json={"data": [{"id": "qwen3.8-27b"}, {"id": 7}, {"id": "gemma-4-26b"}]})

    monkeypatch.setattr(llm_router.httpx, "get", get)
    r = client.post("/api/llm/local/models", json={"llm_url": "1235", "api_key": " k1 "})
    assert r.status_code == 200
    body = r.json()
    assert body["installed"][:2] == ["qwen3.8-27b", "gemma-4-26b"]  # then the models chosen here before
    assert (body["found"], body["error"]) == (2, None)
    assert asked[-1] == ("http://127.0.0.1:1235/v1/models", {"Authorization": "Bearer k1"})

    r = client.post("/api/llm/local/models", json={"llm_url": "10.0.0.8:1234"})
    assert (r.json()["found"], r.json()["error"]) == (0, "Couldn't reach http://10.0.0.8:1234/v1 (ConnectError).")
    assert client.post("/api/llm/local/models", json={"llm_url": "ftp://x"}).status_code == 400


def test_local_servers_lists_the_usual_ports_and_which_answer(api, monkeypatch):
    client, _, _ = api

    def get(url, timeout):
        if ":8000/" in url:
            return httpx.Response(200, json={"data": [{"id": "qwen"}, {"id": "gemma"}]})
        if ":11434/" in url:
            return httpx.Response(500)
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(llm_router.httpx, "get", get)
    rows = {r["port"]: r for r in client.get("/api/llm/local/servers").json()}
    assert rows[8000] == {"port": 8000, "name": "MTPLX / vLLM", "url": "http://127.0.0.1:8000/v1", "running": True, "models": 2}
    assert (rows[11434]["running"], rows[1234]["running"]) == (False, False)
    assert rows[1235]["name"] == "Saved server"  # the default address isn't one of the usual ports


def test_the_write_up_model_can_use_another_local_server(api):
    client, _, _ = api
    r = client.put("/api/settings/models", json={"llm_url": "1235", "memory_url": "8000", "llm": "gemma", "memory": "qwen"})
    assert r.status_code == 200, r.text
    assert r.json()["memory_url"] == "http://127.0.0.1:8000/v1"
    assert (deps.engine.cleanup_llm.url, deps.engine.cleanup_llm.model) == ("http://127.0.0.1:1235/v1", "gemma")
    assert (deps.memory.llm.url, deps.memory.llm.model) == ("http://127.0.0.1:8000/v1", "qwen")
    assert deps.asker.llm.url == "http://127.0.0.1:8000/v1"
    client.put("/api/settings/models", json={"memory_url": ""})  # auto: the live-spelling server again
    assert deps.memory.llm.url == "http://127.0.0.1:1235/v1"
    assert client.put("/api/settings/models", json={"memory_url": "ftp://x"}).status_code == 400


def test_the_api_key_is_never_sent_back_and_an_empty_one_keeps_it(api):
    client, _, _ = api
    r = client.put("/api/settings/models", json={"llm_url": "1235", "api_key": "lm-secret-123"})
    assert r.status_code == 200, r.text
    assert "lm-secret-123" not in r.text
    assert (r.json()["has_api_key"], "api_key" in r.json()) == (True, False)
    got = client.get("/api/settings/models")
    assert "lm-secret-123" not in got.text
    assert got.json()["has_api_key"] is True
    # Saving the form without retyping the key keeps it, and it still reaches the live model.
    assert client.put("/api/settings/models", json={"api_key": "", "llm": "gemma"}).json()["has_api_key"] is True
    assert settings.current()["api_key"] == "lm-secret-123"
    assert deps.engine.cleanup_llm.api_key == "lm-secret-123"
    assert client.put("/api/settings/models", json={"api_key": "new-key"}).status_code == 200
    assert settings.current()["api_key"] == "new-key"


def test_models_fields_are_capped_and_whisper_comes_from_the_menu(api):
    client, _, _ = api
    for field in ("whisper", "whisper_improve", "llm", "memory"):
        assert client.put("/api/settings/models", json={field: "x" * 201}).status_code == 422, field
    assert client.put("/api/settings/models", json={"llm_url": "1" * 301}).status_code == 422
    assert client.put("/api/settings/models", json={"api_key": "k" * 401}).status_code == 422
    r = client.put("/api/settings/models", json={"whisper": "someone/else"})
    assert r.status_code == 422
    assert client.put("/api/settings/models", json={"whisper_improve": "someone/else"}).status_code == 422
    assert client.put("/api/settings/models", json={"whisper": settings.WHISPER_OPTIONS[-1]["id"]}).status_code == 200


def test_a_blank_scan_key_uses_the_saved_key_only_for_the_saved_server(api, monkeypatch):
    client, _, _ = api
    client.put("/api/settings/models", json={"llm_url": "1235", "api_key": "lm-secret-123"})
    seen = []
    monkeypatch.setattr(deps, "_scan_llms", lambda url, key: (seen.append((url, key)) or [], None))
    client.post("/api/llm/local/models", json={"llm_url": "1235"})
    client.post("/api/llm/local/models", json={"llm_url": "http://10.0.0.8:1234/v1"})
    assert seen == [("http://127.0.0.1:1235/v1", "lm-secret-123"), ("http://10.0.0.8:1234/v1", "")]
