"""A JSON-schema chat client for write-up experiments, with thinking on or off and a log of every call.

Talks to any OpenAI-compatible server (LM Studio, MTPLX, ...). Qwen-style servers turn thinking off with
`chat_template_kwargs.enable_thinking`; `reasoning_effort` alone doesn't stop it. Drop-in for MemoryLLM
where only `.json()` and `.model` are used.
"""

from __future__ import annotations

import json
import re
import threading
import time

import httpx

DEFAULT_URL = "http://127.0.0.1:8000/v1"
DEFAULT_MODEL = "mtplx-qwen38-27b-optimized-quality"
THINKING_HEADROOM = 6000


class LabLLM:
    def __init__(self, url: str = DEFAULT_URL, model: str = DEFAULT_MODEL, thinking: bool = False, timeout: float = 3600):
        self.url = url.rstrip("/")
        self.model = model
        self.thinking = thinking
        self.client = httpx.Client(timeout=timeout)
        self.calls: list[dict] = []
        self._lock = threading.Lock()

    def healthy(self) -> bool:
        try:
            return self.client.get(f"{self.url}/models", timeout=10).status_code == 200
        except httpx.HTTPError:
            return False

    def json(
        self, system: str, user: str, schema: dict, max_tokens: int = 4000, think: bool | None = None, progress=None
    ) -> dict:
        thinking = self.thinking if think is None else think
        payload = {
            "model": self.model,
            "temperature": 0,
            "max_tokens": max_tokens + (THINKING_HEADROOM if thinking else 0),
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "response_format": {"type": "json_schema", "json_schema": {"name": "out", "strict": True, "schema": schema}},
            "chat_template_kwargs": {"enable_thinking": thinking},
        }
        if not thinking:
            payload["reasoning_effort"] = "none"
        t = time.monotonic()
        body = None
        for attempt in range(4):
            try:
                r = self.client.post(f"{self.url}/chat/completions", json=payload)
                if r.status_code < 500:
                    r.raise_for_status()
                    body = r.json()
                    break
            except (httpx.ConnectError, httpx.RemoteProtocolError, httpx.ReadError):
                pass
            time.sleep(5 * (attempt + 1))
        if body is None:
            raise RuntimeError(f"{self.url} didn't answer")
        choice = body["choices"][0]
        content = choice["message"].get("content") or ""
        match = re.search(r"\{.*\}", content, re.S)
        try:
            out = json.loads(match.group(0)) if match else {}
        except json.JSONDecodeError:
            out = {}
        with self._lock:
            self.calls.append(
                {
                    "system": system[:80],
                    "user_chars": len(user),
                    "seconds": round(time.monotonic() - t, 1),
                    "usage": body.get("usage"),
                    "finish": choice.get("finish_reason"),
                    "parsed": bool(out),
                    "reply": content,
                }
            )
        return out if isinstance(out, dict) else {}
