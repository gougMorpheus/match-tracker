// Timer-Regel Tim 22.10. (ersetzt aeltere Regeln): genau EIN Zug bzw. die Aufstellung zaehlt - der angewaehlte.
// Navigation (Weiter/Zurueck/Rueckgaengig, auch Aufstellung <-> R1Z1) nimmt den Timer-Zustand mit, gestoppt nur per
// Timer-Knopf, Time-out, Abschluss. Anzeige (Zugzeiten) = Statistik (Spielersummen, Spieldauer).
// Ursache dd87ec49: "Zurueck" schrieb turn-pause (laufender Zug) + turn-resume (beendeter Vorzug); die Auswertung ignorierte
// turn-resume nach turn-end -> die Zeit zaehlte nirgends. Neu: die Auswertung oeffnet den Vorzug wieder.
// Laeuft gegen .test-dist (Logik) und den Quelltext (Verdrahtung). Schlaegt gegen den alten Code an.
const assert = require("node:assert/strict");
const fs = require("node:fs"); const path = require("node:path");
const { appendLocalTimeEvents } = require("../.test-dist/utils/gameState.js");
const calc = require("../.test-dist/utils/gameCalculations.js");
const { getTurnDurationMs, getPlayerTurnDurationTotalMs, getGameDurationMs, getSetupDurationMs, isSetupActive, getActiveTurn } = calc;
const { createBaseGame } = require("./helpers/gameFixtures.cjs");
const { buildRoundsFromTimeEvents: buildRoundsFromDb } = require("../.test-dist/utils/supabaseGameMapping.js");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const at = (min) => new Date(Date.parse("2026-10-16T16:00:00.000Z") + min * 60000).toISOString();
const turn = (game, r, t) => game.rounds.find((x) => x.roundNumber === r).turns.find((x) => x.turnNumber === t);
const MIN = 60000;
const ev = (action, playerId, r, t, min) => ({ action, playerId, roundNumber: r, turnNumber: t, createdAt: at(min) });

// Anzeige = Statistik: Summe der Zugzeiten je Spieler = Spielerstatistik, Aufstellung + alle Zuege = Spieldauer
// Lokale Auswertung (gameState) und DB-Abbildung (supabaseGameMapping, beim Laden/auf anderen Geraeten) muessen gleich sein.
const assertSameAsDb = (game, label) => {
  const timing = (rounds) => rounds.flatMap((r) => r.turns.map((t) => `R${r.roundNumber}Z${t.turnNumber} ${t.timing.startedAt}|${t.timing.endedAt}|${t.timing.pauses.map((x) => `${x.startedAt}-${x.endedAt}`).join(",")}`));
  assert.deepEqual(timing(buildRoundsFromDb(game.id, game.timeEvents, game.endedAt)), timing(game.rounds), `${label}: DB-Abbildung = lokale Auswertung`);
};
const assertConsistent = (game, label) => {
  assertSameAsDb(game, label);
  const turns = game.rounds.flatMap((r) => r.turns);
  game.players.forEach((p) => {
    const sum = turns.filter((t) => t.playerId === p.id).reduce((s, t) => s + getTurnDurationMs(t, game), 0);
    assert.equal(getPlayerTurnDurationTotalMs(game, p.id), sum, `${label}: Spielersumme = Zugzeiten (${p.name})`);
  });
  const timeouts = game.rounds.reduce((s, r) => s + calc.getTimeoutDurationMs(game, r.roundNumber), 0); // Spielzeit laeuft im Time-out weiter
  const all = turns.reduce((s, t) => s + getTurnDurationMs(t, game), 0) + getSetupDurationMs(game) + timeouts;
  assert.equal(getGameDurationMs(game), all, `${label}: Spieldauer = Aufstellung + Zuege + Time-outs`);
};

