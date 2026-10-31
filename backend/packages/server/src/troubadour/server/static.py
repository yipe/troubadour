"""The built web UI and its single-page-app fallback."""

from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException


class WebFiles(StaticFiles):
    """The built UI. Hashed /assets/* never change; index.html must be revalidated so a rebuild shows
    up on reload. Unknown paths outside /api and /assets are UI routes (/history/<id>, …): they get
    index.html so deep links and reloads work."""

    async def get_response(self, path: str, scope) -> Response:
        # Starlette hands over an OS path: backslashes on Windows. The checks below speak URL.
        route = path.replace("\\", "/")
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as e:
            if e.status_code != 404 or route.split("/", 1)[0] in ("api", "assets"):
                raise
            response = await super().get_response("index.html", scope)
        if route.startswith("assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "no-cache"
        return response
