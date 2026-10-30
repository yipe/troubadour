# troubadour-server

FastAPI app (`app.py`) and the `troubadour` entry point (`main.py`). Serves `web/dist`.

- May import every other package. Nothing imports it.
- Host/Origin checks stay on; bind to 127.0.0.1 by default.
- Map errors with `_call`; pydantic input models with length caps on every string and list.
- Tests: `test_server.py`, `test_campaign_api.py`, `test_mics.py`, `test_providers.py`, `test_layers.py`.