const runZurueckTimerTests = () => {
  const base = createBaseGame({ id: "zz-zurueck" });
  const [p1, p2] = base.players.map((p) => p.id);
  // R1Z1 (Spieler 1) 0-10 min, R1Z2 (Spieler 2) laeuft ab 10 min
  const running = appendLocalTimeEvents(base, [
    { action: "game-start", playerId: p1, createdAt: at(0) },
    { action: "round-start", playerId: p1, roundNumber: 1, createdAt: at(0) },
    ev("turn-start", p1, 1, 1, 0), ev("turn-end", p1, 1, 1, 10), ev("turn-start", p2, 1, 2, 10)
  ]);
  const end = (game, min) => appendLocalTimeEvents(game, [{ action: "game-end", playerId: p2, createdAt: at(min) }]);
  const add = (game, events) => appendLocalTimeEvents(game, events);

  // 1) Zurueck bei laufendem Timer (12), etwas nachtragen, Weiter (20), Ende (30). Gleicher Zeitstempel in beiden Reihenfolgen.
  for (const order of ["pause-zuerst", "resume-zuerst"]) {
    const back = order === "pause-zuerst" ? [ev("turn-pause", p2, 1, 2, 12), ev("turn-resume", p1, 1, 1, 12)] : [ev("turn-resume", p1, 1, 1, 12), ev("turn-pause", p2, 1, 2, 12)];
    const fwd = order === "pause-zuerst" ? [ev("turn-pause", p1, 1, 1, 20), ev("turn-resume", p2, 1, 2, 20)] : [ev("turn-resume", p2, 1, 2, 20), ev("turn-pause", p1, 1, 1, 20)];
    const mid = add(running, back);
    assert.equal(getActiveTurn(mid), turn(mid, 1, 1), `${order}: nach Zurueck ist R1Z1 aktiv`);
    assert.ok(!turn(mid, 1, 1).timing.endedAt && calc.isTurnPaused(turn(mid, 1, 2)), `${order}: R1Z1 laeuft, R1Z2 pausiert`);
    const g = end(add(mid, fwd), 30);
    assert.equal(getTurnDurationMs(turn(g, 1, 1), g), 18 * MIN, `${order}: R1Z1 = 10 + 8 (nachgetragen)`);
    assert.equal(getTurnDurationMs(turn(g, 1, 2), g), 12 * MIN, `${order}: R1Z2 = 2 + 10`);
    assert.equal(getGameDurationMs(g), 30 * MIN, `${order}: keine Sekunde verloren`);
    assertConsistent(g, `Zurueck/${order}`);
  }

  // 2) Zurueck/Weiter bei gestopptem Timer: keine Events (nur Auswahl) -> nichts aendert sich, Timer bleibt gestoppt
  const stopped = add(running, [ev("turn-pause", p2, 1, 2, 12)]);
  const gStopped = end(stopped, 30);
  assert.equal(getTurnDurationMs(turn(gStopped, 1, 2), gStopped), 2 * MIN);
  assert.equal(getActiveTurn(stopped), turn(stopped, 1, 2), "gestoppt: aktiv bleibt der gestoppte Zug");
  // Timer an im angewaehlten (beendeten) Vorzug bei 15 -> zaehlt dort; R1Z2 laeuft NICHT verdeckt
  const startedOld = add(stopped, [ev("turn-resume", p1, 1, 1, 15)]);
  assert.equal(getActiveTurn(startedOld), turn(startedOld, 1, 1));
  const gStartedOld = end(startedOld, 30);
  assert.equal(getTurnDurationMs(turn(gStartedOld, 1, 1), gStartedOld), 25 * MIN, "Timer an im Vorzug: 10 + 15");
  assert.equal(getTurnDurationMs(turn(gStartedOld, 1, 2), gStartedOld), 2 * MIN);
  assertConsistent(gStartedOld, "Timer an im Vorzug");

  // 3) Timer-Knopf im wieder geoeffneten Zug: aus (14) / an (16) bleibt dort; Weiter gestoppt (nur Auswahl), Timer an in R1Z2 (18)
  const reopened = add(running, [ev("turn-pause", p2, 1, 2, 12), ev("turn-resume", p1, 1, 1, 12)]);
  const knopf = add(reopened, [ev("turn-pause", p1, 1, 1, 14)]);
  assert.equal(getActiveTurn(knopf), turn(knopf, 1, 1), "Timer aus: aktiv bleibt der Vorzug (zuletzt pausiert)");
  const knopfAn = add(knopf, [ev("turn-resume", p1, 1, 1, 16)]);
  assert.equal(getActiveTurn(knopfAn), turn(knopfAn, 1, 1));
  const g3 = end(add(knopfAn, [ev("turn-pause", p1, 1, 1, 17), ev("turn-resume", p2, 1, 2, 18)]), 30);
  assert.equal(getTurnDurationMs(turn(g3, 1, 1), g3), (10 + 2 + 1) * MIN);
  assert.equal(getTurnDurationMs(turn(g3, 1, 2), g3), (2 + 12) * MIN);
  assert.ok(turn(g3, 1, 1).timing.endedAt <= at(17), "Vorzug wieder beendet, kein Hintergrundlauf");
  assertConsistent(g3, "Timer-Knopf");

  // 4) Time-out im wieder geoeffneten Zug (14-16), danach laeuft er dort weiter bis Weiter (20)
  const to = add(reopened, [ev("turn-pause", p1, 1, 1, 14), { action: "timeout-start", playerId: p1, roundNumber: 1, turnNumber: 1, createdAt: at(14) },
    { action: "timeout-end", playerId: p1, roundNumber: 1, turnNumber: 1, createdAt: at(16) }, ev("turn-resume", p1, 1, 1, 16)]);
  assert.ok(!turn(to, 1, 1).timing.endedAt && !calc.isTurnPaused(turn(to, 1, 1)), "nach Time-out laeuft der Vorzug weiter");
  const g4 = end(add(to, [ev("turn-pause", p1, 1, 1, 20), ev("turn-resume", p2, 1, 2, 20)]), 30);
  assert.equal(getTurnDurationMs(turn(g4, 1, 1), g4), (10 + 2 + 4) * MIN, "Time-out zaehlt nicht als Zugzeit");
  assertConsistent(g4, "Time-out");

  // 5) Abschluss = gestoppter Timer; Wiedereroeffnen (game-end entfernt) und Timer an (40) -> zaehlt im aktiven Zug
  const closedEvents = [ev("turn-end", p2, 1, 2, 30), { action: "round-end", playerId: p2, roundNumber: 1, createdAt: at(30) }];
  const reopenedGame = add(running, [...closedEvents, ev("turn-resume", p2, 1, 2, 40)]);
  assert.equal(getActiveTurn(reopenedGame), turn(reopenedGame, 1, 2));
  const g5 = end(reopenedGame, 45);
  assert.equal(getTurnDurationMs(turn(g5, 1, 2), g5), (20 + 5) * MIN, "Neustart nach Wiedereroeffnen zaehlt (alt: ignoriert)");
  assertConsistent(g5, "Wiedereroeffnen");

  // 6) Phase vor den Zuegen: Aufstellung 0-5, R1Z1 5-8, Zurueck in die Aufstellung (8, laeuft), Weiter (10), Ende (15)
  const s0 = appendLocalTimeEvents(base, [
    { action: "game-start", playerId: p1, createdAt: at(0) }, { action: "setup-start", createdAt: at(0) },
    { action: "setup-end", createdAt: at(5) }, { action: "round-start", playerId: p1, roundNumber: 1, createdAt: at(5) }, ev("turn-start", p1, 1, 1, 5)
  ]);
  assert.equal(isSetupActive(s0), false);
  const sBack = add(s0, [ev("turn-pause", p1, 1, 1, 8), { action: "setup-start", createdAt: at(8) }]);
  assert.equal(isSetupActive(sBack), true, "Zurueck in die Aufstellung: Aufstellung aktiv");
  assert.ok(calc.isTurnPaused(turn(sBack, 1, 1)), "R1Z1 zaehlt nicht verdeckt");
  const s6 = end(add(sBack, [{ action: "setup-end", createdAt: at(10) }, ev("turn-resume", p1, 1, 1, 10)]), 15);
  assert.equal(isSetupActive(s6), false);
  assert.equal(getSetupDurationMs(s6), 7 * MIN, "Aufstellung = 5 + 2 (zweiter Abschnitt zaehlt, alt: nur erster)");
  assert.equal(getTurnDurationMs(turn(s6, 1, 1), s6), 8 * MIN, "R1Z1 = 3 + 5");
  assert.equal(getGameDurationMs(s6), 15 * MIN);
  assertConsistent(s6, "Aufstellung");
  // Aufstellung gestoppt (Timer aus 3), Weiter -> R1Z1 entsteht gestoppt (turn-start + turn-pause), bleibt gestoppt
  const sStop = appendLocalTimeEvents(base, [
    { action: "game-start", playerId: p1, createdAt: at(0) }, { action: "setup-start", createdAt: at(0) }, { action: "setup-pause", createdAt: at(3) },
    { action: "setup-end", createdAt: at(5) }, { action: "round-start", playerId: p1, roundNumber: 1, createdAt: at(5) }, ev("turn-start", p1, 1, 1, 5), ev("turn-pause", p1, 1, 1, 5)
  ]);
  assert.ok(calc.isTurnPaused(turn(sStop, 1, 1)) && getSetupDurationMs(sStop) === 3 * MIN, "gestoppt bleibt gestoppt");

  // 7) Nie zwei laufende Zuege (Altdaten ohne Pause): startet ein anderer Zug, pausiert der bisher laufende implizit
  const two = end(add(running, [ev("turn-resume", p1, 1, 1, 15)]), 30);
  assert.equal(getTurnDurationMs(turn(two, 1, 2), two), 5 * MIN, "R1Z2 zaehlt nur bis 15");
  assert.equal(getGameDurationMs(two), 30 * MIN);
  assertConsistent(two, "exklusiv");

  // Verdrahtung Store/Spielseite (Quelltext ohne Kommentarzeilen)
  const page = read("src/pages/GamePage.tsx").replace(/^\s*\/\/.*$/gm, "");
  const store = read("src/store/GameStore.tsx").replace(/^\s*\/\/.*$/gm, "");
  const goBack = page.slice(page.indexOf("const handleGoBack = async"), page.indexOf("const escapeClosers"));
  assert.match(goBack, /if \(!isReadOnly && isTimerRunning\) \{\s*await rewindLastTurn\(game\.id, selectedTurnRef, true, recordHistory\);/, "Zurueck: laufender Timer zieht mit (Vorzug UND Aufstellung)");
  assert.doesNotMatch(goBack, /setSelectedTurnKey\(previousTurn\.key\);\s*return;/, "kein reines Ansehen mehr");
  const advance = page.slice(page.indexOf("const handleAdvance = async"), page.indexOf("const handleGoBack = async"));
  assert.match(advance, /if \(canGoForwardToExistingTurn\)[\s\S]*?if \(!isReadOnly && isTimerRunning\) \{\s*await advanceGame\(game\.id, selectedTurnRef, true, recordHistory\);/);
  assert.match(page, /const isTimerRunning = !isClosed && !timeoutActive && \(Boolean\(runningTurn\) \|\| setupRunning\);/, "ein Timer-Zustand fuers Spiel");
  assert.match(page, /pauseActiveTimer\(game\.id, timerTargetRef\)/); assert.match(page, /startGameTimer\(game\.id, timerTargetRef\)/);
  assert.doesNotMatch(page + read("src/utils/timerFocus.ts"), /getTimerControlTurn/, "#39-Hilfe (Timer auf neuesten Zug) entfernt");
  assert.match(page, /latestKey = activeTurn \?/, "Auswahl folgt dem aktiven Zug (nach Neuladen, Zuschauer)");
  const undo = page.slice(page.indexOf("const handleUndoLastEvent = async"), page.indexOf("const handleRedoEvent = async"));
  assert.match(undo, /await undoGameAction\(game\.id, true\);\s*await \(wasAdvance \? handleGoBack\(false\) : handleAdvance\(false\)\);/, "Rueckgaengig = Navigation");
  const redo = page.slice(page.indexOf("const handleRedoEvent = async"), page.indexOf("const handleRedoEvent = async") + 900);
  assert.match(redo, /await redoGameAction\(game\.id, true\);\s*await \(wasAdvance \? handleAdvance\(false\) : handleGoBack\(false\)\);/);
  const setupBranch = store.slice(store.indexOf("if (isSetupTurnRef) {"), store.indexOf("if (nextExistingTurn) {"));
  assert.match(setupBranch, /if \(!setupTurn \|\| !setupTurn\.timing\.startedAt\) \{[\s\S]*?"turn-start"[\s\S]*?if \(!keepTimerRunning\) \{[\s\S]*?"turn-pause"/, "Weiter aus Aufstellung: gestoppt bleibt gestoppt");
  assert.match(setupBranch, /else if \(keepTimerRunning && \(setupTurn\.timing\.endedAt \|\| isTurnPaused\(setupTurn\)\)\)/);
  assert.match(store, /targetTurn\.timing\.startedAt && \(targetTurn\.timing\.endedAt \|\| isTurnPaused\(targetTurn\)\)\) \{\s*eventsToAdd\.push\(\{[\s\S]{0,200}"turn-resume"/, "Time-out-Ende setzt im angewaehlten Zug fort");
  assert.match(read("src/components/TvGameView.tsx"), /const turn = setupPhaseActive \? undefined : getActiveTurn\(game\);/, "TV zeigt die aktive Phase");

  // TV: Knopf "Link teilen" (aus #39) bleibt
  assert.match(page, /<TvGameView[\s\S]{0,200}onShareLink=\{\(\) => \{ void handleShareLink\(\); \}\}/);
  const tv = read("src/components/TvGameView.tsx");
  assert.match(tv, /\{onShareLink \? <button type="button" className="tv-game__share" onClick=\{onShareLink\}>Link teilen<\/button> : null\}/);
  assert.ok(tv.indexOf("tv-game__share") > tv.indexOf('className="tv-game__controls"'), "Knopf in der TV-Leiste (neben Full screen)");

  // #42 (Pepper 22.10.): TV-Kopfzeile, "Am Zug" und Uebersicht folgen dem AKTIVEN Zug, nicht dem neuesten
  assert.match(tv, /turn \? `Runde \$\{turn\.roundNumber\} · Zug \$\{turn\.turnNumber\}`/, "TV-Kopfzeile aus dem aktiven Zug");
  assert.match(tv, /const activePlayerId = turn\?\.playerId \?\? game\.currentPlayerId;/);
  assert.match(tv, /active = !completed && activePlayerId === p\.id;/, "TV: Am Zug = Spieler des aktiven Zugs");
  assert.match(read("src/components/GameOverview.tsx"), /const currentTurn = getActiveTurn\(game\);/, "Uebersicht: aktueller Zug = aktiver Zug");
  {
    // Szenario Pepper: R1Z1 (ZZ-A) beendet, R1Z2 (ZZ-B) laeuft, Zurueck bei laufendem Timer -> R1Z1 aktiv
    const g0 = createBaseGame({ id: "tv-aktiv" }); const [a1, b1] = g0.players.map((pl) => pl.id);
    const t0 = Date.parse("2026-10-22T18:00:00.000Z"); const iso = (sec) => new Date(t0 + sec * 1000).toISOString();
    const g = appendLocalTimeEvents(g0, [
      { action: "game-start", playerId: a1, createdAt: iso(0) },
      { action: "round-start", playerId: a1, roundNumber: 1, createdAt: iso(0) },
      { action: "turn-start", playerId: a1, roundNumber: 1, turnNumber: 1, createdAt: iso(0) },
      { action: "turn-end", playerId: a1, roundNumber: 1, turnNumber: 1, createdAt: iso(60) },
      { action: "turn-start", playerId: b1, roundNumber: 1, turnNumber: 2, createdAt: iso(60) },
      { action: "turn-pause", playerId: b1, roundNumber: 1, turnNumber: 2, createdAt: iso(120) },
      { action: "turn-resume", playerId: a1, roundNumber: 1, turnNumber: 1, createdAt: iso(120) }
    ]);
    const active = calc.getActiveTurn(g);
    assert.deepEqual([active.roundNumber, active.turnNumber, active.playerId], [1, 1, a1], "aktiver Zug R1Z1 (ZZ-A)");
    assert.equal(calc.getCurrentTurnNumber(g), 2, "neuester Zug bleibt R1Z2 - darf fuer die Anzeige nicht genutzt werden");
  }

  // Punkt 4: Verlaufs-Label nennt den verlassenen Abschnitt; Aufstellung -> R1Z1 heisst "Weiter Aufstellung"
  assert.equal((store.match(/"Weiter Aufstellung",\s*null,/g) || []).length, 2, "beide Aufstellungs-Zweige");
  assert.match(page, /const isTimerHistoryLabel = \(label: string\): boolean => label\.startsWith\("Timer "\) \|\| label\.startsWith\("Time-out"\);/);
  assert.match(page, /if \(isTimerHistoryLabel\(undoActionLabel\)\) snapToLatestTurnRef\.current = true;\s*await undoGameAction\(game\.id\);/);
  assert.match(page, /if \(isTimerHistoryLabel\(redoActionLabel\)\) snapToLatestTurnRef\.current = true;\s*await redoGameAction\(game\.id\);/);
  {
    const { resolveSelectedTurnKey, SETUP_TURN_KEY } = require("../.test-dist/utils/turnSelection.js");
    const base = { current: "1-1", previousLatestKey: "1-1", latestKey: "1-1", turnKeys: ["1-1", "1-2"], setupStarted: true };
    assert.equal(resolveSelectedTurnKey({ ...base, snapToLatest: true, setupRunning: true }), SETUP_TURN_KEY, "Undo Timer aus in der Aufstellung -> Aufstellung angewaehlt");
    assert.equal(resolveSelectedTurnKey({ ...base, current: "1-2", snapToLatest: true, setupRunning: false }), "1-1", "Undo -> laufender Zug angewaehlt");
  }

  // Punkt 5: Startspieler-Dialog bleibt nach Neuladen aus dem lokalen Cache erhalten (leerer Startspieler bleibt leer)
  {
    const { mapPersistedGame } = require("../.test-dist/utils/gameState.js");
    const g0 = createBaseGame({ id: "ohne-start" });
    assert.equal(mapPersistedGame({ ...g0, startingPlayerId: "" }).startingPlayerId, "", "kein stilles Setzen von Spieler 1");
    const legacy = { ...g0 }; delete legacy.startingPlayerId;
    const mapped = mapPersistedGame(legacy);
    assert.equal(mapped.startingPlayerId, mapped.players[0].id, "Altdaten ohne Feld: Fallback Spieler 1");
  }
  assert.match(page, /const needsStartingPlayerBeforeFirstTurn = !game\.startingPlayerId && \(isSetupSelected \|\| !latestRound\);/);
};

// #43 (Pepper 22.10. A/B): Navigation bei gestopptem Timer schreibt zeitneutrale Markierungen mit vorhandenen Ereignistypen.
const runGestoppteNavigationTests = () => {
  const base = createBaseGame({ id: "zz-gestoppt" });
  const [p1, p2] = base.players.map((p) => p.id);
  const add = (game, events) => appendLocalTimeEvents(game, events);
  const ms = (g) => g.rounds.flatMap((r) => r.turns).map((t) => getTurnDurationMs(t, g));
  const key = (t) => `R${t.roundNumber}Z${t.turnNumber}`;
  // R1Z1 0-10, R1Z2 10-12, Zurueck laufend (12) -> R1Z1 bis Timer aus (14)
  const stopped = add(base, [
    { action: "game-start", playerId: p1, createdAt: at(0) },
    { action: "round-start", playerId: p1, roundNumber: 1, createdAt: at(0) },
    ev("turn-start", p1, 1, 1, 0), ev("turn-end", p1, 1, 1, 10), ev("turn-start", p2, 1, 2, 10),
    ev("turn-pause", p2, 1, 2, 12), ev("turn-resume", p1, 1, 1, 12), ev("turn-pause", p1, 1, 1, 14)
  ]);
  const ref = ms(stopped);
  assert.equal(key(getActiveTurn(stopped)), "R1Z1");
  // A: gestoppt Weiter -> Z2 (Markierung turn-pause R1Z2), dann Zurueck -> Z1
  const toZ2 = add(stopped, [ev("turn-pause", p2, 1, 2, 15)]);
  assert.equal(key(getActiveTurn(toZ2)), "R1Z2", "gestoppter Weiter: Z2 aktiv (aus den Ereignissen, also auch nach Neuladen/auf anderen Geraeten)");
  assert.deepEqual(ms(toZ2), ref, "Markierung verschiebt keine Zeit"); assertConsistent(toZ2, "Markierung Z2");
  const backZ1 = add(toZ2, [ev("turn-pause", p1, 1, 1, 16)]);
  assert.equal(key(getActiveTurn(backZ1)), "R1Z1", "gestoppter Zurueck: Z1 aktiv"); assert.deepEqual(ms(backZ1), ref);
  // Timer an im per Markierung gewaehlten Z2: Z1 wird ohne Zusatzzeit wieder beendet, Z2 zaehlt ab 17
  const runZ2 = add(toZ2, [ev("turn-resume", p2, 1, 2, 17)]);
  const fin = add(runZ2, [ev("turn-end", p2, 1, 2, 20), { action: "game-end", playerId: p2, createdAt: at(20) }]);
  assert.equal(getTurnDurationMs(turn(fin, 1, 1), fin), 12 * MIN, "R1Z1 = 10 + 2 (12-14), Markierungen ohne Zeit");
  assert.equal(getTurnDurationMs(turn(fin, 1, 2), fin), 5 * MIN, "R1Z2 = 2 + 3 (17-20)");
  assertConsistent(fin, "Timer an nach Markierung");
  assert.equal(key(getActiveTurn(fin)), "R1Z2", "abgeschlossen: wie bisher neuester Zug");

  // Aufstellung 0-5, R1Z1 5-8 (Timer aus); gestoppt Zurueck (setup-pause 9), Timer an (setup-start 10) bis 12, gestoppt Weiter (13)
  const s0 = add(base, [
    { action: "game-start", playerId: p1, createdAt: at(0) }, { action: "setup-start", createdAt: at(0) },
    { action: "setup-end", createdAt: at(5) }, { action: "round-start", playerId: p1, roundNumber: 1, createdAt: at(5) },
    ev("turn-start", p1, 1, 1, 5), ev("turn-pause", p1, 1, 1, 8)
  ]);
  assert.equal(getSetupDurationMs(s0), 5 * MIN); assert.ok(!calc.isSetupActive(s0));
  const s1 = add(s0, [{ action: "setup-pause", createdAt: at(9) }]);
  assert.ok(calc.isSetupActive(s1) && calc.isSetupPaused(s1), "gestoppter Zurueck: Aufstellung aktiv (gestoppt)");
  assert.ok(!calc.isSetupSegmentOpen(s1), "kein offener Abschnitt -> Timer an schreibt setup-start");
  assert.equal(getSetupDurationMs(s1), 5 * MIN, "Markierung ohne Aufstellungszeit"); assert.deepEqual(ms(s1), ms(s0)); assertConsistent(s1, "setup-pause Markierung");
  const s2 = add(s1, [{ action: "setup-start", createdAt: at(10) }, { action: "setup-pause", createdAt: at(12) }]);
  assert.ok(calc.isSetupSegmentOpen(s2) && calc.isSetupPaused(s2));
  assert.equal(getSetupDurationMs(s2), 7 * MIN, "Aufstellung 5 + 2"); assert.equal(getTurnDurationMs(turn(s2, 1, 1), s2), 3 * MIN);
  const s3 = add(s2, [{ action: "setup-end", createdAt: at(13) }, ev("turn-pause", p1, 1, 1, 13)]);
  assert.ok(!calc.isSetupActive(s3), "gestoppter Weiter aus der Aufstellung: Aufstellung beendet");
  assert.equal(key(getActiveTurn(s3)), "R1Z1"); assert.equal(getSetupDurationMs(s3), 7 * MIN); assert.equal(getTurnDurationMs(turn(s3, 1, 1), s3), 3 * MIN);
  assertConsistent(s3, "Weiter aus Aufstellung gestoppt");

  // Auswahl folgt im bearbeitbaren Spiel immer der aktiven Phase (keine reine Ansicht)
  const { resolveSelectedTurnKey, SETUP_TURN_KEY } = require("../.test-dist/utils/turnSelection.js");
  const sel = { current: "1:2", previousLatestKey: "1:2", latestKey: "1:1", turnKeys: ["1:1", "1:2"], snapToLatest: false, setupStarted: true };
  assert.equal(resolveSelectedTurnKey({ ...sel, followActive: true }), "1:1");
  assert.equal(resolveSelectedTurnKey({ ...sel, followActive: true, setupActive: true }), SETUP_TURN_KEY);
  assert.equal(resolveSelectedTurnKey({ ...sel, followActive: false, previousLatestKey: "1:1" }), "1:2", "Ansichtsmodus (TV/beendet) bleibt frei");

  // Verdrahtung: gestoppte Navigation -> selectPhase (Verlauf advance-turn/rewind-turn, Undo/Redo = Navigation)
  const page = read("src/pages/GamePage.tsx"); const store = read("src/store/GameStore.tsx");
  assert.equal((page.match(/await selectPhase\(game\.id,/g) || []).length, 3, "Weiter (Aufstellung/Folgezug) und Zurueck");
  assert.match(page, /followActive: !viewOnlyActive,\s*setupActive: isSetupActive\(game\)/);
  assert.match(store, /recordHistory \? \(label === "Weiter" \? "advance-turn" : "rewind-turn"\) : "snapshot"/);
  assert.equal((store.match(/isSetupPaused\(game\) && isSetupSegmentOpen\(game\)/g) || []).length, 2, "Timer an: setup-resume nur im offenen Abschnitt");
};

module.exports = { runZurueckTimerTests, runGestoppteNavigationTests };

