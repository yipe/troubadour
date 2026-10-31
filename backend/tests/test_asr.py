"""The prompt guard around Whisper (the model itself is stubbed)."""

import sys
import types

import numpy as np
import pytest
from troubadour.core import config
from troubadour.sound import asr, asr_ct2, asr_mlx

PROMPT = "A D&D session. Elara, Auggie, Kessia, Magenta. Initiative, perception check, saving throw."


@pytest.fixture
def calls(monkeypatch):
    seen: list[str | None] = []

    def fake(answers):
        def run(audio, prompt, model=None):
            seen.append(prompt)
            return answers[prompt is not None]

        monkeypatch.setattr(asr, "_run", run)

    return seen, fake


@pytest.mark.parametrize(
    ("prompted", "expected"),
    [
        ("Auggie four, Elara three.", "Auggie four, Elara three."),  # names used normally: kept
        ("Magenta. Initiative, perception check, saving throw.", "plain"),  # the prompt read back
        ("epipopeopeopeopeopeopeopeopeopeop", "plain"),  # a loop
        ("no no no no no no no no no no", "plain"),  # a loop
        ("Auggie, Kessia, Magenta, Nora.", "plain"),  # the prompt's name list, from noise
        ("Elara, four.", "Elara, four."),  # short, but real speech
    ],
)
def test_suspicious_prompted_results_are_redone_without_the_prompt(calls, prompted, expected):
    seen, fake = calls
    fake({True: prompted, False: "plain"})
    assert asr.transcribe(np.zeros(16000, np.float32), PROMPT) == expected
    assert seen[0] == PROMPT
    assert len(seen) == (1 if expected == prompted else 2)


def test_no_prompt_means_one_call(calls):
    seen, fake = calls
    fake({False: "hello"})
    assert asr.transcribe(np.zeros(16000, np.float32)) == "hello"
    assert seen == [None]


# 80 made-up names: far more than fit in Whisper's prompt window.
GLOSSARY = [f"Name{i} Ironfoot" for i in range(80)]


def test_a_big_glossary_still_fits_whispers_prompt_window_with_the_first_names_kept():
    lines = ["word " * 150, "Grukk hits the ogre for twelve slashing damage."]
    p = asr.build_prompt(["Elara", "Auggie", *GLOSSARY], lines)
    assert asr.prompt_tokens(p) <= asr.PROMPT_TOKENS
    assert p.startswith("A D&D session. Elara, Auggie, Name0 Ironfoot,")
    assert p.endswith("Grukk hits the ogre for twelve slashing damage.")  # the newest words stay
    tail = p.split("saving throw. ", 1)[1]
    assert asr.prompt_tokens(tail) <= asr.CONTEXT_TOKENS
    assert "Name79" not in p  # what doesn't fit is left out, from the end


def test_a_short_prompt_is_unchanged():
    assert asr.build_prompt(["Elara", "Magenta"], ["line 1", "line 2"]) == (
        "A D&D session. Elara, Magenta. Initiative, perception check, saving throw. line 1 line 2"
    )
    assert asr.build_prompt([], []) == "A D&D session. Initiative, perception check, saving throw."


def test_names_said_lately_come_right_after_the_tables_names():
    names = asr.prompt_names(
        ["Elara", "Theo"],
        ["Magenta", "Brine Marshes", "Name1 Ironfoot", "Elara", "Crebshank"],
        ["We reach the brine marshes.", "Crebshank waves. Magentas everywhere."],  # oldest first
    )
    # Crebshank is the latest; "Magentas" isn't "Magenta"; Elara is already first.
    assert names == ["Elara", "Theo", "Crebshank", "Brine Marshes", "Magenta", "Name1 Ironfoot"]


def test_a_nickname_said_lately_goes_in_as_said():
    names = asr.prompt_names(
        ["Elara"],
        ["Phishondra", "Faryn Castellan", "Brine Marshes"],
        ["Hey Phisho, ask Faryn."],
        nicknames=["Phisho", "Faryn"],
    )
    assert names == ["Elara", "Phisho", "Faryn", "Phishondra", "Faryn Castellan", "Brine Marshes"]


def test_the_longest_name_said_wins():
    names = asr.prompt_names([], ["Ten Proof", "Ten Proof Babadabroose", "Oola"], ["ten proof babadabroose swings"])
    assert names == ["Ten Proof Babadabroose", "Ten Proof", "Oola"]


