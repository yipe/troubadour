"""The twelve saved sessions: transcript.json, transcript.md and meta.json each, via `transcript.build`.

Lines are the mock campaign's own (docs/design/troubadour-redesign/data.js, in S12) plus generated filler.
No audio files are written, so no session is replayable.
"""

import json

from troubadour.core import transcript
from troubadour.core.fsutil import write_atomic
from troubadour.engine._sessions import talk_seconds

from .common import CAMPAIGN_ID, SeedContext, SessionSeed, rng, session_id, utc

# (title, month, day). Twelve sessions between Sep 3 and Oct 22 cannot all be a week apart.
SCHEDULE = [
    ("A Letter from Saltreach", 9, 3),
    ("The Ferry Ghost", 9, 8),
    ("The Eclipse Heist", 9, 12),
    ("Salt and Ledgers", 9, 17),
    ("Sister Merrow", 9, 21),
    ("Oaths at Low Water", 9, 26),
    ("Tide Tables", 9, 30),
    ("The Tidecaller Offer", 10, 3),
    ("Smoke on the Docks", 10, 8),
    ("Debts and Riddles", 10, 13),
    ("Bells of Saltreach", 10, 17),
    ("The Drowned Abbey", 10, 22),
]

# Share of lines per voice, from the design's talk-time panel.
WEIGHTS = [("v-alex", 46), ("v-sam", 17), ("v-maya", 15), ("v-rin", 12), ("v-jo", 10)]
SKILLS = ["Perception", "Insight", "Arcana", "Athletics", "Persuasion", "Stealth", "History"]
NPCS = ["Captain Orsa Vell", "Old Tam", "Mother Glass", "Harbormaster Dunmore", "Sister Merrow"]
PLACES = ["Saltreach", "Low Water Quay", "the Brine Market", "the abbey", "the Gull's Debt"]

LINES = {
    "v-alex": [
        "{place} is quieter than you remember. The wind carries salt and old smoke.",
        "Roll me a {skill} check.",
        "{npc} watches you for a long moment before answering.",
        "Make a {skill} check, and tell me whether you're watching the door or the water.",
        "You hear the tide shift against the pilings, and somewhere a gull complains.",
        "That's a seventeen to hit, so it lands. Roll damage.",
        "Okay, give me initiative, everyone.",
        "Let's take ten. Bring snacks back with you.",
        "The lantern light flickers and the shadows stretch toward {place}.",
        "{npc} says, “I wouldn’t do that if I were you.”",
        "Nobody answers. The only sound is water dripping somewhere out of sight.",
        "You have about an hour before the tide closes the causeway.",
    ],
    "v-sam": [
        "Can I try to talk our way past them? Persuasion, with bardic inspiration.",
        "Pip tunes the lute and hums something low about {place}.",
        "Did anyone write down what {npc} said? I want it in the song.",
        "I rolled a fourteen plus six, so twenty.",
        "Wait, wait, we’re forgetting the ledger.",
        "I’ll cast Vicious Mockery on the gull. It’s been staring at me.",
        "Pip smiles and offers {npc} a drink. A very sincere drink.",
        "How much gold do we actually have left?",
    ],
    "v-jo": [
        "Thessaly asks the gulls what they’ve seen.",
        "I cast Entangle on the doorway.",
        "Can I use Wild Shape to slip through the grate?",
        "Is the water moving the wrong way?",
        "I’ll cast Goodberry and hand them out before we go.",
        "Something is off about {place}. The plants are all dead.",
        "I’m keeping the owl close, just in case.",
    ],
    "v-rin": [
        "Brann kicks the door. Is it locked?",
        "I rage. Obviously I rage.",
        "I’m hitting it with the axe. Twice.",
        "Can I carry the chest?",
        "Brann doesn’t like boats. Brann says so, loudly.",
        "Ten damage, plus the extra from rage.",
        "I don’t trust {npc}. I’m standing right behind them.",
    ],
    "v-maya": [
        "I cast Shield, and that’s plus five.",
        "Let me check my notes on {place}.",
        "Velis would like to cast Identify on that.",
        "Can I read the inscription? I have Comprehend Languages ready.",
        "Actually, if the ledger is right, the numbers don’t add up.",
        "I’ll cast Detect Magic. Is anything glowing?",
        "That’s the third time {npc} has changed the story.",
        "Mage Hand goes under the door first.",
    ],
    "v-orsa": [
        "You’ll want to be quick. The tide waits for no one.",
        "I owe nobody anything. Ask anyone in Saltreach.",
        "Keep your voices down. Sound carries over water.",
        "The Gull’s Debt sails at dawn, with you or without.",
    ],
    "v-merrow": [
        "The tide gives and the tide takes. Mind which you are owed.",
        "Light a candle for the drowned before you go in.",
        "I have said all that I am able to say.",
    ],
}

