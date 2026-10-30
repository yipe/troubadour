"""Voice clones: profiles, builds, say/read jobs and clips."""

from typing import Annotated

from fastapi import APIRouter
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, StringConstraints
from troubadour.server import deps
from troubadour.sound import tts

router = APIRouter()


Persona = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,40}$")]


class SayIn(BaseModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=tts.SAY_MAX_CHARS)]
    in_their_words: bool = False  # restyle it like them first (talk.restyle) and match their pace
    persona: Persona = "table"  # which of their voices: "table", or a character voice's key


class ReadIn(BaseModel):
    session: str = Field(max_length=60)
    in_their_words: bool = False
    persona: Persona = "table"


@router.get("/api/clones")
def clones():
    """Built voices and speech profiles by player id, and every clip made with them (newest first)."""
    return {"voices": deps.engine.clones.voices(), "profiles": deps.engine.clones.profiles(), "clips": deps.engine.clones.clips()}


@router.post("/api/players/{pid}/profile", status_code=202)
def build_profile(pid: str):
    """Profile how they talk from every saved transcript (a job: kind "profile"). Needs the clone opt-in."""
    name, work = deps._call(deps.cloning.profile_job, pid)
    return deps.memory.submit("profile", name, work, player_id=pid).to_json()


@router.post("/api/players/{pid}/clone", status_code=202)
def build_clone(pid: str):
    """(Re)build their voice (a job: kind "clone")."""
    name, work = deps._call(deps.cloning.build_job, pid)
    return deps.memory.submit("clone", name, work, player_id=pid).to_json()


@router.post("/api/players/{pid}/clone/say", status_code=202)
def clone_say(pid: str, body: SayIn):
    name, work = deps._call(deps.cloning.say_job, pid, body.text, body.in_their_words, body.persona)
    return deps.memory.submit("say", name, work, player_id=pid).to_json()


@router.post("/api/players/{pid}/clone/read", status_code=202)
def clone_read(pid: str, body: ReadIn):
    """Read a session's write-up page aloud in their voice (a job: kind "read", note = the page)."""
    title, page, work = deps._call(deps.cloning.read_job, pid, body.session, body.in_their_words, body.persona)
    return deps.memory.submit("read", title, work, player_id=pid, note=page).to_json()


@router.get("/api/clones/{pid}/{name}.wav")
def clone_audio(pid: str, name: str):
    return FileResponse(deps._call(deps.engine.clones.file, pid, name), media_type="audio/wav")


@router.delete("/api/clones/{pid}/clips/{cid}", status_code=204)
def delete_clip(pid: str, cid: str):
    deps._call(deps.engine.clones.delete_clip, pid, cid)