def test_segments_in_another_script_are_dropped(monkeypatch):
    segments = [{"text": " What's your AC? 18."}, {"text": " ож Kobe Thank you."}, {"text": " Café crème, señor."}]
    fake = types.SimpleNamespace(segments=lambda audio, model, prompt: segments)
    monkeypatch.setattr(asr, "_backend", lambda: fake)
    assert asr.transcribe(np.zeros(16000 * 3, np.float32)) == "What's your AC? 18. Café crème, señor."


def test_the_backend_follows_the_machine(monkeypatch):
    asr._backend.cache_clear()
    monkeypatch.setattr(config, "MLX", False)
    assert asr._backend() is asr_ct2
    asr._backend.cache_clear()
    monkeypatch.setattr(config, "MLX", True)
    assert asr._backend() is asr_mlx
    asr._backend.cache_clear()


def test_prompts_are_counted_like_mlx_whisper_counts_them():
    tokenizer = pytest.importorskip("mlx_whisper.tokenizer").get_tokenizer(multilingual=True, num_languages=100)
    for text in (PROMPT, "Ünïcödé café: 12 slashing 🐉 “quotes”", "  spaced  out  ", ""):
        assert asr.prompt_tokens(text) == len(tokenizer.encode(" " + text.strip())), text


class FakeWhisper:
    """faster_whisper.WhisperModel: records where it loaded; `broken` devices fail on first use."""

    broken: set[str] = set()
    made: list[tuple[str, str, str]] = []

    def __init__(self, model, device, compute_type):
        self.device = device
        FakeWhisper.made.append((model, device, compute_type))

    def transcribe(self, audio, **kw):
        if self.device in FakeWhisper.broken:
            raise RuntimeError("Library libcublas.so.12 is not found")
        seg = types.SimpleNamespace(text=" Roll initiative.", no_speech_prob=0.1, avg_logprob=-0.2)
        return iter([seg]), None


@pytest.fixture
def ct2(monkeypatch):
    """asr_ct2 with fake faster_whisper / ctranslate2 modules; returns a setter for the GPU count."""
    gpus = [0]
    FakeWhisper.made, FakeWhisper.broken = [], set()
    monkeypatch.setitem(sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=FakeWhisper))
    monkeypatch.setitem(sys.modules, "ctranslate2", types.SimpleNamespace(get_cuda_device_count=lambda: gpus[0]))
    monkeypatch.setattr(asr_ct2, "_loaded", None)
    return lambda n: gpus.__setitem__(0, n)


def test_faster_whisper_runs_int8_on_the_cpu_without_a_gpu(ct2):
    out = asr_ct2.segments(np.zeros(16000, np.float32), "small", "A D&D session.")
    assert out == [{"text": " Roll initiative.", "no_speech_prob": 0.1, "avg_logprob": -0.2}]
    assert FakeWhisper.made == [("small", "cpu", "int8")]


def test_faster_whisper_uses_the_gpu_and_falls_back_when_its_libraries_are_missing(ct2):
    ct2(1)
    asr_ct2.segments(np.zeros(16000, np.float32), "large-v3-turbo", None)
    assert FakeWhisper.made == [("large-v3-turbo", "cuda", "float16")]
    FakeWhisper.made, FakeWhisper.broken = [], {"cuda"}
    asr_ct2.segments(np.zeros(16000, np.float32), "large-v3", None)  # another model: loaded fresh
    assert FakeWhisper.made == [("large-v3", "cuda", "float16"), ("large-v3", "cpu", "int8")]


def test_faster_whisper_keeps_one_model_loaded(ct2):
    for model in ("small", "small", "large-v3-turbo", "large-v3-turbo"):
        asr_ct2.segments(np.zeros(16000, np.float32), model, None)
    assert [m for m, _, _ in FakeWhisper.made] == ["small", "large-v3-turbo"]


@pytest.mark.parametrize(
    ("prompted", "plain", "expected"),
    [
        ("We'll see you all again next week, friends.", "Okay.", "Okay."),  # 7 words in 0.5 s: redone
        ("We'll see you all again next week, friends.", "And then we all go home now.", ""),  # still too fast
        ("Nat twenty!", "x", "Nat twenty!"),  # 2 words in 0.5 s is fine
    ],
)
def test_more_words_than_fit_in_the_clip_are_invented(calls, prompted, plain, expected):
    _, fake = calls
    fake({True: prompted, False: plain})
    assert asr.transcribe(np.zeros(8000, np.float32), PROMPT) == expected
