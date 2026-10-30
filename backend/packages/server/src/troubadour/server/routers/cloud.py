"""Troubadour Cloud (opt-in backup)."""

import html
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from troubadour.cloud.backup import AutoBackup, CloudError
from troubadour.server import deps

log = logging.getLogger("troubadour")
router = APIRouter()


class CloudOptionsIn(BaseModel):
    include_transcripts: bool | None = None
    auto_backup: bool | None = None


class CloudRestoreIn(BaseModel):
    vault_id: str = Field(pattern=r"^[0-9a-f-]{36}$")
    snapshot: str | None = Field(default=None, pattern=r"^[0-9a-f-]{36}$")  # a restore point; None = the newest


class CloudQuota(BaseModel):
    used_bytes: int
    limit_bytes: int
    after_bytes: int


class CloudBackup(BaseModel):
    at: float
    snapshot: str
    files: int
    bytes: int
    uploaded: int
    unchanged: bool
    skipped: list[str]
    quota: CloudQuota
    fingerprint: str
    message: str | None = None  # "<device> · <summary>"; backups made before C12 have none


class CloudLastError(BaseModel):
    at: float
    message: str


class CloudStatus(BaseModel):
    url: str
    connected: bool
    campaign: str
    include_transcripts: bool
    auto_backup: bool
    last_backup: CloudBackup | None
    last_error: CloudLastError | None
    device: str
    main_device: str
    is_main: bool
    paused_live: bool


class BackupAttempt(BaseModel):
    at: float
    ok: bool
    snapshot: str | None
    files: int
    changed: int
    message: str | None
    error: str | None


class CloudHistory(BaseModel):
    attempts: list[BackupAttempt]


class CloudAuthorize(BaseModel):
    authorize_url: str


class CloudAccount(BaseModel):
    email: str | None
    name: str | None
    avatar: str | None


class CloudVault(BaseModel):
    id: str
    name: str
    campaign_id: str
    head_snapshot: str | None
    created_at: str


def _cloud_status() -> dict:
    cid = deps.engine.campaign
    status = deps.cloud.status(cid)
    waiting = deps.session_live() and status["connected"] and status["auto_backup"]
    return status | {"campaign": cid, "paused_live": waiting}


@router.get("/api/cloud", response_model=CloudStatus)
def cloud_status():
    """Connected or not, and the open campaign's backup settings and last backup, and which Mac is main (asked of the service, at most every minute, 3 s at most)."""
    return _cloud_status()


@router.post("/api/cloud/connect", response_model=CloudAuthorize)
def cloud_connect():
    """Start signing in: the first time Troubadour contacts the service. Returns the page to open."""
    try:
        return {"authorize_url": deps._call(deps.cloud.start_login)}
    except CloudError as e:
        raise HTTPException(502, str(e)) from None


@router.get("/api/cloud/callback", response_class=HTMLResponse)
def cloud_callback(
    code: str = Query("", max_length=2000), state: str = Query("", max_length=200), error: str = Query("", max_length=200)
):
    """Where the service's sign-in page sends the browser back (state ties it to a sign-in started here)."""
    if error or not code or not state:
        return _cloud_page("Not connected", f"Sign-in didn't finish{f' ({error})' if error else ''}. Try again from Troubadour.")
    try:
        deps.cloud.finish_login(code, state)
    except (ValueError, CloudError) as e:
        return _cloud_page("Not connected", str(e))
    deps.bus.emit("cloud.updated", _cloud_status())
    return _cloud_page("Connected", "Troubadour is connected to Troubadour Cloud. You can close this tab.")


def _cloud_page(title: str, text: str) -> str:
    return (
        f"<!doctype html><meta charset=utf-8><title>Troubadour Cloud: {html.escape(title)}</title>"
        f'<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">'
        f'<h1>{html.escape(title)}</h1><p>{html.escape(text)}</p><p><a href="/campaign">Back to Troubadour</a></p>'
    )


@router.post("/api/cloud/disconnect", response_model=CloudStatus)
def cloud_disconnect():
    """Forget the sign-in on this Mac (backups already made stay in the cloud)."""
    deps.cloud.logout()
    status = _cloud_status()
    deps.bus.emit("cloud.updated", status)
    return status


@router.put("/api/cloud/options", response_model=CloudStatus)
def cloud_options(body: CloudOptionsIn):
    deps.cloud.set_options(deps.engine.campaign, include_transcripts=body.include_transcripts, auto_backup=body.auto_backup)
    return _cloud_status()


def _job_progress(job):
    def progress(done: int, total: int, message: str) -> None:
        job.done, job.total, job.message = done, total, message
        deps.memory.emit(job)

    return progress


