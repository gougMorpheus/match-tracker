// Zurueck-Fix (dd87ec49) und TV-Knopf "Link teilen". Laeuft gegen .test-dist (Logik) und den Quelltext (Verdrahtung).
const assert = require("node:assert/strict");
const fs = require("node:fs"); const path = require("node:path");
const { getTimerControlTurn } = require("../.test-dist/utils/timerFocus.js");
const { appendLocalTimeEvents } = require("../.test-dist/utils/gameState.js");
const { getTurnDurationMs, getPlayerTurnDurationTotalMs } = require("../.test-dist/utils/gameCalculations.js");
const { createBaseGame } = require("./helpers/gameFixtures.cjs");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const at = (min) => new Date(Date.parse("2026-10-16T16:00:00.000Z") + min * 60000).toISOString();
const turn = (game, r, t) => game.rounds.find((x) => x.roundNumber === r).turns.find((x) => x.turnNumber === t);

const runZurueckTimerTests = () => {
  // Spiel: R1Z1 (Spieler 1) 0-10 min, R1Z2 (Spieler 2) laeuft ab 10 min
  const base = createBaseGame({ id: "zz-zurueck" });
  const [p1, p2] = base.players.map((p) => p.id);
  const running = appendLocalTimeEvents(base, [
    { action: "game-start", playerId: p1, createdAt: at(0) },
    { action: "round-start", playerId: p1, roundNumber: 1, createdAt: at(0) },
    { action: "turn-start", playerId: p1, roundNumber: 1, turnNumber: 1, createdAt: at(0) },
    { action: "turn-end", playerId: p1, roundNumber: 1, turnNumber: 1, createdAt: at(10) },
    { action: "turn-start", playerId: p2, roundNumber: 1, turnNumber: 2, createdAt: at(10) }
  ]);
  const end = (game) => appendLocalTimeEvents(game, [{ action: "game-end", playerId: p2, createdAt: at(30) }]);

  // Ursache belegt: altes Muster von "Zurueck" bei laufendem Timer (turn-pause R1Z2 + turn-resume des beendeten R1Z1 bei 12 min,
  // spaeter "Weiter"/turn-resume R1Z2 bei 20 min). Die Auswertung ignoriert turn-resume nach turn-end -> 8 min zaehlen nirgends.
  const old = end(appendLocalTimeEvents(running, [
    { action: "turn-pause", playerId: p2, roundNumber: 1, turnNumber: 2, createdAt: at(12) },
    { action: "turn-resume", playerId: p1, roundNumber: 1, turnNumber: 1, createdAt: at(12) },
    { action: "turn-resume", playerId: p2, roundNumber: 1, turnNumber: 2, createdAt: at(20) }
  ]));
  assert.equal(getTurnDurationMs(turn(old, 1, 1), old), 10 * 60000, "beendeter Vorzug bekommt nichts (resume ignoriert)");
  assert.equal(getTurnDurationMs(turn(old, 1, 2), old), 12 * 60000, "altes Muster: 8 min von R1Z2 verloren");
  // Neu: Zurueck schreibt nichts -> R1Z2 laeuft durch, Anzeige (Turn-Modell) = Statistik (gleiches Modell)
  const fixed = end(running);
  assert.equal(getTurnDurationMs(turn(fixed, 1, 2), fixed), 20 * 60000, "neu: keine Zeit verloren");
  assert.equal(getPlayerTurnDurationTotalMs(fixed, p2), 20 * 60000, "Statistik-Summe = Zugzeit");

  // Timer-Ziel bei angesehenem beendetem Vorzug = neuester Zug; sonst der angesehene Zug
  const r1z1 = turn(running, 1, 1); const r1z2 = turn(running, 1, 2);
  assert.equal(getTimerControlTurn(r1z1, r1z2), r1z2, "beendeter Vorzug -> Timer wirkt auf laufenden Zug");
  assert.equal(getTimerControlTurn(r1z2, r1z2), r1z2);
  assert.equal(getTimerControlTurn(undefined, r1z2), r1z2);
  assert.equal(getTimerControlTurn(r1z2, undefined), r1z2);
  const openOlder = { ...r1z1, timing: { ...r1z1.timing, endedAt: undefined } };
  assert.equal(getTimerControlTurn(openOlder, r1z2), openOlder, "nicht beendeter Zug bleibt Ziel (wie bisher)");

  // Verdrahtung in GamePage
  const page = read("src/pages/GamePage.tsx").replace(/^\s*\/\/.*$/gm, ""); // nur Code, ohne Kommentarzeilen
  const goBack = page.slice(page.indexOf("const handleGoBack = async"), page.indexOf("// Escape schliesst den obersten"));
  const prevBranch = goBack.slice(goBack.indexOf("if (previousTurn) {"), goBack.indexOf("if (selectedTurnIndex === 0 && hasSetupPhase)"));
  assert.ok(prevBranch.length > 50, "Zweig 'vorheriger Zug' gefunden");
  assert.doesNotMatch(prevBranch, /rewindLastTurn/, "Zurueck auf vorherigen Zug schreibt keine Timer-Events");
  assert.match(goBack.slice(goBack.indexOf("hasSetupPhase")), /rewindLastTurn\(/, "Zurueck in die Aufstellung unveraendert");
  assert.match(page, /const isPaused = isTurnPaused\(timerControlTurn\)/);
  assert.match(page, /pauseActiveTimer\(game\.id, timerControlRef\)/); assert.match(page, /startGameTimer\(game\.id, timerControlRef\)/);
  assert.match(page, /await startTimeout\(game\.id, timerControlRef\)/); assert.match(page, /await endTimeout\(game\.id, timerControlRef\)/);
  assert.doesNotMatch(page, /startGameTimer\(\s*game\.id,\s*selectedTurn/, "Timer an nie auf angesehenen (evtl. beendeten) Zug");
  const advance = page.slice(page.indexOf("const handleAdvance = async"), page.indexOf("const handleGoBack = async"));
  assert.match(advance, /if \(canGoForwardToExistingTurn\)[\s\S]*?isSelectedTurnTimerRunning/, "Weiter auf vorhandenen Zug wie bisher (angesehener Zug)");

  // TV: Knopf "Link teilen" nutzt den vorhandenen handleShareLink (Direktlink ?tv=1, kopieren / Teilen-Dialog)
  assert.match(page, /<TvGameView[\s\S]{0,200}onShareLink=\{\(\) => \{ void handleShareLink\(\); \}\}/);
  const tv = read("src/components/TvGameView.tsx");
  assert.match(tv, /\{onShareLink \? <button type="button" className="tv-game__share" onClick=\{onShareLink\}>Link teilen<\/button> : null\}/);
  assert.ok(tv.indexOf("tv-game__share") > tv.indexOf('className="tv-game__controls"'), "Knopf in der TV-Leiste (neben Full screen)");
};

module.exports = { runZurueckTimerTests };
