// Shared mock data for Troubadour redesign screens.
window.TB = (function () {
  const C = {
    gm: "var(--color-class-paladin)", pip: "var(--color-class-bard)", th: "var(--color-class-druid)",
    br: "var(--color-class-barbarian)", ve: "var(--color-class-wizard)", un: "var(--color-fg-subtle)"
  };
  const P = {
    gm: { i: "AK", player: "Alex", ch: "Game master", short: "Alex", cls: "GM", c: C.gm },
    pip: { i: "SM", player: "Sam", ch: "Pip Tallowmere", short: "Pip", cls: "Bard 6", c: C.pip },
    th: { i: "JO", player: "Jo", ch: "Thessaly", short: "Thessaly", cls: "Druid 6", c: C.th },
    br: { i: "RN", player: "Rin", ch: "Brann Coldwater", short: "Brann", cls: "Barbarian 6", c: C.br },
    ve: { i: "MY", player: "Maya", ch: "Velis Anwe", short: "Velis", cls: "Wizard 6", c: C.ve },
    un: { i: "?", player: "Voice 3", ch: "Unnamed voice", short: "Voice 3", cls: "", c: C.un }
  };
  const L = [
    ["1:36:14", "gm", null, "The abbey doors are swollen with seawater. When you push, they groan open and brine pours past your ankles."],
    ["1:36:40", "gm", null, "Somewhere below, a bell rings once."],
    ["1:38:02", "gm", "Captain Orsa Vell", "You’ll want to be quick. The tide turns at the second bell."],
    ["1:38:40", "br", null, "Then I’m going first. Brann doesn’t wait for bells."],
    ["1:39:12", "pip", null, "Wait. Orsa, you said the abbot keeps the diamond under the bell. Didn’t you?"],
    ["1:39:30", "gm", "Captain Orsa Vell", "I said beneath the tide’s tongue. Make of it what you will."],
    ["1:40:31", "ve", null, "The tide’s tongue. That’s the clapper. The Diamond of Ysolde is in the bell itself."],
    ["1:41:02", "th", null, "Thessaly casts Detect Magic before we go any further."],
    ["1:41:20", "gm", null, "Roll me an Arcana check."],
    ["1:41:28", "th", null, "Nineteen."],
    ["1:41:55", "gm", null, "There’s a faint necromantic glow beneath the floor, right where the bell’s shadow falls."],
    ["1:42:05", "un", null, "Is that… is someone singing down there?"]
  ];
  function lines(from) {
    const out = [];
    L.slice(from || 0).forEach((l, n, arr) => {
      const p = P[l[1]];
      const prev = arr[n - 1];
      const cont = prev && prev[1] === l[1] && prev[2] === l[2];
      out.push({
        t: l[0], text: l[3], name: l[2] ? p.player : p.ch === "Game master" ? "Alex" : p.short,
        as: l[2] ? "as " + l[2] : l[1] === "gm" ? "GM" : p.player,
        i: p.i, c: p.c, head: !cont, cont: !!cont, unsure: l[1] === "un",
        fix: l[3].includes("Ysolde")
      });
    });
    return out;
  }
  const talk = [
    { k: "gm", pct: 46, time: "47m" }, { k: "pip", pct: 17, time: "17m" }, { k: "ve", pct: 15, time: "15m" },
    { k: "br", pct: 12, time: "12m" }, { k: "th", pct: 10, time: "10m" }
  ].map(t => Object.assign({}, P[t.k], t, { w: t.pct + "%", speaking: t.k === "gm" }));
  const conf = {
    gm: { label: "GM stated", bg: "var(--color-success-bg)", fg: "var(--color-success-fg)" },
    theory: { label: "Party theory", bg: "var(--color-warning-bg)", fg: "var(--color-warning-fg)" },
    once: { label: "Heard once", bg: "var(--color-bg-elevated)", fg: "var(--color-fg-muted)" }
  };
  const sess = { 3: "The Eclipse Heist", 5: "Sister Merrow", 6: "Oaths at Low Water", 8: "The Tidecaller Offer", 9: "Smoke on the Docks", 10: "Debts and Riddles", 11: "Bells of Saltreach", 12: "The Drowned Abbey" };
  const F = [
    [12, "1:41:55", "Necromantic magic lies beneath the abbey bell’s shadow.", "Drowned Abbey", "Place", "gm", "Alex", "gm"],
    [12, "1:40:31", "The Diamond of Ysolde is hidden in the bell’s clapper.", "Diamond of Ysolde", "Item", "ve", "Velis", "theory"],
    [12, "1:38:02", "The tide turns at the second bell.", "Drowned Abbey", "Place", "gm", "Orsa Vell", "gm"],
    [12, "1:37:20", "Orsa Vell won’t set foot in the abbey.", "Captain Orsa Vell", "NPC", "gm", "Alex", "gm"],
    [11, "2:04:47", "The Tidecallers want the abbey sealed for good.", "The Tidecallers", "Faction", "gm", "Alex", "gm"],
    [11, "1:12:30", "The diamond is somewhere in the abbey.", "Diamond of Ysolde", "Item", "pip", "Pip", "theory"],
    [10, "0:52:10", "Orsa Vell owes Pip 20 gold.", "Captain Orsa Vell", "NPC", "pip", "Pip", "once"],
    [10, "0:51:44", "The abbot keeps what he stole close to his voice.", "The Abbot", "NPC", "gm", "Orsa Vell", "gm"],
    [9, "1:30:05", "Orsa Vell smuggles for the Tidecallers.", "Captain Orsa Vell", "NPC", "pip", "Pip", "theory"],
    [8, "2:15:40", "The Tidecallers will pay 4,000 gp for the diamond.", "The Tidecallers", "Faction", "gm", "Orsa Vell", "gm"],
    [6, "0:44:12", "Brann swore an oath to the drowned god.", "Brann Coldwater", "PC", "br", "Brann", "once"],
    [5, "1:05:19", "Whoever holds the diamond can’t tell a lie.", "Diamond of Ysolde", "Item", "gm", "Sister Merrow", "gm"],
    [3, "2:10:04", "The Diamond of Ysolde was stolen from the Saltreach temple during the eclipse.", "Diamond of Ysolde", "Item", "gm", "Alex", "gm"]
  ];
  const aboutColor = { Item: "var(--color-rarity-legendary)" };
  const facts = F.map(([s, at, t, about, type, k, who, cf]) => Object.assign({ s, at, t, about, type, who, i: P[k].i, c: P[k].c, sess: sess[s], ac: aboutColor[type] || "var(--color-fg-default)" }, { conf: conf[cf].label, cbg: conf[cf].bg, cfg: conf[cf].fg, ck: cf }));
  return { C, P, lines, talk, conf, facts, sess };
})();
