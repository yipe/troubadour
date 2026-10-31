# troubadour-server

FastAPI app (`app.py`), shared singletons and helpers (`deps.py`), one router per domain (`routers/*.py`),
the built UI (`static.py`), the `troubadour` entry point (`main.py`), the OpenAPI export (`openapi.py`).

- May import every other package. Nothing imports it.
- Host/Origin checks stay on; bind to 127.0.0.1 by default.
- Every endpoint: pydantic input models with length caps, `response_model` on the output, errors mapped
  with `deps._call` (KeyError → 404, ValueError → 400). A new route goes in `tests/test_routes.py`.
- Never block a request on an LLM or Whisper: submit a job (`campaign.job`).
- Tests patch `deps.*` (the singletons), not the routers' imports.