# S12, from data.js: (time, speaker voice, text). The unnamed voice is "Voice 3".
S12_LINES = [
    (
        "1:36:14",
        "v-alex",
        "The abbey doors are swollen with seawater. When you push, they groan open and brine pours past your ankles.",
    ),
    ("1:36:40", "v-alex", "Somewhere below, a bell rings once."),
    ("1:38:02", "v-orsa", "You’ll want to be quick. The tide turns at the second bell."),
    ("1:38:40", "v-rin", "Then I’m going first. Brann doesn’t wait for bells."),
    ("1:39:12", "v-sam", "Wait. Orsa, you said the abbot keeps the diamond under the bell. Didn’t you?"),
    ("1:39:30", "v-orsa", "I said beneath the tide’s tongue. Make of it what you will."),
    ("1:40:31", "v-maya", "The tide’s tongue. That’s the clapper. The Diamond of Ysolde is in the bell itself."),
    ("1:41:02", "v-jo", "Thessaly casts Detect Magic before we go any further."),
    ("1:41:20", "v-alex", "Roll me an Arcana check."),
    ("1:41:28", "v-jo", "Nineteen."),
    ("1:41:55", "v-alex", "There’s a faint necromantic glow beneath the floor, right where the bell’s shadow falls."),
    ("1:42:05", "v-pending3", "Is that… is someone singing down there?"),
]

# A word the transcriber tends to mishear -> how it came out. Some lines carry the fix.
MISHEARD = [("Ysolde", "Isolde"), ("Orsa Vell", "Orsa Bell"), ("Thessaly", "Thessely"), ("Saltreach", "Salt Reach")]


