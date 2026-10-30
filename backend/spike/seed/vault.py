"""The campaign vault: entity notes through `Vault`, session write-up pages through its note writer.

Pages follow the shape `lore/memory.py` writes (frontmatter with `session_id`, then Last time / What happened /
Still open / Mentioned / Transcript), so the app reads them as real write-ups.
"""

import re

from troubadour.core import transcript
from troubadour.lore.campaign import Vault

from .common import SeedContext, SessionSeed

# name, type, description, aliases, heard_as, heard_as_suggested, status. Facts come from the lists below.
ENTITIES = [
    # Player characters
    (
        "Pip Tallowmere",
        "pc",
        "Half-elf bard of the Saltreach docks, collector of other people’s secrets.",
        ["Pip"],
        [],
        [],
        "confirmed",
    ),
    (
        "Thessaly",
        "pc",
        "Wood elf druid who speaks to gulls and distrusts anything made of iron.",
        [],
        ["Thessely"],
        [],
        "confirmed",
    ),
    ("Brann Coldwater", "pc", "Human barbarian from the northern shore, afraid of boats.", ["Brann"], [], [], "confirmed"),
    (
        "Velis Anwe",
        "pc",
        "High elf wizard who keeps a ledger of everything the party owes.",
        ["Velis"],
        ["Valis Anway"],
        [],
        "confirmed",
    ),
    # NPCs
    (
        "Captain Orsa Vell",
        "npc",
        "Smuggler and captain of the Gull’s Debt. Charming, in debt, and never where she says she will be.",
        ["Orsa", "Orsa Vell"],
        ["Orsa Bell", "Horsa Vell"],
        ["Orza Vell"],
        "confirmed",
    ),
    (
        "Sister Merrow",
        "npc",
        "A temple keeper in Saltreach who speaks softly and answers only what she is asked.",
        ["Merrow"],
        [],
        ["Sister Marrow"],
        "confirmed",
    ),
    ("Old Tam", "npc", "Ferryman of the Low Water crossing, half deaf and fully stubborn.", ["Tam"], [], [], "confirmed"),
    ("Mother Glass", "npc", "Fence and bookkeeper at the Brine Market. Pays in coin, never in favors.", [], [], [], "confirmed"),
    (
        "Harbormaster Dunmore",
        "npc",
        "Ketil Dunmore, who runs the harbor ledgers and the party’s first job.",
        ["Ketil Dunmore"],
        [],
        [],
        "confirmed",
    ),
    ("Wick Farrow", "npc", "A dock urchin who sells rumors by the pennyweight.", ["Wick"], [], [], "confirmed"),
    ("The Abbot", "npc", "Mentioned as the keeper of the drowned abbey. Never seen.", [], [], [], "suggested"),
    ("Choir voice", "npc", "Singing heard beneath the abbey floor.", [], [], [], "suggested"),
    # Places
    (
        "Saltreach",
        "place",
        "A tidal port town built on pilings, famous for its eclipse festival.",
        [],
        ["Salt Reach"],
        [],
        "confirmed",
    ),
    (
        "Drowned Abbey",
        "place",
        "A sunken abbey that surfaces at low tide, its bell still rung by something.",
        ["the abbey"],
        [],
        [],
        "confirmed",
    ),
    ("Gull’s Debt", "place", "Orsa Vell’s sloop, moored at Low Water Quay.", [], [], [], "confirmed"),
    ("Low Water Quay", "place", "The oldest stretch of Saltreach’s harbor, dry twice a day.", [], [], [], "confirmed"),
    ("Brine Market", "place", "A night market on barges, where nothing is quite legal.", [], [], [], "confirmed"),
    ("Saltreach Temple", "place", "The temple the Diamond of Ysolde was stolen from.", [], [], [], "confirmed"),
    # Items
    (
        "Diamond of Ysolde",
        "item",
        "A legendary diamond, stolen during the eclipse. Everyone wants it.",
        ["the diamond"],
        ["Diamond of Isolde"],
        ["Diamond of Yzolde"],
        "confirmed",
    ),
    ("Orsa’s Ledger", "item", "A water-stained ledger of debts. Several pages are missing.", [], [], [], "confirmed"),
    ("Tideglass Lantern", "item", "A lantern whose flame burns blue near the drowned.", [], [], [], "confirmed"),
    # Factions
    (
        "The Tidecallers",
        "faction",
        "A cult that wants the abbey sealed and the bell silent.",
        ["Tidecaller"],
        [],
        [],
        "confirmed",
    ),
    ("Harbor Guild", "faction", "Merchants who run Saltreach and look away from the Brine Market.", [], [], [], "confirmed"),
    (
        "Order of the Drowned God",
        "faction",
        "Whoever Brann’s oath was sworn to; only one old hymn mentions them.",
        [],
        [],
        [],
        "confirmed",
    ),
    # Lore
    ("Second Bell", "term", "The bell that marks the turn of the tide at the abbey.", [], [], [], "confirmed"),
    ("Detect Magic", "spell", "Thessaly’s first move in any suspicious room.", [], [], [], "confirmed"),
]

