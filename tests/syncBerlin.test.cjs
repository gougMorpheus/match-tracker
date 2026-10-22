// #45 (Pepper 22.10., Nachtest #44): TV-Tab im Hintergrund blieb stehen, Sync-Uhrzeit in Browser-Zeitzone,
// weich geloeschtes Spiel kam ueber den Cache der Live-Ansicht zurueck. Laeuft gegen .test-dist und den Quelltext.
// Schlaegt gegen den alten Code an.
const assert = require("node:assert/strict");
const fs = require("node:fs"); const path = require("node:path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

// Browser in anderer Zeitzone (Pepper: "14:57" statt 20:57 MESZ -> UTC-4).
const withTz = (tz, fn) => { const old = process.env.TZ; process.env.TZ = tz; try { fn(); } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; } };

const runBerlinZeitTests = () => {
  const time = require("../.test-dist/utils/time.js");
  const mapping = require("../.test-dist/utils/supabaseGameMapping.js");
  for (const tz of ["America/New_York", "Asia/Tokyo", "UTC", "Europe/Berlin"]) withTz(tz, () => {
    assert.equal(new Date("2026-10-22T18:57:00Z").getTimezoneOffset() === -120, tz === "Europe/Berlin", `${tz}: Testumgebung`);
    assert.equal(time.formatClockTime("2026-10-22T18:57:00.000Z"), "20:57", `${tz}: Uhrzeit (Ereignisse, Start, TV) in Berlin`);
    assert.equal(time.formatClockTimeWithSeconds("2026-10-22T18:57:05.000Z"), "20:57:05", `${tz}: mit Sekunden`);
    assert.equal(time.formatClockTime("2026-12-01T19:30:00.000Z"), "20:30", `${tz}: Winterzeit`);
    assert.equal(time.toLocalDateInput(new Date("2026-10-22T22:30:00Z")), "2026-10-23", `${tz}: Datum nach Mitternacht Berlin`);
    assert.equal(time.toLocalTimeInput(new Date("2026-10-22T18:57:00Z")), "20:57", `${tz}: Vorbelegung Uhrzeit`);
    assert.equal(mapping.combineScheduledDateTime("2026-10-22", "20:00"), "2026-10-22T18:00:00.000Z", `${tz}: geplanter Start = Berliner Uhrzeit`);
    assert.equal(mapping.combineScheduledDateTime("2026-12-01", "20:00"), "2026-12-01T19:00:00.000Z", `${tz}: Winterzeit`);
    assert.equal(mapping.combineScheduledDateTime("2026-03-29", "03:30"), "2026-03-29T01:30:00.000Z", `${tz}: Tag der Zeitumstellung`);
    assert.deepEqual(mapping.getScheduledDateParts("2026-10-22T18:00:00.000Z"), { date: "2026-10-22", time: "20:00" }, `${tz}: Rueckweg`);
    assert.equal(time.toBerlinDateTimeInput(new Date("2026-10-22T18:57:05Z")), "2026-10-22T20:57:05", `${tz}: Ereigniszeit-Eingabe`);
    assert.equal(new Date(time.berlinWallClockToMs("2026-10-22", "20:57:05")).toISOString(), "2026-10-22T18:57:05.000Z", `${tz}: Eingabe zurueck`);
    assert.ok(Number.isNaN(time.berlinWallClockToMs("", "20:00")), "ungueltig");
  });
  const layout = read("src/components/Layout.tsx");
  assert.match(layout, /new Intl\.DateTimeFormat\("de-DE", \{\s*timeZone: APP_TIME_ZONE,/, "Sync-Zeitpunkt im Kopf in Berlin");
  const page = read("src/pages/GamePage.tsx");
  assert.match(page, /return toBerlinDateTimeInput\(date\);/); assert.match(page, /berlinWallClockToMs\(datePart, timePart\)/);
  assert.match(read("src/battle-cal/battle-cal.html"), /toLocaleString\("de-DE", \{\s*timeZone: "Europe\/Berlin",/, "Battle-Cal Verlauf");
  // Keine weiteren Formatierungen in Browser-Zeitzone (Datum aus Wanduhr-Feldern ist zeitzonenneutral).
  const offenders = [];
  const walk = (dir) => fs.readdirSync(path.join(__dirname, "..", dir), { withFileTypes: true }).forEach((e) => {
    const rel = `${dir}/${e.name}`; if (e.isDirectory()) return walk(rel); if (!/\.(ts|tsx)$/.test(e.name)) return;
    read(rel).split("\n").forEach((line, i) => { if (/toLocale(Time)?String\(|Intl\.DateTimeFormat\(/.test(line)) {
      const block = read(rel).split("\n").slice(i, i + 3).join(" ");
      if (!/timeZone/.test(block) && !/toLocaleDateString/.test(line)) offenders.push(`${rel}:${i + 1}`); } });
  });
  walk("src"); assert.deepEqual(offenders, [], "Uhrzeit-Formatierung ohne feste Zeitzone");
};

const runQueueCacheTests = () => {
  const { reconcileQueueWithStorage, mergeQueueWrite, canSendQueueNow, mergeLiveGameIntoCache } = require("../.test-dist/utils/deltaPull.js");
  // #45/#46: TV-Tab hat beim Start q1 (Editor) uebernommen; der Editor hat q1 gesendet. q9 hat dieser Tab selbst angelegt.
  const own = [{ id: "q1", gameId: "tv" }, { id: "q3", gameId: "tv" }, { id: "q9", gameId: "x" }];
  const r1 = reconcileQueueWithStorage(own, [{ id: "q3", gameId: "tv" }], new Set(["q9"]));
  assert.deepEqual(r1.queue.map((i) => i.id), ["q3", "q9"], "gesendeter fremder Eintrag faellt weg, eigener bleibt immer");
  assert.deepEqual(r1.missingOwned.map((i) => i.id), ["q9"], "eigener fehlender Eintrag wird zurueckgeschrieben");
  const r2 = reconcileQueueWithStorage(own, own, new Set()); assert.equal(r2.queue, own, "unveraendert -> gleiche Liste (kein Neuladen)");
  // Schreiben = nur die eigene Aenderung (Variante 2 / zweiter Tab): fremde ungesendete Eintraege bleiben
  const stored = [{ id: "a1" }, { id: "a2" }, { id: "b0" }];
  assert.deepEqual(mergeQueueWrite(stored, [{ id: "a1" }, { id: "b0" }], [{ id: "a1" }, { id: "b0" }, { id: "b1" }], new Set(["b1"])).map((i) => i.id),
    ["a1", "a2", "b0", "b1"], "neuer Eintrag kommt dazu, a2 (anderer Tab, hier unbekannt) bleibt");
  assert.deepEqual(mergeQueueWrite(stored, [{ id: "a1" }, { id: "b0" }], [{ id: "b0" }], new Set()).map((i) => i.id), ["a2", "b0"],
    "nur selbst entfernte (gesendete) fallen weg");
  assert.deepEqual(mergeQueueWrite(stored, [{ id: "b0", v: 1 }], [{ id: "b0", v: 2 }], new Set()), [{ id: "a1" }, { id: "a2" }, { id: "b0", v: 2 }],
    "Rebase ersetzt nur den eigenen Eintrag");
  assert.deepEqual(mergeQueueWrite([{ id: "a1" }], [{ id: "b5" }, { id: "x" }], [{ id: "b5" }, { id: "x" }, { id: "b6" }], new Set(["b5", "b6"])).map((i) => i.id),
    ["a1", "b5", "b6"], "eigener ungesendeter Eintrag, der in localStorage fehlt, wird ergaenzt; fremder gesendeter (x) nicht wiederbelebt");
  assert.equal(canSendQueueNow(true), true, "Senden eigener Aenderungen haengt nicht an der Sichtbarkeit");
  assert.equal(canSendQueueNow(false), false);
  // Live-Ansicht: nur das eigene Spiel im Cache ersetzen; inzwischen geloeschtes Spiel "weg" bleibt weg.
  const cached = [{ id: "a", v: 1 }]; const memory = [{ id: "tv", v: 2 }, { id: "weg", v: 1 }, { id: "a", v: 0 }];
  assert.deepEqual(mergeLiveGameIntoCache(cached, memory, "tv"), [{ id: "tv", v: 2 }, { id: "a", v: 1 }]);
  assert.deepEqual(mergeLiveGameIntoCache([{ id: "tv", v: 1 }, ...cached], [], "tv"), cached, "Live-Spiel geloescht -> entfernt");
  const store = read("src/store/GameStore.tsx");
  assert.match(store, /window\.addEventListener\("storage", onStorage\);\s*reconcile\(\);/, "Queue anderer Tabs wird verfolgt (auch direkt nach dem Start)");
  assert.equal((store.match(/saveSyncQueue\(/g) || []).length, 2, "nur zwei Schreibstellen");
  assert.match(store, /saveSyncQueue\(mergeQueueWrite\(loadSyncQueue\(\), previousQueue, nextQueue, ownedQueueIdsRef\.current\)\);/, "frisch lesen, zusammenfuehren");
  assert.match(store, /if \(missingOwned\.length\) saveSyncQueue\(\[\.\.\.stored, \.\.\.missingOwned\]\);/);
  assert.match(store, /useEffect\(\(\) => \{\s*queueRef\.current = syncQueue;\s*\}, \[syncQueue\]\);/, "kein Zurueckschreiben der ganzen Queue (auch nicht beim Start)");
  assert.equal((store.match(/canSendQueueNow\(isBrowserOnline\(\)\)/g) || []).length, 4, "Senden/Nachsenden: Retry, Flush, Queue-Effekt, Hintergrund-Refresh");
  assert.match(store, /if \(isDocumentHidden\(\) && canSendQueueNow\(isBrowserOnline\(\)\) && queueRef\.current\.some\(\(item\) => !isGameViewOnly\(item\.gameId\)\)\) \{\s*\/\/[^\n]*\n\s*await flushSyncQueue\(\);/);
  assert.match(store, /saveCachedGames\(liveGameId \? mergeLiveGameIntoCache\(loadCachedGames\(\), nextGames, liveGameId\) : nextGames\);/);
  const live = store.slice(store.indexOf("const loadLiveGame = useCallback"), store.indexOf("const resumeLiveView"));
  assert.ok(!/saveCachedGames\(/.test(live), "Live-Laden schreibt nicht mehr die ganze Liste in den Cache");
  assert.match(store, /gamesRef\.current = games;\s*saveGamesCacheRef\.current\(games\);/);
};

module.exports = { runBerlinZeitTests, runQueueCacheTests };
