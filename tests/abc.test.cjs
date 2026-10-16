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
