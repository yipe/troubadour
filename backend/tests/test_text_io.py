"""The app reads and writes the same bytes on every system: text files name their encoding (Windows would
otherwise use its ANSI code page), and paths that leave the app (API, notes, backups) use "/" (as_posix),
never the OS separator a str(Path) gives on Windows."""

import ast
from pathlib import Path

import pytest

PACKAGES = Path(__file__).parents[1] / "packages"
SOURCES = sorted(p for p in PACKAGES.rglob("*.py") if "__pycache__" not in p.parts)


def _mode(call: ast.Call, position: int) -> str | None:
    """The mode argument of open()/Path.open()/NamedTemporaryFile(), when it's a literal string."""
    value = next((kw.value for kw in call.keywords if kw.arg == "mode"), None)
    if value is None and len(call.args) > position:
        value = call.args[position]
    return value.value if isinstance(value, ast.Constant) and isinstance(value.value, str) else None


def problems(tree: ast.AST) -> list[tuple[int, str]]:
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = func.attr if isinstance(func, ast.Attribute) else func.id if isinstance(func, ast.Name) else ""
        has_encoding = any(kw.arg == "encoding" for kw in node.keywords)
        if name in ("read_text", "write_text") and not has_encoding:
            out.append((node.lineno, f"{name}() without encoding="))
        elif name == "open" and not has_encoding:
            # builtin open(path, mode) or Path.open(mode); os.open/wave.open etc. take other arguments
            position = 1 if isinstance(func, ast.Name) else 0
            mode = _mode(node, position)
            receiver = func.value.id if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) else ""
            if receiver in ("os", "wave", "sf", "soundfile", "gzip", "webbrowser"):
                continue
            if mode is None and isinstance(func, ast.Attribute) and not node.args and not node.keywords:
                mode = "r"
            if mode is not None and "b" not in mode:
                out.append((node.lineno, f"open({mode!r}) without encoding="))
        elif name == "NamedTemporaryFile" and not has_encoding:
            mode = _mode(node, 0) or "w+b"
            if "b" not in mode:
                out.append((node.lineno, "NamedTemporaryFile in text mode without encoding="))
        elif (
            name == "str"
            and node.args
            and isinstance(node.args[0], ast.Call)
            and isinstance(node.args[0].func, ast.Attribute)
            and node.args[0].func.attr == "relative_to"
        ):
            out.append((node.lineno, "str(x.relative_to(...)): use .as_posix()"))
    return out


@pytest.mark.parametrize("source", SOURCES, ids=lambda p: str(p.relative_to(PACKAGES)))
def test_text_files_name_their_encoding_and_paths_use_slashes(source):
    found = problems(ast.parse(source.read_bytes()))
    assert not found, "\n".join(f"{source.name}:{line}: {what}" for line, what in found)


def test_the_check_catches_what_it_should():
    code = """
Path("a").read_text()
p.write_text("x")
open("a", "w")
p.open()
tempfile.NamedTemporaryFile("w")
str(p.relative_to(root))
Path("a").read_text(encoding="utf-8")
open("a", "rb")
os.open("a", 0)
p.open("rb")
tempfile.NamedTemporaryFile()
p.relative_to(root).as_posix()
"""
    assert [line for line, _ in problems(ast.parse(code))] == [2, 3, 4, 5, 6, 7]
