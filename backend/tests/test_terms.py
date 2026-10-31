"""The D&D term list: the user's own terms, the read-only local list, the built-in names, and /api/terms."""

import json

import pytest
from fastapi.testclient import TestClient
from troubadour.lore import campaign, dnd_terms
from troubadour.server.app import app


@pytest.fixture
def files(tmp_path, monkeypatch):
    """Real term files in a tmp dir, and a small dictionary so "table" is an everyday word."""
    local, mine = tmp_path / "local.json", tmp_path / "mine.json"
    monkeypatch.setattr(dnd_terms, "generated_path", lambda: local)
    monkeypatch.setattr(dnd_terms, "custom_path", lambda: mine)
    monkeypatch.setattr(campaign, "_DICT", frozenset({"table", "garden"}))
    return local, mine


@pytest.fixture
def client(files):
    return TestClient(app, base_url="http://127.0.0.1:8765")


def names(source=None):
    return [n for n, _ in (dnd_terms.custom() if source == "custom" else dnd_terms.terms())]


def test_add_and_remove_a_custom_term(files):
    added, skipped = dnd_terms.add_custom([("Zorbo the Wise", "npc"), ("  Quillfeather  ", "creature")])
    assert added == [("Zorbo the Wise", "npc"), ("Quillfeather", "creature")]
    assert skipped == []
    assert names()[:2] == ["Zorbo the Wise", "Quillfeather"]  # custom comes first
    assert "Fireball" in names()  # the built-in names stay
    dnd_terms.remove_custom("zorbo the wise")
    assert "Zorbo the Wise" not in names()
    with pytest.raises(KeyError):
        dnd_terms.remove_custom("Fireball")  # built-in: not removable


def test_dedupe_against_builtin_local_and_itself(files):
    local, _ = files
    local.write_text(json.dumps({"terms": [["Zorbo", "creature"], ["Fireball", "spell"]]}))
    added, skipped = dnd_terms.add_custom([("zorbo", "npc"), ("FIREBALL", "spell"), ("Mirvane", "npc"), ("mirvane", "npc")])
    assert [n for n, _ in added] == ["Mirvane"]
    assert {n for n, _ in skipped} == {"zorbo", "FIREBALL", "mirvane"}
    assert all(r == "already in the list" for _, r in skipped)
    assert [n.casefold() for n in names()].count("fireball") == 1


def test_the_custom_entry_wins_over_a_local_one_case_insensitively(files):
    local, mine = files
    mine.write_text(json.dumps({"terms": [["Zorbo", "npc"]]}))
    local.write_text(json.dumps({"terms": [["ZORBO", "creature"]]}))
    assert [t for t in dnd_terms.terms() if t[0].casefold() == "zorbo"] == [("Zorbo", "npc")]


def test_the_local_list_is_never_written(files):
    local, _ = files
    local.write_text(json.dumps({"terms": [["Zorbo", "creature"]]}))
    before = (local.read_bytes(), local.stat().st_mtime_ns)
    dnd_terms.add_custom([("Mirvane", "npc")])
    dnd_terms.remove_custom("Mirvane")
    assert (local.read_bytes(), local.stat().st_mtime_ns) == before


def test_everyday_words_and_bad_input_are_rejected(files):
    added, skipped = dnd_terms.add_custom(
        [
            ("Table", "term"),
            ("Garden", "item"),
            ("Light Table", "item"),
            ("", "npc"),
            ("x" * 61, "npc"),
            ("Bad\x00name", "npc"),
            ("a/b", "npc"),
            ("Mirvane", "wizard"),
        ]
    )
    assert [n for n, _ in added] == ["Light Table"]  # more than one word: not a single everyday word
    reasons = dict(skipped)
    assert "everyday" in reasons["Table"]
    assert "everyday" in reasons["Garden"]
    assert len(skipped) == 7
    assert "unknown type" in reasons["Mirvane"]


def test_custom_terms_are_capped(files, monkeypatch):
    monkeypatch.setattr(dnd_terms, "MAX_CUSTOM", 2)
    added, skipped = dnd_terms.add_custom([("Aaaa", "npc"), ("Bbbb", "npc"), ("Cccc", "npc")])
    assert len(added) == 2
    assert "limit" in skipped[0][1]


def test_the_cache_refreshes_after_an_add_and_an_outside_edit(files):
    local, _ = files
    assert "Mirvane" not in names()
    dnd_terms.add_custom([("Mirvane", "npc")])
    assert "Mirvane" in names()
    local.write_text(json.dumps({"terms": [["Zorbo", "creature"]]}))
    assert "Zorbo" in names()
    local.write_text(json.dumps({"terms": [["Zorbo", "creature"], ["Krunk", "creature"]]}))  # same mtime tick is possible
    assert "Krunk" in names()


def test_list_filters_searches_and_pages(client, files):
    local, _ = files
    local.write_text(json.dumps({"terms": [["Zorbo", "creature"]]}))
    client.post("/api/terms", json={"terms": [{"name": "Mirvane", "type": "npc"}]})
    body = client.get("/api/terms").json()
    assert body["counts"]["custom"] == 1
    assert body["counts"]["local"] == 1
    assert body["counts"]["builtin"] > 100
    assert [t["name"] for t in body["items"][:2]] == ["Mirvane", "Zorbo"]
    assert body["items"][0]["source"] == "custom"
    assert [t["name"] for t in client.get("/api/terms", params={"source": "local"}).json()["items"]] == ["Zorbo"]
    found = client.get("/api/terms", params={"q": "fireb"}).json()
    assert "Fireball" in [t["name"] for t in found["items"]]
    assert found["total"] == len(found["items"]) > 1
    assert all("fireb" in t["name"].casefold() for t in found["items"])
    page = client.get("/api/terms", params={"offset": 1, "limit": 2}).json()
    assert len(page["items"]) == 2
    assert page["total"] == sum(body["counts"].values())
    assert client.get("/api/terms", params={"limit": 201}).status_code == 422
    assert client.get("/api/terms", params={"source": "nope"}).status_code == 422


