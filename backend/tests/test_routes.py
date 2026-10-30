"""The server's full route list, pinned: a dropped route fails here, and a new one must be added on purpose."""

from fastapi.routing import APIRoute, APIWebSocketRoute
from troubadour.server.app import app

EXPECTED = [
    ("PUT", "/api/audio/monitor"),
    ("GET", "/api/campaign"),
    ("POST", "/api/campaign/ask"),
    ("POST", "/api/campaign/entities"),
    ("DELETE", "/api/campaign/entities/{name}"),
    ("GET", "/api/campaign/entities/{name}"),
    ("PATCH", "/api/campaign/entities/{name}"),
    ("POST", "/api/campaign/entities/{name}/facts"),
    ("PATCH", "/api/campaign/entities/{name}/facts"),
    ("DELETE", "/api/campaign/entities/{name}/facts/{fact_id}"),
    ("POST", "/api/campaign/entities/{name}/facts/search"),
    ("POST", "/api/campaign/entities/{name}/merge"),
    ("POST", "/api/campaign/entities/{name}/review"),
    ("POST", "/api/campaign/facts"),
    ("PATCH", "/api/campaign/facts"),
    ("DELETE", "/api/campaign/facts/{fact_id}"),
    ("POST", "/api/campaign/ignore"),
    ("DELETE", "/api/campaign/ignore/{word}"),
    ("POST", "/api/campaign/import"),
    ("GET", "/api/campaign/suggestions"),
    ("GET", "/api/campaign/timeline"),
    ("POST", "/api/campaign/writeup/{sid}"),
    ("POST", "/api/campaigns"),
    ("PATCH", "/api/campaigns/{cid}"),
    ("POST", "/api/campaigns/{cid}/open"),
    ("GET", "/api/classes"),
    ("POST", "/api/classes"),
    ("DELETE", "/api/classes/{class_id}"),
    ("PATCH", "/api/classes/{class_id}"),
    ("GET", "/api/clones"),
    ("DELETE", "/api/clones/{pid}/clips/{cid}"),
    ("GET", "/api/clones/{pid}/{name}.wav"),
    ("GET", "/api/cloud"),
    ("GET", "/api/cloud/account"),
    ("POST", "/api/cloud/backup"),
    ("GET", "/api/cloud/callback"),
    ("POST", "/api/cloud/connect"),
    ("POST", "/api/cloud/disconnect"),
    ("PUT", "/api/cloud/options"),
    ("POST", "/api/cloud/restore"),
    ("GET", "/api/cloud/history"),
    ("GET", "/api/cloud/vaults"),
    ("GET", "/api/debug/memory"),
    ("GET", "/api/files/{name}"),
    ("POST", "/api/llm/local/models"),
    ("GET", "/api/llm/local/servers"),
    ("GET", "/api/llm/models"),
    ("GET", "/api/llm/openrouter/callback"),
    ("POST", "/api/llm/recheck"),
    ("POST", "/api/llm/{provider}/connect"),
    ("POST", "/api/llm/{provider}/disconnect"),
    ("PUT", "/api/llm/{provider}/key"),
    ("POST", "/api/messages/{mid}/speaker"),
    ("POST", "/api/mic/test"),
    ("POST", "/api/mic/test/stop"),
    ("GET", "/api/mics"),
    ("PATCH", "/api/mics/{name}"),
    ("POST", "/api/players"),
    ("DELETE", "/api/players/{pid}"),
    ("PATCH", "/api/players/{pid}"),
    ("POST", "/api/players/{pid}/bench"),
    ("POST", "/api/players/{pid}/clone"),
    ("POST", "/api/players/{pid}/clone/read"),
    ("POST", "/api/players/{pid}/clone/say"),
    ("POST", "/api/players/{pid}/profile"),
    ("POST", "/api/players/{pid}/seat"),
    ("POST", "/api/players/{pid}/train"),
    ("GET", "/api/session/notebook"),
    ("POST", "/api/session/notebook/{item_id}"),
    ("POST", "/api/session/pause"),
    ("POST", "/api/session/pins"),
    ("POST", "/api/session/resume"),
    ("POST", "/api/session/start"),
    ("POST", "/api/session/stop"),
    ("GET", "/api/sessions"),
    ("POST", "/api/sessions/merge"),
    ("GET", "/api/sessions/{sid}/audio.wav"),
    ("POST", "/api/sessions/{sid}/improve"),
    ("POST", "/api/sessions/{sid}/in-character"),
    ("GET", "/api/sessions/{sid}/notebook"),
    ("GET", "/api/sessions/{sid}/review"),
    ("POST", "/api/sessions/{sid}/review/{item_id}"),
    ("GET", "/api/sessions/{sid}/quality"),
    ("POST", "/api/sessions/{sid}/restore"),
    ("POST", "/api/sessions/{sid}/reviewed"),
    ("POST", "/api/sessions/{sid}/retranscribe"),
    ("POST", "/api/sessions/{sid}/spelling"),
    ("GET", "/api/sessions/{sid}/transcript.{fmt}"),
    ("GET", "/api/settings/models"),
    ("PUT", "/api/settings/models"),
    ("GET", "/api/sources"),
    ("GET", "/api/state"),
    ("GET", "/api/storage"),
    ("POST", "/api/train/cancel"),
    ("GET", "/api/transcript.{fmt}"),
    ("POST", "/api/voices/{vid}/assign"),
    ("GET", "/api/voices/{vid}/sample.wav"),
    ("POST", "/api/voices/{vid}/unassign"),
    ("GET", "/auth/callback"),
    ("WEBSOCKET", "/ws"),
]


def _flat(routes):
    """Routes with included routers expanded (this FastAPI keeps each include as one entry)."""
    for route in routes:
        inner = getattr(route, "original_router", None)
        if inner is None:
            yield route
        else:
            yield from _flat(inner.routes)


def test_every_route_is_still_served():
    found = []
    for route in _flat(app.routes):
        if isinstance(route, APIRoute):
            found += [(method, route.path) for method in route.methods]
        elif isinstance(route, APIWebSocketRoute):
            found.append(("WEBSOCKET", route.path))
    assert sorted(found) == sorted(EXPECTED)
