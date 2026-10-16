const assert = require("node:assert/strict");
const path = require("node:path");
const g = require("../.test-dist/utils/eventGrouping.js");
const { buildTvEventFeed } = require("../.test-dist/utils/tvDashboard.js");
const { createBaseGame } = require("./helpers/gameFixtures.cjs");

// Echte Verlaeufe (DB-Export, nur IDs/Typen/Werte) -> GroupableEvent
const toGroupable = (row) => {
  const base = { id: row.id, createdAt: row.created_at, playerId: `p${row.player_slot}`, roundNumber: row.round_number ?? undefined, turnNumber: row.turn_number ?? undefined };
  if (row.event_type === "cp-gained" || row.event_type === "cp-spent") return { ...base, kind: "cp", cpType: row.event_type === "cp-gained" ? "gained" : "spent", value: row.value_number };
  if (row.event_type.startsWith("score-")) return { ...base, kind: "score", scoreType: row.event_type.slice(6), value: row.value_number };
  return { ...base, kind: "time", timeAction: row.event_type };
};
const sums = (events) => {
  const out = {};
  for (const e of events) {
    if (e.kind === "cp") { const k = `cp|${e.playerId}|${e.cpType}`; out[k] = (out[k] ?? 0) + e.value; }
    if (e.kind === "score") { const k = `sc|${e.playerId}|${e.scoreType}`; out[k] = (out[k] ?? 0) + e.value; }
  }
  return out;
};
const groupSums = (groups) => {
  const out = {};
  for (const gr of groups) {
    for (const e of [...gr.items, ...gr.autoCp]) {
      if (e.kind === "cp") { const k = `cp|${e.playerId}|${e.cpType}`; out[k] = (out[k] ?? 0) + e.value; }
      if (e.kind === "score") { const k = `sc|${e.playerId}|${e.scoreType}`; out[k] = (out[k] ?? 0) + e.value; }
    }
  }
  return out;
};