# Facts the design shows, with the session they came from: (about, session number, text, suggested)
DESIGN_FACTS = [
    ("Drowned Abbey", 12, "Necromantic magic lies beneath the abbey bell’s shadow.", False),
    ("Diamond of Ysolde", 12, "The Diamond of Ysolde is hidden in the bell’s clapper.", True),
    ("Drowned Abbey", 12, "The tide turns at the second bell.", False),
    ("Captain Orsa Vell", 12, "Orsa Vell won’t set foot in the abbey.", False),
    ("The Tidecallers", 11, "The Tidecallers want the abbey sealed for good.", False),
    ("Diamond of Ysolde", 11, "The diamond is somewhere in the abbey.", True),
    ("Captain Orsa Vell", 10, "Orsa Vell owes Pip 20 gold.", False),
    ("Captain Orsa Vell", 9, "Orsa Vell smuggles for the Tidecallers.", True),
    ("The Tidecallers", 8, "The Tidecallers will pay 4,000 gp for the diamond.", False),
    ("Brann Coldwater", 6, "Brann swore an oath to the drowned god.", True),
    ("Diamond of Ysolde", 5, "Whoever holds the diamond can’t tell a lie.", False),
    ("Diamond of Ysolde", 3, "The Diamond of Ysolde was stolen from the Saltreach temple during the eclipse.", False),
]

# Facts only the seed has, so more entries have something to show.
EXTRA_FACTS = [
    ("Old Tam", 2, "Old Tam carried a drowned passenger who never paid.", False),
    ("Mother Glass", 4, "Mother Glass bought Orsa’s ledger pages.", False),
    ("Captain Orsa Vell", 4, "Orsa Vell sold her ledger pages to Mother Glass.", True),
    ("Harbormaster Dunmore", 1, "Dunmore pays couriers half up front and half on return.", False),
    ("Sister Merrow", 5, "Sister Merrow tends the Saltreach Temple’s eclipse candles.", False),
    ("Wick Farrow", 9, "Wick Farrow saw who lit the fire on the docks.", True),
]

