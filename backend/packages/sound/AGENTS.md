# troubadour-sound

Audio, segmenting, levels, mics, Whisper (`asr`), voiceprints, TTS. Holds every model that touches audio.

- May import `troubadour.core` only. Never `lore`, `cloud`, `engine` or `server`.
- Whisper and the speaker embedder share `asr.mlx_lock`; keep model calls under it.
- No models in tests: Whisper is stubbed (`troubadour.sound.asr.transcribe`), the embedder is a fake.
- Tests: `test_audio_bus.py`, `test_segment.py`, `test_levels.py`, `test_mics.py`, `test_asr.py`, `test_voices.py`, `test_tts.py`.