def _submit_backup(cid: str, name: str, root: Path, automatic: bool = False):
    """Queue a backup job (callers hold campaign_gate, so the campaign can't switch underneath)."""

    def work(job):
        try:
            last = deps.cloud.backup(cid, name, root, _job_progress(job))
        except Exception as e:
            if not automatic:
                raise
            # Offline at the table is normal: no red chip every 10 minutes. The failure stays in the
            # Cloud backup panel (last_error) and the next automatic attempt retries.
            log.info("automatic cloud backup failed: %s", e)
            job.message = f"Automatic backup didn't run: {e}"
            return
        finally:
            deps.bus.emit("cloud.updated", _cloud_status())
        job.done = job.total
        if last["unchanged"]:
            job.message = f"Nothing changed since the last backup ({last['files']} files)"
        else:
            job.message = f"Backed up {last['files']} files ({last['uploaded']} new or changed)"
        if last["skipped"]:
            job.message += f"; skipped {len(last['skipped'])}"

    return deps.memory.submit("backup", f"{name} (automatic)" if automatic else name, work)


def _open_campaign() -> tuple[str, str, Path]:
    with deps.engine.lock:
        return deps.engine.campaign, deps.engine.campaigns[deps.engine.campaign].name, deps.engine.vault_dir()


@router.post("/api/cloud/backup")
def cloud_backup():
    """Back up the open campaign's notes now (a background job: `campaign.job` with kind "backup")."""
    with deps.campaign_gate:
        cid, name, root = _open_campaign()
        if not deps.cloud.status(cid, main=False)["connected"]:
            raise HTTPException(400, "Connect Troubadour Cloud first.")
        if deps.session_live():
            raise HTTPException(409, "Backups wait until the session ends.")
        return _submit_backup(cid, name, root).to_json()


@router.get("/api/cloud/vaults", response_model=list[CloudVault])
def cloud_vaults():
    """This account's campaigns in Troubadour Cloud (from any Mac), to restore from."""
    try:
        return deps.cloud.vaults()
    except CloudError as e:
        raise HTTPException(401 if e.code == "unauthorized" else 502, str(e)) from None


@router.get("/api/cloud/account", response_model=CloudAccount)
def cloud_account():
    """Who is signed in to Troubadour Cloud (name, email, avatar) for the header menu; 401 when not connected."""
    try:
        return deps.cloud.account()
    except CloudError as e:
        raise HTTPException(401 if e.code == "unauthorized" else 502, str(e)) from None


@router.get("/api/cloud/history", response_model=CloudHistory)
def cloud_history():
    """Backup attempts for the open campaign, newest first, kept 90 days (failures too). Never calls the service."""
    return {"attempts": deps.cloud.history(deps.engine.campaign)}


@router.post("/api/cloud/restore")
def cloud_restore(body: CloudRestoreIn):
    """Bring a backed-up campaign's newest snapshot (or the restore point in `snapshot`) back (a background job, kind "restore"). It goes into the
    campaign with the vault's id: one this Mac doesn't have yet is created (so it shows in the picker),
    one it has keeps its other notes. Notes that differ go to .trash first; nothing is deleted."""
    with deps.campaign_gate:
        cid, name, _ = _open_campaign()
        if not deps.cloud.status(cid, main=False)["connected"]:
            raise HTTPException(400, "Connect Troubadour Cloud first.")

        def work(job):
            remote = deps.cloud.vault(body.vault_id)
            target = remote.get("campaign_id")
            if not isinstance(target, str):
                raise CloudError("not_found", "That campaign has no id Troubadour can use.")
            job.title = str(remote.get("name") or "Restored campaign")[:60]
            deps.engine.adopt_campaign(target, job.title)
            result = deps.cloud.restore(body.vault_id, deps.engine.vault_dir(target), _job_progress(job), body.snapshot)
            job.done = job.total
            job.message = (
                f"Restored {result['restored']} files"
                + (f", {result['replaced']} older versions moved to .trash" if result["replaced"] else "")
                + (f"; {result['unchanged']} already up to date" if result["unchanged"] else "")
                + (f"; skipped {len(result['skipped'])}" if result["skipped"] else "")
            )

        return deps.memory.submit("restore", name, work).to_json()


def _auto_backup_tick_submit(cid: str, name: str, root: Path) -> None:
    with deps.campaign_gate:
        if deps.engine.campaign == cid:  # still the open campaign
            _submit_backup(cid, name, root, automatic=True)


auto_backup = AutoBackup(
    deps.cloud,
    current=_open_campaign,
    busy=deps.memory.busy,
    submit=_auto_backup_tick_submit,
    is_live=lambda: deps.session_live(),
)
