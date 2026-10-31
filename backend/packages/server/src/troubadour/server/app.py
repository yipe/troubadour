"""HTTP + WebSocket API (contract: web/src/lib/types.ts). Serves web/dist when built.

Local-only by design (binds 127.0.0.1, no auth). Host and Origin checks stop
other websites open in the same browser from reading the transcript over the
WebSocket or calling mutating endpoints (CSRF / DNS rebinding).

Each domain's routes live in `routers/`; the shared objects are in `deps`.
"""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from troubadour.core import config, settings
from troubadour.server import deps
from troubadour.server.routers import (
    ask,
    audio,
    campaign,
    clones,
    cloud,
    llm,
    notebook,
    players,
    recap,
    review,
    session,
    sessions,
    state,
    storage,
    terms,
    timeline,
    voices,
)
from troubadour.server.static import WebFiles


@asynccontextmanager
async def lifespan(app: FastAPI):
    deps.bus.loop = asyncio.get_running_loop()
    llm._apply_models(settings.current())
    deps.engine.start_background()
    cloud.auto_backup.start()  # does nothing until the user connects Troubadour Cloud
    yield
    cloud.auto_backup.stop()
    deps.engine.shutdown()


app = FastAPI(title="Troubadour", lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=sorted(deps.LOCAL_HOSTS))


@app.middleware("http")
async def reject_cross_site_writes(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS") and not deps._origin_ok(request.headers.get("origin")):
        return JSONResponse({"detail": "cross-site request refused"}, status_code=403)
    return await call_next(request)


# Order matters only where paths overlap; none do today, so this is the old file's order by domain.
for router_module in (
    state,
    session,
    sessions,
    audio,
    campaign,
    ask,
    llm,
    cloud,
    players,
    clones,
    voices,
    notebook,
    review,
    timeline,
    recap,
    storage,
    terms,
):
    app.include_router(router_module.router)

if config.WEB_DIST.is_dir():  # last: its fallback answers any path nothing above claimed
    app.mount("/", WebFiles(directory=config.WEB_DIST, html=True), name="web")