def test_add_and_remove_routes(client):
    r = client.post("/api/terms", json={"terms": [{"name": "Mirvane", "type": "npc"}, {"name": "Table", "type": "term"}]})
    assert r.status_code == 200
    assert r.json()["added"] == 1
    assert r.json()["skipped"][0]["name"] == "Table"
    assert client.post("/api/terms", json={"terms": [{"name": "x" * 61}]}).status_code == 422
    assert client.delete("/api/terms/Fireball").status_code == 404
    assert client.delete("/api/terms/mirvane").status_code == 204
    assert client.delete("/api/terms/mirvane").status_code == 404


@pytest.mark.parametrize(
    "text",
    [
        "Mirvane\nKrunk,creature\n\n",
        "name,type\nMirvane,npc\nKrunk,creature\n",
        '{"terms": [["Mirvane", "npc"], ["Krunk", "creature"]]}',
        '["Mirvane", "Krunk"]',
    ],
)
def test_upload_shapes(client, text):
    r = client.post("/api/terms/upload", content=text.encode())
    assert r.status_code == 200
    assert r.json()["added"] == 2, r.text
    assert {"Mirvane", "Krunk"} <= set(names())


def test_upload_reports_skipped_rows_and_rejects_junk(client):
    r = client.post("/api/terms/upload", content=b"Mirvane,npc\nTable\nKrunk,wizard\n")
    assert r.json()["added"] == 1
    assert {s["name"] for s in r.json()["skipped"]} == {"Table", "Krunk"}
    assert client.post("/api/terms/upload", content=b"").status_code == 400
    assert client.post("/api/terms/upload", content=b"{not json").status_code == 400
    assert client.post("/api/terms/upload", content=b'{"terms": [1]}').status_code == 400
    assert client.post("/api/terms/upload", content=b"\xff\xfe\x00").status_code == 400
    assert client.post("/api/terms/upload", content=b"a\n" * 600_000).status_code == 413


def test_a_malformed_file_is_set_aside_not_wiped(files, client):
    _, mine = files
    mine.write_text('{"terms": [["Zorbo", "npc"],')  # cut off mid-write
    r = client.post("/api/terms", json={"terms": [{"name": "Mirvane", "type": "npc"}]})
    assert r.status_code == 409
    assert "couldn't be read" in r.json()["detail"]
    kept = list(mine.parent.glob("mine.corrupt-*.json"))
    assert len(kept) == 1
    assert "Zorbo" in kept[0].read_text()
    assert not mine.exists()
    assert client.post("/api/terms", json={"terms": [{"name": "Mirvane", "type": "npc"}]}).json()["added"] == 1


def test_a_malformed_file_is_set_aside_on_remove_too(files, client):
    _, mine = files
    mine.write_text("not json")
    assert client.delete("/api/terms/Zorbo").status_code == 409
    assert len(list(mine.parent.glob("mine.corrupt-*.json"))) == 1


def test_one_bad_entry_does_not_wipe_the_good_ones(files):
    _, mine = files
    mine.write_text(json.dumps({"terms": [["Zorbo", "npc"], 7, ["only one"], ["Quill", "creature"]]}))
    assert names("custom") == ["Zorbo", "Quill"]  # reads skip only the bad entries
    added, _ = dnd_terms.add_custom([("Mirvane", "npc")])
    assert added == [("Mirvane", "npc")]
    assert names("custom") == ["Zorbo", "Quill", "Mirvane"]
    assert len(list(mine.parent.glob("mine.skipped-*.json"))) == 1  # the original, since the rewrite drops 7 and ["only one"]


def test_concurrent_adds_do_not_lose_each_other(files):
    import threading

    threads = [threading.Thread(target=dnd_terms.add_custom, args=([(f"Zorbo{'abcdefgh'[i]}", "npc")],)) for i in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(names("custom")) == 8


def test_upload_is_refused_early_on_content_length_and_deep_json_is_a_400(client):
    assert client.post("/api/terms/upload", content=b"a", headers={"content-length": "2000000"}).status_code in (400, 413)
    assert client.post("/api/terms/upload", content=b"[" * 100_000).status_code == 400
    assert client.post("/api/terms/upload", content=b"[" * 5000 + b"]" * 5000).status_code == 400


def test_a_file_without_a_terms_key_reads_as_empty_and_is_set_aside_on_write(files, client):
    _, mine = files
    mine.write_text("{}")
    assert names("custom") == []  # lookups (live spelling cleanup) must not raise KeyError
    r = client.post("/api/terms", json={"terms": [{"name": "Mirvane", "type": "npc"}]})
    assert r.status_code == 409
    assert len(list(mine.parent.glob("mine.corrupt-*.json"))) == 1
    mine.write_text("{}")
    assert client.delete("/api/terms/Zorbo").status_code == 409


def test_like_lists_the_closest_spellings_first(client):
    items = client.get("/api/terms", params={"like": "Halvard", "limit": 5}).json()["items"]
    assert "Halberd" in [t["name"] for t in items]
    assert client.get("/api/terms", params={"like": "qzxwvu"}).json()["items"] == []
