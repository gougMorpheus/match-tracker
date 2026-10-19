const assert = require("node:assert/strict");
const { loadBrowserModule } = require("./helpers/loadBrowserModule.cjs");
const { createGameInput } = require("./helpers/gameFixtures.cjs");
const { RemoteGameCache, FULL_PULL_INTERVAL_MS, FULL_EVENTS_WINDOW_MS, RESUME_FULL_AFTER_HIDDEN_MS, shouldFullPullOnResume, LIVE_VIEW_IDLE_MS, getRealtimeGameId, getPollIntervalMs, getLiveViewPause, shouldLiveViewFollowRealtime, liveViewBlocksLoad } =
  require("../.test-dist/utils/deltaPull.js");

// #679 Delta-Abgleich: Events nur fuer geaenderte/neue/markierte/aktive Spiele; Vollabzug als Sicherheitsnetz.
const DAY = 24 * 3600 * 1000;
const NOW = Date.parse("2026-10-18T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const row = (id, version, flow, at, extra = {}) => ({ id, version, flow_version: flow, created_at: iso(at), started_at: iso(at), ended_at: null, deleted_at: null, ...extra });
const ev = (id, gameId, at, extra = {}) => ({ id, game_id: gameId, created_at: iso(at), occurred_at: iso(at), event_type: "cp-gained", revoked_by: null, ...extra });
const slimOf = (rows) => rows.map(({ id, version, flow_version }) => ({ id, version, flow_version }));

const runDeltaAbgleichTests = async () => {
  const oldAt = NOW - 30 * DAY; const activeAt = NOW - 3600 * 1000;
  let rows = [row("alt", 3, 5, oldAt, { ended_at: iso(oldAt) }), row("aktiv", 2, 9, activeAt)];
  let events = [ev("a1", "alt", oldAt), ev("a2", "alt", oldAt), ev("b1", "aktiv", activeAt)];
  const cache = new RemoteGameCache();
  const pull = (now, srvRows = rows, srvEvents = events) => {
    const slim = slimOf(srvRows); const plan = cache.plan(slim, now);
    cache.apply(slim, plan, srvRows.filter((r) => plan.rowIds.includes(r.id)), srvEvents.filter((e) => plan.eventIds.includes(e.game_id)), now);
    return { plan, list: cache.list(slim) };
  };
  const eventsOf = (list, id) => list.find((e) => e.row.id === id)?.events.map((e) => e.id);

  let r = pull(NOW);
  assert.equal(r.plan.full, true, "erster Abgleich = Vollabzug");
  assert.deepEqual(eventsOf(r.list, "alt"), ["a1", "a2"]);

  r = pull(NOW + 1000);
  assert.equal(r.plan.full, false);
  assert.deepEqual(r.plan.rowIds, [], "unveraendert: keine Zeilen");
  assert.deepEqual(r.plan.eventIds, ["aktiv"], "nur aktives Spiel (Revoke-Schutz), altes nicht");

  // Event-Aenderung ohne Versionserhoehung (CP/Punkte) im alten Spiel: Realtime/eigenes Schreiben markiert -> nachladen.
  events = [ev("a1", "alt", oldAt, { value_number: 2 }), ev("a2", "alt", oldAt), ev("b1", "aktiv", activeAt)];
  cache.markDirty("alt");
  r = pull(NOW + 2000);
  assert.deepEqual(r.plan.rowIds, [], "Zeile unveraendert");
  assert.ok(r.plan.eventIds.includes("alt"), "markiertes Spiel nachgeladen");
  assert.equal(r.list.find((e) => e.row.id === "alt").events[0].value_number, 2);
  assert.equal(cache.isDirty("alt"), false, "Markierung erledigt");

  // Revoke eines Nicht-Ablauf-Events auf anderem Geraet (fuer anon unsichtbar, keine Version): aktives Spiel -> sofort.
  events = events.filter((e) => e.id !== "b1").concat(ev("b2", "aktiv", activeAt));
  r = pull(NOW + 3000);
  assert.deepEqual(eventsOf(r.list, "aktiv"), ["b2"], "Revoke im aktiven Spiel erkannt");
  // ... im alten Spiel ohne Realtime: spaetestens beim Vollabzug.
  events = events.filter((e) => e.id !== "a2");
  r = pull(NOW + 4000);
  assert.deepEqual(eventsOf(r.list, "alt"), ["a1", "a2"], "altes Spiel noch aus Cache");
  r = pull(NOW + FULL_PULL_INTERVAL_MS + 1);
  assert.equal(r.plan.full, true, "Sicherheitsnetz: Vollabzug nach Intervall");
  // Egress (19.10.): Vollabzug laedt Events nur fuer Spiele mit Aktivitaet < 7 Tage -> altes Spiel (30 Tage) aus dem Cache.
  assert.ok(!r.plan.eventIds.includes("alt") && r.plan.eventIds.includes("aktiv"), "Vollabzug: keine Events fuer alte Spiele");
  assert.deepEqual(r.plan.rowIds.sort(), ["aktiv", "alt"], "Vollabzug: alle Spielzeilen");
  assert.deepEqual(eventsOf(r.list, "alt"), ["a1", "a2"], "Revoke im alten Spiel (> 7 Tage) erst nach Neustart (bewusste Grenze)");
  {
    const fresh = new RemoteGameCache(); const slim = slimOf(rows); const plan = fresh.plan(slim, NOW + FULL_PULL_INTERVAL_MS + 1);
    assert.ok(plan.full && plan.eventIds.includes("alt"), "Neustart: alle Events (Cache leer)");
    fresh.apply(slim, plan, rows, events.filter((e) => plan.eventIds.includes(e.game_id)), NOW + FULL_PULL_INTERVAL_MS + 1);
    assert.deepEqual(eventsOf(fresh.list(slim), "alt"), ["a1"], "Revoke im alten Spiel nach Neustart sichtbar");
  }

  // Ablauf-Event / Spielzeile geaendert (flow_version / version) -> Zeile + Events.
  rows = [row("alt", 3, 6, oldAt, { ended_at: iso(oldAt) }), row("aktiv", 3, 9, activeAt)];
  r = pull(NOW + FULL_PULL_INTERVAL_MS + 2000);
  assert.deepEqual(r.plan.rowIds.sort(), ["aktiv", "alt"], "version/flow_version geaendert -> neu laden");

  // Neues Spiel (anderes Geraet) erscheint; Loeschen auf anderem Geraet: fehlt in der schlanken Liste -> weg.
  rows = [row("neu", 1, 1, NOW), rows[1]];
  events = events.filter((e) => e.game_id !== "alt").concat(ev("n1", "neu", NOW));
  r = pull(NOW + FULL_PULL_INTERVAL_MS + 3000);
  assert.deepEqual(r.plan.rowIds, ["neu"], "nur das neue Spiel voll");
  assert.deepEqual(r.list.map((e) => e.row.id), ["neu", "aktiv"], "geloeschtes Spiel fehlt, Reihenfolge der Liste");
  assert.equal(cache.entries.has("alt"), false);
  // Zeile inzwischen geloescht (deleted_at) -> nicht uebernommen.
  rows = [row("neu", 2, 1, NOW, { deleted_at: iso(NOW) }), rows[1]];
  r = pull(NOW + FULL_PULL_INTERVAL_MS + 4000);
  assert.deepEqual(r.list.map((e) => e.row.id), ["aktiv"]);

  // Alte Loeschung nur in notes (deleted_at leer): nicht anzeigen, aber auch nicht bei jedem Abgleich neu laden.
  const legacyDeleted = row("legacy", 1, 1, oldAt, { notes: JSON.stringify({ deletedMeta: { deletedAt: iso(oldAt) } }) });
  rows = [legacyDeleted, rows[1]];
  r = pull(NOW + FULL_PULL_INTERVAL_MS + 4500);
  assert.deepEqual(r.list.map((e) => e.row.id), ["aktiv"], "Loeschung in notes -> nicht in der Liste");
  r = pull(NOW + FULL_PULL_INTERVAL_MS + 4600);
  assert.ok(!r.plan.rowIds.includes("legacy") && !r.plan.eventIds.includes("legacy"), "geloeschter Platzhalter wird nicht neu geladen");
  r = pull(NOW + 2 * FULL_PULL_INTERVAL_MS + 5000);
  assert.equal(r.plan.full, true); assert.ok(!r.plan.eventIds.includes("legacy"), "Vollabzug: keine Events fuer geloeschte");
  rows = [rows[1]];

  // Markierung WAEHREND des Ladens bleibt bestehen (Antwort kann aelter sein).
  const slim = slimOf(rows); const plan = cache.plan(slim, NOW + FULL_PULL_INTERVAL_MS + 5000);
  cache.markDirty("aktiv");
  cache.apply(slim, plan, [], events.filter((e) => plan.eventIds.includes(e.game_id)), NOW + FULL_PULL_INTERVAL_MS + 5000);
  assert.equal(cache.isDirty("aktiv"), true, "spaete Markierung bleibt");
  cache.requestFull();
  assert.equal(cache.plan(slim, NOW + FULL_PULL_INTERVAL_MS + 6000).full, true, "requestFull -> Vollabzug");

  // Egress (19.10.): Intervall 30 min, Rueckkehr nur nach > 5 min Hintergrund als Vollabzug, 7-Tage-Fenster im Vollabzug
  assert.equal(FULL_PULL_INTERVAL_MS, 30 * 60 * 1000); assert.equal(RESUME_FULL_AFTER_HIDDEN_MS, 5 * 60 * 1000);
  assert.equal(FULL_EVENTS_WINDOW_MS, 7 * DAY);
  assert.equal(shouldFullPullOnResume(NOW - 5 * 60 * 1000, NOW), false, "genau 5 min -> kein Vollabzug");
  assert.equal(shouldFullPullOnResume(NOW - 5 * 60 * 1000 - 1, NOW), true, "mehr als 5 min -> Vollabzug");
  assert.equal(shouldFullPullOnResume(NOW - 60 * 1000, NOW), false);
  assert.equal(shouldFullPullOnResume(null, NOW), true, "unbekannt -> Vollabzug");
  {
    const c = new RemoteGameCache(); const t0 = NOW;
    const rw = [row("woche", 1, 1, t0 - 3 * DAY, { ended_at: iso(t0 - 3 * DAY) }), row("monat", 1, 1, t0 - 20 * DAY, { ended_at: iso(t0 - 20 * DAY) }),
      row("grenze", 1, 1, t0 - 7 * DAY + 3600000, { ended_at: iso(t0 - 7 * DAY + 3600000) })];
    let evs = [ev("w1", "woche", t0 - 3 * DAY), ev("w2", "woche", t0 - 3 * DAY), ev("m1", "monat", t0 - 20 * DAY), ev("m2", "monat", t0 - 20 * DAY), ev("g1", "grenze", t0 - 7 * DAY + 3600000)];
    const go = (now) => { const sl = slimOf(rw); const pl = c.plan(sl, now); c.apply(sl, pl, rw.filter((x) => pl.rowIds.includes(x.id)), evs.filter((e) => pl.eventIds.includes(e.game_id)), now); return pl; };
    let pl = go(t0); assert.deepEqual(pl.eventIds.sort(), ["grenze", "monat", "woche"], "Start: alles");
    pl = go(t0 + 1000); assert.equal(pl.full, false); assert.deepEqual(pl.eventIds, [], "Delta: keine Events alter Spiele (> 12 h)");
    evs = evs.filter((e) => e.id !== "w2" && e.id !== "m2");
    pl = go(t0 + FULL_PULL_INTERVAL_MS); assert.equal(pl.full, true);
    assert.deepEqual(pl.eventIds.sort(), ["grenze", "woche"], "Vollabzug: nur Spiele mit Aktivitaet < 7 Tage");
    const list = c.list(slimOf(rw));
    assert.deepEqual(eventsOf(list, "woche"), ["w1"], "Revoke im Spiel der letzten 7 Tage beim Vollabzug erkannt");
    assert.deepEqual(eventsOf(list, "monat"), ["m1", "m2"], "aelteres Spiel behaelt Events aus dem Cache");
    // Versionsaenderung oder Markierung laedt auch alte Spiele
    rw[1] = row("monat", 2, 1, t0 - 20 * DAY, { ended_at: iso(t0 - 20 * DAY) });
    pl = go(t0 + 2 * FULL_PULL_INTERVAL_MS); assert.ok(pl.eventIds.includes("monat"), "Vollabzug: geaenderte Version -> Events");
    assert.deepEqual(eventsOf(c.list(slimOf(rw)), "monat"), ["m1"]);
    c.markDirty("monat"); c.requestFull(); pl = go(t0 + 2 * FULL_PULL_INTERVAL_MS + 1000);
    assert.ok(pl.full && pl.eventIds.includes("monat"), "Vollabzug: markiertes altes Spiel -> Events");
  }

  // Realtime-Payload
  assert.equal(getRealtimeGameId({ table: "events", record: { id: "e", game_id: "g1" } }), "g1");
  assert.equal(getRealtimeGameId({ table: "games", record: { id: "g2" } }), "g2");
  assert.equal(getRealtimeGameId({ table: "events", record: null, old_record: { id: "e" } }), null, "ohne game_id -> Vollabzug");
  assert.equal(getRealtimeGameId(undefined), null);
  assert.equal(getPollIntervalMs(true, false), 60000); assert.equal(getPollIntervalMs(false, false), 15000);
  assert.equal(getPollIntervalMs(true, true), 30000); assert.equal(getPollIntervalMs(false, true), 10000);
  const live = { row: row("l", 1, 1, NOW), events: [ev("l1", "l", NOW)] };
  assert.equal(getLiveViewPause(live, NOW, NOW + LIVE_VIEW_IDLE_MS - 1), null);
  assert.equal(getLiveViewPause(live, NOW, NOW + LIVE_VIEW_IDLE_MS), "idle", "15 min ohne neues Event");
  assert.equal(getLiveViewPause(live, NOW + 60000, NOW + LIVE_VIEW_IDLE_MS), null, "Weiter live setzt Zeitpunkt neu");
  assert.equal(getLiveViewPause({ ...live, row: { ...live.row, ended_at: iso(NOW) } }, NOW, NOW), "ended");

  // TV: Spiel beendet -> Pause "ended"; Realtime des eigenen Spiels kommt durch, fremdes Spiel nicht.
  const endedEntry = { ...live, row: { ...live.row, ended_at: iso(NOW) } };
  const endedPause = getLiveViewPause(endedEntry, NOW, NOW + 1000);
  assert.equal(endedPause, "ended");
  assert.equal(shouldLiveViewFollowRealtime("l", getRealtimeGameId({ table: "games", record: { id: "l" } }), endedPause), true, "eigenes Spiel nach Ende -> laden");
  assert.equal(shouldLiveViewFollowRealtime("l", getRealtimeGameId({ table: "events", record: { id: "x", game_id: "fremd" } }), endedPause), false, "fremdes Spiel ignoriert");
  assert.equal(shouldLiveViewFollowRealtime("l", null, endedPause), false, "ohne game_id kein Vollabzug in der Live-Ansicht");
  assert.equal(liveViewBlocksLoad(endedPause), false, "bei Spielende darf das Laden nicht gesperrt sein");
  assert.equal(liveViewBlocksLoad("idle"), true); assert.equal(liveViewBlocksLoad(null), false);
  // Undo des Spielendes: neu geladener Stand ohne ended_at -> Pause aufgehoben.
  const reopened = { row: { ...live.row, ended_at: null, version: 2 }, events: [...live.events, ev("l2", "l", NOW + 2000)] };
  assert.equal(getLiveViewPause(reopened, NOW, NOW + 3000), null, "Pause nach Undo aufgehoben");
  // "idle" unveraendert: auch eigenes Spiel angehalten (nur "Weiter live"); ohne Pause wie bisher.
  assert.equal(shouldLiveViewFollowRealtime("l", "l", "idle"), false);
  assert.equal(shouldLiveViewFollowRealtime("l", "l", null), true);
  assert.equal(shouldLiveViewFollowRealtime("l", "fremd", null), false);

  // Repository gegen Fetch-Mock: Abfragen schlank, 2. Abgleich ohne Events fuer unveraenderte alte Spiele.
  const saved = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  try {
    const urls = [];
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    const srvRows = [row("alt", 3, 5, oldAt, { ended_at: iso(oldAt) })];
    globalThis.fetch = async (url) => {
      const u = decodeURIComponent(String(url)); urls.push(u);
      if (u.includes("/games?select=id,version,flow_version")) return json(slimOf(srvRows));
      if (u.includes("/games?select=*")) return json(srvRows);
      if (u.includes("/events?")) return json([ev("a1", "alt", oldAt)]);
      return json([]);
    };
    const repo = loadBrowserModule("src/services/gamesRepository.ts");
    const delta = loadBrowserModule("src/utils/deltaPull.ts");
    const c = new delta.RemoteGameCache();
    const first = await repo.gamesRepository.listGamesDelta(c, NOW);
    assert.equal(first.length, 1);
    assert.ok(urls[0].includes("deleted_at=is.null") && urls[0].includes("order=created_at.desc"), "geloeschte serverseitig gefiltert");
    assert.ok(urls.some((u) => u.includes("/events?") && u.includes("limit=1000")), "Seitengroesse 1000");
    urls.length = 0;
    const second = await repo.gamesRepository.listGamesDelta(c, NOW + 1000);
    assert.equal(second.length, 1);
    assert.deepEqual(urls.map((u) => u.split("?")[0].replace(/.*rest\/v1\//, "")), ["games"], "nur schlanke Liste");
    assert.equal(repo.EVENT_PAGE_SIZE, 1000);
  } finally {
    if (saved) Object.defineProperty(globalThis, "fetch", saved); else delete globalThis.fetch;
  }

  // Store: lokal angelegtes Spiel waehrend eines (langsamen) Delta-Abgleichs bleibt erhalten (#25).
  const keep = Object.fromEntries(["window", "navigator", "document", "fetch"].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  try {
    const data = new Map();
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
    globalThis.window = { location: { hash: "#/new", search: "" }, localStorage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) },
      setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true };
    globalThis.document = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    let slowSlim = null; let saveCalls = 0; let savedRow = null;
    globalThis.fetch = async (url, init = {}) => {
      const u = decodeURIComponent(String(url));
      if (u.includes("/rpc/mt_save_game")) {
        saveCalls += 1; const g = JSON.parse(init.body).p_game;
        savedRow = { ...g, version: 1, flow_version: 0, deleted_at: null };
        return json({ matched: true, version: 1, flow_version: 0, created: true });
      }
      if (u.includes("/rpc/")) return json({ matched: true, flow_version: 1 });
      if (u.includes("select=id,version,flow_version")) {
        // Erster Abgleich liest VOR dem Speichern (ohne das neue Spiel) und antwortet erst danach.
        if (slowSlim) { const wait = slowSlim; slowSlim = null; await wait; return json([]); }
        return json(savedRow ? [{ id: savedRow.id, version: 1, flow_version: 0 }] : []);
      }
      if (u.includes("/games?select=*")) return json(savedRow ? [savedRow] : []);
      return json([]);
    };
    let context;
    const react = { createContext: () => ({ Provider: "provider" }), useContext: () => context,
      useState: (i) => [typeof i === "function" ? i() : i, () => {}], useRef: (current) => ({ current }), useCallback: (fn) => fn, useMemo: (fn) => fn(), useEffect: () => {} };
    const jsx = (_, props) => { context = props.value; return null; };
    const module = loadBrowserModule("src/store/GameStore.tsx", { react, "react/jsx-runtime": { jsx, jsxs: jsx } });
    module.GameStoreProvider({ children: null });
    const store = context;
    let release; slowSlim = new Promise((r) => { release = r; });
    const pending = store.refreshGames();
    await new Promise((r) => setTimeout(r, 20));
    const game = await store.createGame(createGameInput());
    release();
    await pending;
    for (let i = 0; i < 50 && JSON.parse(data.get("match-tracker.sync-queue.v2") || "[]").length; i++) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(saveCalls >= 1);
    assert.ok(store.getGame(game.id), "lokal angelegtes Spiel bleibt trotz aelterer Delta-Antwort");
  } finally {
    for (const [k, d] of Object.entries(keep)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  }
};
module.exports = { runDeltaAbgleichTests };
