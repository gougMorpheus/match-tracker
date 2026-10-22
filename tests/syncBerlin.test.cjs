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
  const { dropSettledForeignQueueItems, mergeLiveGameIntoCache } = require("../.test-dist/utils/deltaPull.js");
  // TV-Tab (View only fuer "tv") hat beim Start den Eintrag q1 des Editor-Tabs uebernommen; der Editor hat ihn gesendet.
  const own = [{ id: "q1", gameId: "tv" }, { id: "q2", gameId: "andere" }, { id: "q3", gameId: "tv" }];
  const viewOnly = (gameId) => gameId === "tv";
  assert.deepEqual(dropSettledForeignQueueItems(own, [{ id: "q3", gameId: "tv" }], viewOnly).map((i) => i.id), ["q2", "q3"],
    "gesendeter fremder Eintrag faellt weg, noch wartender bleibt, eigene sendbare bleiben");
  assert.equal(dropSettledForeignQueueItems(own, own, viewOnly), own, "unveraendert -> gleiche Liste (kein Neuladen)");
  assert.deepEqual(dropSettledForeignQueueItems(own, [], () => false), own, "ohne View only: nichts entfernen");
  // Live-Ansicht: nur das eigene Spiel im Cache ersetzen; inzwischen geloeschtes Spiel "weg" bleibt weg.
  const cached = [{ id: "a", v: 1 }]; const memory = [{ id: "tv", v: 2 }, { id: "weg", v: 1 }, { id: "a", v: 0 }];
  assert.deepEqual(mergeLiveGameIntoCache(cached, memory, "tv"), [{ id: "tv", v: 2 }, { id: "a", v: 1 }]);
  assert.deepEqual(mergeLiveGameIntoCache([{ id: "tv", v: 1 }, ...cached], [], "tv"), cached, "Live-Spiel geloescht -> entfernt");
  const store = read("src/store/GameStore.tsx");
  assert.match(store, /window\.addEventListener\("storage", onStorage\)/, "Queue anderer Tabs wird verfolgt");
  assert.match(store, /if \(event\.key !== SYNC_QUEUE_KEY\) return;\s*const next = dropSettledForeignQueueItems\(queueRef\.current, loadSyncQueue\(\), isGameViewOnly\);/);
  assert.match(store, /if \(queueFromStorageRef\.current === syncQueue\) return;\s*saveSyncQueue\(syncQueue\);/, "uebernommene Queue nicht zurueckschreiben");
  assert.match(store, /saveCachedGames\(liveGameId \? mergeLiveGameIntoCache\(loadCachedGames\(\), nextGames, liveGameId\) : nextGames\);/);
  const live = store.slice(store.indexOf("const loadLiveGame = useCallback"), store.indexOf("const resumeLiveView"));
  assert.ok(!/saveCachedGames\(/.test(live), "Live-Laden schreibt nicht mehr die ganze Liste in den Cache");
  assert.match(store, /gamesRef\.current = games;\s*saveGamesCacheRef\.current\(games\);/);
};

module.exports = { runBerlinZeitTests, runQueueCacheTests };
