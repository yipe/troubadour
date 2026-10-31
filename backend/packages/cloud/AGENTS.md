# troubadour-cloud

Troubadour Cloud backup (`backup.py`): uploads the vault, only after the user clicks Connect.

- May import `troubadour.core`, `lore` and `sound`. Never `engine` or `server`.
- Nothing is sent until the user connects; tests use `httpx.MockTransport` and never reach the network.
- Tests: `test_cloud.py`.