# Write-ups for S1..S11 except S7: (last time, [what happened], [still open]).
WRITEUPS = {
    1: (
        "The party met Harbormaster Dunmore in [[Saltreach]] and took a courier job: carry a sealed letter across the water to [[Old Tam]]’s ferry. [[Pip Tallowmere]] charmed the dock guards; [[Brann Coldwater]] met his first boat.",
        [
            "Dunmore hired the party at the harbor office.",
            "Pip talked a guard out of inspecting the letter.",
            "Brann refused to board the ferry until [[Thessaly]] sang to the gulls.",
        ],
        ["Who sealed the letter, and why does it smell of smoke?"],
    ),
    2: (
        "The ferry was haunted by a drowned passenger who never paid. [[Thessaly]] calmed the ghost and learned it was bound to the [[Drowned Abbey]]’s bell.",
        [
            "[[Old Tam]] admitted the ghost has ridden with him for years.",
            "Thessaly spoke with the ghost; it asked for a candle at low tide.",
            "The party delivered the letter to a closed door.",
        ],
        ["What does the letter say?"],
    ),
    3: (
        "The [[Diamond of Ysolde]] was stolen from the [[Saltreach Temple]] during the eclipse. The party was hired to find it before the next tide table closes the harbor.",
        [
            "The eclipse festival went dark at midday.",
            "[[Velis Anwe]] found the temple lock opened from the inside.",
            "Wick Farrow sold the party the first rumor, for a copper.",
        ],
        ["Who opened the temple lock?", "Why did the festival bells stop?"],
    ),
    4: (
        "A trail of debts led to the [[Brine Market]], where [[Mother Glass]] had bought pages of [[Orsa’s Ledger]]. The party got two pages back.",
        [
            "Mother Glass named her price in favors, then in coin.",
            "Velis spotted the ledger totals did not add up.",
            "[[Captain Orsa Vell]] was seen leaving the market by boat.",
        ],
        ["Who else holds ledger pages?"],
    ),
    5: (
        "[[Sister Merrow]] told the party the legend of the diamond: whoever holds it cannot lie. She also asked, politely, that it never be brought back to the temple.",
        [
            "Merrow received the party after the evening bell.",
            "Pip tested the legend with a lie and a coin toss.",
            "Brann gave his word and meant it.",
        ],
        ["Why would the temple not want the diamond back?"],
    ),
    6: (
        "At [[Low Water Quay]] Brann swore an oath to the drowned god, and the tide went out an hour early. [[Captain Orsa Vell]] offered passage on the [[Gull’s Debt]].",
        [
            "Brann swore at the water’s edge.",
            "The tide receded and left something glittering.",
            "Orsa offered a berth, for a share.",
        ],
        ["Who heard Brann’s oath?"],
    ),
    8: (
        "[[The Tidecallers]] made their offer: 4,000 gp for the [[Diamond of Ysolde]], no questions. [[Captain Orsa Vell]] was in the room and did not look surprised.",
        [
            "A Tidecaller envoy approached the party at the Gull’s Debt.",
            "The offer was doubled when Pip said no.",
            "Velis marked the envoy’s ring in her notes.",
        ],
        ["Is Orsa working for the Tidecallers?"],
    ),
    9: (
        "Smoke rose over the docks as a warehouse burned. Pip was certain [[Captain Orsa Vell]] was smuggling for the [[The Tidecallers|Tidecallers]]; [[Wick Farrow]] saw who lit the fire.",
        [
            "The party fought the fire at Low Water Quay.",
            "Wick named a name, then thought better of it.",
            "Thessaly found a Tidecaller token in the ashes.",
        ],
        ["Who lit the fire?"],
    ),
    10: (
        "[[Captain Orsa Vell]] owed Pip 20 gold and paid in riddles. The abbot, she said, keeps what he stole close to his voice.",
        [
            "Orsa set the party three riddles for their debt.",
            "Pip solved two; Velis solved the third.",
            "The [[Drowned Abbey]] was named for the first time.",
        ],
        ["Who is the abbot?", "What is the abbot’s voice?"],
    ),
    11: (
        "The [[Second Bell]] rang over [[Saltreach]] and [[The Tidecallers]] revealed they want the abbey sealed for good. The party chose to reach the diamond first.",
        [
            "The bells of Saltreach rang out of turn.",
            "A Tidecaller speech called for the abbey to be sealed.",
            "The party agreed to go in at the next low tide.",
        ],
        ["What happens if the abbey is sealed with the diamond inside?"],
    ),
}


def _links(text: str) -> list[str]:
    """Names inside [[...]] (before any |), in order, without repeats."""
    seen: list[str] = []
    for name in re.findall(r"\[\[([^\]|]+)", text):
        if name not in seen:
            seen.append(name)
    return seen


def _page(s: SessionSeed) -> str:
    last, beats, still_open = WRITEUPS[s.n]
    mentioned = _links(" ".join([last, *beats, *still_open]))
    out = [
        f"---\ntype: session\nsession_id: {s.id}\ndate: {s.date}\n"
        f"duration: {transcript.clock(s.duration_s)}\ntags: [troubadour/session]\n---",
        f"# {s.page_title}",
        "",
        "## Last time",
        last,
        "",
        "## What happened",
        *(f"- {b}" for b in beats),
        "",
        "## Still open",
        *(f"- {o}" for o in still_open),
        "",
        "## Mentioned",
        ", ".join(f"[[{n}]]" for n in mentioned),
        "",
        "## Transcript",
        f"[[Transcripts/{s.id}|Full transcript]] · {s.record['session']['lines']} lines",
        "",
    ]
    return "\n".join(out)


def seed(ctx: SeedContext) -> None:
    vault = Vault(ctx.vault_dir)
    for name, kind, description, aliases, heard_as, suggested, status in ENTITIES:
        vault.create(
            name, kind, description=description, aliases=aliases, heard_as=heard_as, heard_as_suggested=suggested, status=status
        )
    by_n = {s.n: s for s in ctx.sessions}
    for about, n, text, suggested in [*DESIGN_FACTS, *EXTRA_FACTS]:
        vault.add_fact(about, f"{text} ([[{by_n[n].page_title}]])", suggested=suggested)
    vault.set_campaign_facts(
        [
            "The campaign is set on the tidal coast around Saltreach.",
            "Two bells mark each tide; the second is the one that matters.",
        ]
    )
    for s in ctx.sessions:
        if s.n not in WRITEUPS:
            continue
        vault.write_note("Sessions", s.page_title, _page(s))
        vault.write_note("Sessions/Transcripts", s.id, transcript.markdown(s.record))
    vault.write_index()
