# troubadour-engine

The live session engine (`live.py`, re-exported by `__init__`), improve, voice cloning, `troubadour-sim`.

- May import `core`, `sound`, `lore` and `cloud`. Never `server`.
- Patch a symbol where it is used (`troubadour.engine.live.X`); a patch on a re-export does nothing.
- Never start real mic sessions in tests; the mic is faked.
- Tests: `test_engine.py`, `test_recording.py`, `test_improve.py`, `test_cloning.py`.
