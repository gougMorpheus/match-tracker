const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mem = require("../.test-dist/utils/accessModeMemory.js");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

const runAbcTests = () => {
  // (a) Auswahl "Match öffnen" pro Spiel merken
  assert.deepEqual(mem.parseAccessModeMemory(null), {});
  assert.deepEqual(mem.parseAccessModeMemory("kaputt"), {});
  assert.deepEqual(mem.parseAccessModeMemory('{"a":{"mode":"admin","at":"x"},"b":{"mode":"view","at":"2026"}}'), { b: { mode: "view", at: "2026" } });
  let m = mem.setAccessModeInMemory({}, "g1", "edit", "2026-10-16T07:00:00Z");
  m = mem.setAccessModeInMemory(m, "g2", "view", "2026-10-16T07:01:00Z");
  assert.equal(m.g1.mode, "edit"); assert.equal(m.g2.mode, "view");
  assert.equal(mem.setAccessModeInMemory(m, "g1", null, "x").g1, undefined);
  let big = {};
  for (let i = 0; i < 205; i++) big = mem.setAccessModeInMemory(big, `g${i}`, "edit", `2026-10-16T07:${String(i % 60).padStart(2, "0")}:${String(Math.floor(i / 60)).padStart(2, "0")}Z`);
  assert.equal(Object.keys(big).length, 200);
  const page = read("src/pages/GamePage.tsx");
  assert.ok(page.includes('rememberAccessMode(game.id, "edit")') && page.includes('rememberAccessMode(game.id, "view")'), "Dialog merkt sich die Wahl");
  assert.ok(page.includes("loadRememberedAccessMode(props.gameId)") && page.includes("useLayoutEffect"), "Wahl wird vor dem Zeichnen übernommen");
  assert.ok(/!props\.forceTv && !isGameCompletedForDisplay\(game\)/.test(page), "nur laufende Spiele, nicht bei ?tv=1");
  assert.ok(read("src/store/GameStore.tsx").includes(`rememberAccessMode(createdGame.id, "edit")`), "Neues Spiel: Edit gemerkt");
  assert.ok(page.includes('setReopenPasswordError("Falsches Passwort.")'), "Passwortschutz unverändert");
  // (b) Enter im Namensfeld schickt das Formular nicht ab
  const field = read("src/components/SelectOrCreateField.tsx");
  assert.ok(/event\.key !== "Enter"[\s\S]*event\.preventDefault\(\)/.test(field), "Enter wird abgefangen");
  assert.equal((field.match(/onKeyDown=\{handleInputKeyDown\}/g) || []).length, 2, "beide Eingabefelder");
  // (c) Beschriftung "+ Spieler" mit Tooltip
  const pf = read("src/components/GamePlayerFields.tsx");
  assert.ok(pf.includes('createButtonLabel="+ Spieler"') && pf.includes('createButtonTitle="Neuen Spieler anlegen'), "+ Spieler");
  assert.ok(field.includes("title={createButtonTitle"), "Tooltip");
  assert.ok(field.includes("aria-label={`${label}: neue Eingabe`}"), "aria-label unverändert");
};
module.exports = { runAbcTests };
// Retest Pepper 2: Reihenfolge Rundenabschluss vor Rundenbeginn, Menüpunkt, Öffnen aus Notifications
const { groupDisplayEvents, getSameTimeRank } = require("../.test-dist/utils/eventGrouping.js");
const runRetest2Tests = () => {
  const t = "2026-10-16T07:14:31.815Z";
  // Echte Lage (ZZ-Timer2 8598cc2f, 09:25:24.119): round-start, round-end, turn-start mit identischem Zeitstempel.
  // UUIDs beginnen mit 0-9/a-f, sind also im ID-Vergleich kleiner als "highlight:" – vorher stand der Abschluss oben.
  const g = groupDisplayEvents([
    { id: "highlight:round-summary:r3t1:false", createdAt: t, kind: "highlight" },
    { id: "7a824fcf-round-start", createdAt: t, kind: "time", timeAction: "round-start", roundNumber: 3 },
    { id: "f5b3e5e3-turn-start", createdAt: t, kind: "time", timeAction: "turn-start", roundNumber: 3, turnNumber: 1 },
    { id: "0000-round-start", createdAt: t, kind: "time", timeAction: "round-start", roundNumber: 3 },
    { id: "a36275da-turn-end", createdAt: "2026-10-16T07:14:31.800Z", kind: "time", timeAction: "turn-end", roundNumber: 2, turnNumber: 2 }
  ]);
  const order = g.map((x) => x.first.id);
  assert.equal(order.indexOf("highlight:round-summary:r3t1:false"), order.length - 2, "neueste zuerst: Abschluss unter allen gleichzeitigen Beginn-Events, über dem älteren Zugende");
  assert.equal(order[order.length - 1], "a36275da-turn-end");
  const asc = [...g].reverse().map((x) => x.first.id);
  assert.ok(asc.indexOf("highlight:round-summary:r3t1:false") < asc.indexOf("7a824fcf-round-start"), "chronologisch: erst Abschluss, dann Beginn");
  assert.equal(getSameTimeRank({ id: "highlight:lead-change:x" }), 0);
  const page = fs.readFileSync(path.join(__dirname, "..", "src/pages/GamePage.tsx"), "utf8");
  assert.equal((page.match(/\.\.\.accessChoiceMenuItems/g) || []).length, 2, "Match öffnen in Edit- und View-only-Menü");
  const nc = fs.readFileSync(path.join(__dirname, "..", "src/components/NotificationsCenter.tsx"), "utf8");
  assert.ok(nc.includes("window.location.hash = getTvModeHash(id)"), "Öffnen aus Notifications = View only");
};
module.exports.runRetest2Tests = runRetest2Tests;