def _clock(text: str) -> float:
    parts = [int(p) for p in text.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def _fixes(text: str, r) -> list[dict]:
    """Spelling-cleanup records: [{start, end, heard}] in UTF-16 units of the corrected text."""
    out = []
    for right, heard in MISHEARD:
        at = text.find(right)
        if at >= 0 and (right == "Ysolde" or r.random() < 0.4):
            out.append(
                {
                    "start": transcript.utf16_offset(text, at),
                    "end": transcript.utf16_offset(text, at + len(right)),
                    "heard": heard,
                }
            )
    return out


def _filler(n: int, count: int, duration: float, r, taken: list[float]) -> list[tuple[float, str, str]]:
    voices = [v for v, _ in WEIGHTS]
    weights = [w for _, w in WEIGHTS]
    out = []
    for _ in range(count):
        t = round(r.uniform(20, duration - 90), 1)
        if any(abs(t - x) < 25 for x in taken):
            continue
        who = r.choices(voices, weights)[0]
        if who == "v-alex":
            roll = r.random()
            who = "v-orsa" if roll < 0.12 else "v-merrow" if roll < 0.18 and n >= 5 else who
        text = r.choice(LINES[who]).format(skill=r.choice(SKILLS), npc=r.choice(NPCS), place=r.choice(PLACES))
        # Early sessions have no Sister Merrow yet.
        if who == "v-merrow" and n < 5:
            continue
        if n >= 10 and r.random() < 0.03:
            who, text = "v-pending3", r.choice(["Hold on, who is that?", "Wait, did you hear that too?", "Is the water rising?"])
        out.append((t, who, text))
    return out


def _messages(n: int, duration: float, r) -> list[dict]:
    anchors = [(_clock(t), v, text) for t, v, text in S12_LINES] if n == 12 else []
    taken = [t for t, _, _ in anchors]
    lines = anchors + _filler(n, r.randint(65, 185), duration, r, taken)
    lines.sort(key=lambda x: x[0])
    messages = []
    for i, (t, who, text) in enumerate(lines):
        pending = who == "v-pending3"
        messages.append(
            {
                "id": f"m{n:02d}-{i:04d}",
                "voice_id": who,
                "text": text,
                "t_start": round(t, 2),
                "t_end": round(t + 1.2 + 0.38 * len(text.split()), 2),
                "confidence": round(r.uniform(0.36, 0.55) if pending else r.uniform(0.82, 0.99), 3),
                "provisional": pending,
                "fixes": _fixes(text, r),
                "level_db": round(r.uniform(-34.0, -18.0), 1),
            }
        )
    return messages


def _present(n: int, ctx: SeedContext) -> list[str]:
    """Who sat at the table: everyone, except one player now and then (never the GM, who runs it)."""
    r = rng("present", n)
    away = r.choice([p.id for p in ctx.players if not p.is_gm]) if n % 3 == 0 else None
    return [p.id for p in ctx.players if p.id != away]


def seed(ctx: SeedContext) -> None:
    people = [
        {
            "id": p.id,
            "name": p.name,
            "character": p.character,
            "is_gm": p.is_gm,
            "color": p.color,
        }
        for p in ctx.players
    ]
    voices = [
        {"id": p.voice_id, "label": p.name, "player_id": p.id, "character": None, "trained": p.trained, "status": "named"}
        for p in ctx.players
    ] + [
        {
            "id": "v-orsa",
            "label": "Captain Orsa Vell",
            "player_id": "p-alex",
            "character": "Captain Orsa Vell",
            "trained": False,
            "status": "named",
        },
        {
            "id": "v-merrow",
            "label": "Sister Merrow",
            "player_id": "p-alex",
            "character": "Sister Merrow",
            "trained": False,
            "status": "named",
        },
        {"id": "v-pending3", "label": "Voice 3", "player_id": None, "character": None, "trained": False, "status": "pending"},
    ]
    for n, (title, month, day) in enumerate(SCHEDULE, start=1):
        r = rng("session", n)
        started_at = utc(month, day)
        duration = float(r.randrange(9000, 12600, 60))
        if n == 12:
            duration = max(duration, 10800.0)  # the design's lines run to 1:42:05 and the session goes on
        sid = session_id(started_at, r)
        meta = {
            "id": sid,
            "started_at": started_at,
            "source": {"kind": "mic", "device": "Demo table mic"},
            "duration_s": duration,
            "campaign": CAMPAIGN_ID,
            # S7 is the session that was never written up; it keeps no working title either.
            "title": "" if n == 7 else title,
            "present_player_ids": _present(n, ctx),
            # S11 is written up but not yet reviewed, and S12 is the one that needs review.
            "reviewed_at": started_at + duration + 3600 if n <= 10 else None,
        }
        record = transcript.build(meta, people, voices, _messages(n, duration, r))
        record["session"]["talk"] = talk_seconds(record["messages"])
        folder = ctx.data_dir / "sessions" / sid
        write_atomic(folder / "transcript.json", json.dumps(record, ensure_ascii=False, indent=1))
        write_atomic(folder / "transcript.md", transcript.markdown(record))
        write_atomic(folder / "meta.json", json.dumps(record["session"]))
        ctx.sessions.append(SessionSeed(n, sid, title, started_at, duration, record))