const runEventGroupingTests = () => {
  for (const file of ["real-events-ba9ec469.json", "real-events-80ea1342.json"]) {
    const rows = require(path.join(__dirname, "fixtures", file));
    const events = rows.map(toGroupable);
    const groups = g.groupDisplayEvents(events);
    // Nichts geht verloren, nichts doppelt.
    const ids = groups.flatMap((x) => [...x.items, ...x.autoCp].map((e) => e.id));
    assert.equal(ids.length, events.length, file); assert.equal(new Set(ids).size, events.length, file);
    // Summen (Statistik/Punktestand) identisch.
    assert.deepEqual(groupSums(groups), sums(events), file);
    // Gruppensummen stimmen mit Einzelwerten.
    for (const gr of groups) {
      if (gr.kind === "cp") { assert.equal(gr.cpGained, gr.items.filter((e) => e.cpType === "gained").reduce((s, e) => s + e.value, 0)); assert.equal(gr.cpSpent, gr.items.filter((e) => e.cpType === "spent").reduce((s, e) => s + e.value, 0)); }
      if (gr.kind === "score") assert.equal(gr.scoreSum, gr.items.reduce((s, e) => s + e.value, 0));
    }
    // Pro Zug und Spieler hoechstens ein CP-Eintrag und ein Eintrag je SP-Art.
    const keys = groups.filter((x) => x.kind === "cp" || x.kind === "score").map((x) => x.key);
    assert.equal(new Set(keys).size, keys.length, file);
    // Auto-CP: keine eigenen Zeilen; jeder Zugwechsel mit Auto-CP traegt sie (beide Spieler).
    const turnStarts = groups.filter((x) => x.kind === "time" && x.first.timeAction === "turn-start");
    const withAuto = turnStarts.filter((x) => x.autoCp.length);
    assert.ok(withAuto.length >= Math.floor(turnStarts.length / 2), `${file}: Auto-CP erkannt (${withAuto.length}/${turnStarts.length})`);
    for (const t of withAuto) for (const cp of t.autoCp) { assert.equal(cp.value, 1); assert.ok(Math.abs(Date.parse(cp.createdAt) - Date.parse(t.first.createdAt)) <= g.AUTO_CP_WINDOW_MS); }
    const autoIds = new Set(withAuto.flatMap((x) => x.autoCp.map((e) => e.id)));
    assert.ok(!groups.some((x) => x.kind === "cp" && x.items.some((e) => autoIds.has(e.id))));
    // Neueste zuerst.
    for (let i = 1; i < groups.length; i++) assert.ok(Date.parse(groups[i - 1].createdAt) >= Date.parse(groups[i].createdAt));
    // Undo: letztes Einzel-Event entfernen -> Gruppen korrekt neu berechnet.
    const last = [...events].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id)).find((e) => e.kind === "cp" || e.kind === "score");
    const after = g.groupDisplayEvents(events.filter((e) => e.id !== last.id));
    assert.deepEqual(groupSums(after), sums(events.filter((e) => e.id !== last.id)), `${file}: Undo`);
    const before = groups.find((x) => x.items.some((e) => e.id === last.id));
    const afterGroup = after.find((x) => x.key === before.key);
    if (before.items.length === 1) assert.equal(afterGroup, undefined);
    else assert.equal(afterGroup.items.length, before.items.length - 1);
  }

  // Feed-Texte: Auto-CP im Zugwechsel, -1 -1 -> -2 CP, Primaer/Sekundaer getrennt, Highlights eigene Zeilen.
  const game = createBaseGame(); const [a, b] = game.players;
  const t0 = Date.parse("2026-10-16T08:00:00Z"); const at = (s) => new Date(t0 + s * 1000).toISOString();
  game.timeEvents = [{ id: "ts", type: "time", action: "turn-start", playerId: a.id, roundNumber: 1, turnNumber: 1, createdAt: at(0) }];
  game.commandPointEvents = [
    { id: "auto-a", type: "command-point", playerId: a.id, cpType: "gained", value: 1, roundNumber: 1, turnNumber: 1, createdAt: at(0) },
    { id: "auto-b", type: "command-point", playerId: b.id, cpType: "gained", value: 1, roundNumber: 1, turnNumber: 1, createdAt: at(0) },
    { id: "s1", type: "command-point", playerId: a.id, cpType: "spent", value: 1, roundNumber: 1, turnNumber: 1, createdAt: at(10) },
    { id: "s2", type: "command-point", playerId: a.id, cpType: "spent", value: 1, roundNumber: 1, turnNumber: 1, createdAt: at(20) }
  ];
  game.scoreEvents = [
    { id: "p1", type: "score", playerId: a.id, scoreType: "primary", value: 3, roundNumber: 1, turnNumber: 1, createdAt: at(30) },
    { id: "x1", type: "score", playerId: a.id, scoreType: "secondary", value: 2, roundNumber: 1, turnNumber: 1, createdAt: at(35) },
    { id: "p2", type: "score", playerId: a.id, scoreType: "primary", value: 2, roundNumber: 1, turnNumber: 1, createdAt: at(40) }
  ];
  const feed = buildTvEventFeed(game, 50, [{ id: "highlight:x", createdAt: at(31), title: "Führungswechsel", subtitle: "Alice übernimmt" }]);
  const texts = feed.map((e) => e.text);
  assert.deepEqual(texts, ["Runde 1 · Alice: +5 Primär", "Runde 1 · Alice: +2 Sekundär", "Führungswechsel: Alice übernimmt", "Runde 1 · Alice: −2 CP", "Runde 1 · Zug 1: Alice ist am Zug (auto CP each)"]);
  assert.equal(feed[2].kind, "highlight");
  // Undo des letzten Events (p2): Zeile neu berechnet.
  game.scoreEvents = game.scoreEvents.filter((e) => e.id !== "p2");
  assert.equal(buildTvEventFeed(game, 50)[0].text, "Runde 1 · Alice: +2 Sekundär");
  assert.ok(buildTvEventFeed(game, 50).some((e) => e.text === "Runde 1 · Alice: +3 Primär"));
  // Gewinn und Ausgabe im selben Zug -> ein Eintrag.
  game.commandPointEvents.push({ id: "g1", type: "command-point", playerId: a.id, cpType: "gained", value: 2, roundNumber: 1, turnNumber: 1, createdAt: at(50) });
  assert.equal(buildTvEventFeed(game, 50)[0].text, "Runde 1 · Alice: +2 / −2 CP");
  assert.equal(g.formatCpGroup({ cpGained: 0, cpSpent: 3 }), "−3 CP");

  // Neuer Verlauf (Server-Zeitstempel fuer Zeit-Events, Auto-CP ~50 ms daneben; echter ZZ-Verlauf 16.10.):
  const ev = [
    { id: "te", kind: "time", timeAction: "turn-end", playerId: "p2", roundNumber: 1, turnNumber: 1, createdAt: "2026-10-16T04:21:05.185748Z" },
    { id: "ts2", kind: "time", timeAction: "turn-start", playerId: "p1", roundNumber: 1, turnNumber: 2, createdAt: "2026-10-16T04:21:05.190716Z" },
    { id: "a1", kind: "cp", cpType: "gained", value: 1, playerId: "p1", roundNumber: 1, turnNumber: 2, createdAt: "2026-10-16T04:21:05.238Z" },
    { id: "a2", kind: "cp", cpType: "gained", value: 1, playerId: "p2", roundNumber: 1, turnNumber: 2, createdAt: "2026-10-16T04:21:05.238Z" },
    { id: "m1", kind: "cp", cpType: "gained", value: 1, playerId: "p1", roundNumber: 1, turnNumber: 2, createdAt: "2026-10-16T04:21:07.219Z" }
  ];
  const gr = g.groupDisplayEvents(ev, { "1:2": true });
  const start = gr.find((x) => x.first.id === "ts2");
  assert.deepEqual(start.autoCp.map((x) => x.id).sort(), ["a1", "a2"]);
  assert.deepEqual(gr.filter((x) => x.kind === "cp").map((x) => [x.first.id, x.cpGained]), [["m1", 1]], "manuelles +1 CP bleibt eigener Eintrag");
  // Auto-CP ausgeschaltet (kein Award fuer den Zug): keine Auto-Erkennung.
  assert.equal(g.groupDisplayEvents(ev, {}).find((x) => x.first.id === "ts2").autoCp.length, 0);

};
module.exports = { runEventGroupingTests };
