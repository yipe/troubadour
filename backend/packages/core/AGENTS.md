# troubadour-core

Config, settings, LLM provider accounts and wire formats, transcript helpers, `fsutil.write_atomic`.

- Imports: standard library and third-party only. Nothing else in `troubadour`.
- Everything local: no network except the opt-in hosted providers in `providers.py` (tests use `httpx.MockTransport`).
- `config.REPO` is found by walking up to `backend/pyproject.toml`; don't count parent levels.
- Text offsets that cross the API are UTF-16 (`transcript.utf16_offset` / `utf16_to_py`).
- Tests: `test_config.py`, `test_settings.py`, `test_providers.py`, `test_transcript.py`.
