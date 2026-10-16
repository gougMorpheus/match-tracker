const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { mapSupabaseGameToAppGame } = require("../.test-dist/utils/supabaseGameMapping.js");
const { deriveGameHighlights } = require("../.test-dist/utils/tvHighlights.js");
const ph = require("../.test-dist/utils/pushHighlights.js");
const { runPushDispatch, toPushPayload } = require("../.test-dist/utils/pushDispatch.js");
const pf = require("../.test-dist/utils/pushFollow.js");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const FIXTURES = JSON.parse(read("tests/fixtures/push-real-games.json"));
const byOccurred = (events) => [...events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
const view = (h) => ({ id: h.id, kind: h.kind, title: h.title, subtitle: h.subtitle, createdAt: h.createdAt });

// 1) Anzeige == Push (echte Verlaeufe): gleiche Highlights, gleiche Texte, gleiche Reihenfolge.
const runDisplayEqualsPush = () => {
  let total = 0;
  for (const { row, events } of FIXTURES) {
    const appGame = mapSupabaseGameToAppGame(row, events); // so laedt die App (gamesRepository)
    const shown = deriveGameHighlights(appGame).map(view); // Ereignisliste/Verlauf/TV
    const fnGame = ph.buildGameFromRows(row, events); // so laedt die Netlify Function
    const pushed = ph.derivePushHighlights(fnGame).filter((h) => h.kind !== "game-start").map(view);
    assert.deepEqual(pushed, shown, `Anzeige != Push fuer ${row.id.slice(0, 8)}`);
    assert.ok(ph.derivePushHighlights(fnGame).some((h) => h.kind === "game-start"), "Spielstart");
    total += shown.length;

    // Live-Ablauf nachspielen: nach jedem Event (Reihenfolge wie im Spiel) die Function-Auswahl fuer dieses Event.
    const sent = new Map();
    const ordered = byOccurred(events);
    for (let i = 0; i < ordered.length; i++) {
      const prefix = ordered.slice(0, i + 1);
      const g = ph.buildGameFromRows(row.ended_at && !prefix.some((e) => e.event_type === "game-end") ? { ...row, ended_at: null } : row, prefix);
      const now = Date.parse(ordered[i].occurred_at) + 1000;
      for (const m of ph.selectPushMessagesForEvent(g, ordered[i].id, now, Infinity)) if (!sent.has(m.key)) sent.set(m.key, m);
    }
    const expected = ph.derivePushMessages(fnGame);
    const keyed = (list) => list.map((m) => `${m.key} | ${m.title} | ${m.body}`).sort();
    assert.deepEqual(keyed([...sent.values()]), keyed(expected), `Live-Nachspielen != Anzeige fuer ${row.id.slice(0, 8)}`);
  }
  assert.ok(total > 50, `genug Highlights in den Fixtures (${total})`);
  return total;
};

// 2) Dedupe: mehrfach + parallel mit demselben Event -> genau ein Push je Highlight und Geraet.
const fakeDb = () => {
  const claimed = new Set();
  return {
    claimed,
    claim: async (gameId, _ev, items) => {
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      const won = [];
      for (const m of items) { const k = `${gameId}|${m.key}`; if (!claimed.has(k)) { claimed.add(k); won.push(m.key); } }
      return won;
    }
  };
};

const runDedupe = async () => {
  const { row, events } = FIXTURES.find((f) => f.events.length > 100 && !f.events.some((e) => e.legacy)) ?? FIXTURES[0];
  const ordered = byOccurred(events);
  const gameEnd = ordered.find((e) => e.event_type === "game-end");
  const db = fakeDb();
  const sends = [];
  const deps = {
    loadGame: async () => ({ row, events }),
    claim: db.claim,
    targets: async () => [{ device_id: "d1", endpoint: "https://push.example/1", p256dh: "x", auth: "y" },
      { device_id: "d2", endpoint: "https://push.example/2", p256dh: "x", auth: "y" }],
    send: async (t, payload) => { sends.push([t.device_id, JSON.parse(payload).tag]); if (t.device_id === "d2") { const e = new Error("gone"); e.statusCode = 410; throw e; } return { statusCode: 201 }; },
    report: async (_g, _k, s) => { reports.push(s); },
    now: () => Date.parse(gameEnd.occurred_at) + 1000
  };
  const reports = [];
  const results = await Promise.all(Array.from({ length: 8 }, () => runPushDispatch(row.id, gameEnd.id, deps)));
  const again = await runPushDispatch(row.id, gameEnd.id, deps);
  assert.equal(results.filter((r) => r.status === "sent").length, 1, "genau ein Aufruf sendet");
  assert.equal(again.status, "duplicate");
  const d1 = sends.filter(([d]) => d === "d1").map(([, tag]) => tag);
  assert.equal(new Set(d1).size, d1.length, "kein Doppel-Push");
  assert.ok(d1.some((t) => t.endsWith("highlight:game-end:r5t2:true") || /game-end/.test(t)), "Spielende gepusht");
  // 404/410: Abo wird gemeldet (Function entfernt es per mt_push_report).
  assert.deepEqual(reports[0].gone, ["d2"]);
  return d1.length;
};

// 3) Undo: Highlights eines zurueckgenommenen Events werden nicht gesendet; ein folgendes Event pusht keine frueheren Highlights erneut.
const runUndo = () => {
  const { row, events } = FIXTURES.find((f) => ph.derivePushMessages(ph.buildGameFromRows(f.row, f.events)).some((m) => m.kind === "lead-change"));
  const ordered = byOccurred(events);
  const fnGame = ph.buildGameFromRows(row, events);
  const lead = ph.derivePushMessages(fnGame).find((m) => m.kind === "lead-change");
  assert.ok(lead, "Fixture hat Fuehrungswechsel");
  const idx = ordered.findIndex((e) => Date.parse(e.occurred_at) === Date.parse(lead.createdAt));
  const prefix = ordered.slice(0, idx + 1);
  const trigger = prefix[prefix.length - 1];
  const now = Date.parse(trigger.occurred_at) + 1000;
  const live = ph.buildGameFromRows({ ...row, ended_at: null }, prefix);
  assert.ok(ph.selectPushMessagesForEvent(live, trigger.id, now).some((m) => m.kind === "lead-change"));
  // Revoke: das Event ist fuer anon nicht mehr sichtbar -> nichts.
  const revoked = prefix.map((e) => (e.id === trigger.id ? { ...e, revoked_by: "00000000-0000-0000-0000-000000000001" } : e));
  assert.deepEqual(ph.selectPushMessagesForEvent(ph.buildGameFromRows({ ...row, ended_at: null }, revoked), trigger.id, now), []);
  // Naechstes Event nach dem Undo: nur Highlights ab dessen Zeitpunkt.
  const next = { ...ordered[idx + 1], occurred_at: new Date(now + 5000).toISOString() };
  const after = ph.selectPushMessagesForEvent(ph.buildGameFromRows({ ...row, ended_at: null }, [...revoked, next]), next.id, now + 6000);
  assert.ok(after.every((m) => Date.parse(m.createdAt) >= now + 5000), "keine frueheren Highlights");
  // Altes Spiel/alte Events (Import, lange offline): nicht nachmelden.
  assert.deepEqual(ph.selectPushMessagesForEvent(fnGame, ordered[ordered.length - 1].id, Date.now()), []);
};

const runPushBTests = async () => {
  const total = runDisplayEqualsPush();
  const sent = await runDedupe();
  runUndo();
  // Texte: kurz, deutsch, mit Spielern + Stand; Klick -> View only.
  const { row, events } = FIXTURES.find((f) => f.row.id.startsWith("9cd7a483"));
  const msgs = ph.derivePushMessages(ph.buildGameFromRows(row, events));
  for (const m of msgs) {
    assert.match(m.url, /^\/#\/game\/[0-9a-f-]+\?tv=1$/);
    if (m.kind !== "game-start") assert.match(m.body, /^Janis vs\. Tim · .*VP/);
    assert.ok(m.body.length < 160, m.body);
    assert.doesNotMatch(m.title + m.body, /Fuehrung|uebernimmt|verfuegbar|zurueck/, "echte Umlaute");
  }
  assert.match(JSON.parse(toPushPayload(msgs[0])).tag, /^9cd7a483/);
  const kinds = new Set(msgs.map((m) => m.kind.replace(/-\d+-\d+$/, "")));
  for (const k of ["game-start", "round-summary", "game-end"]) assert.ok(kinds.has(k), `Art ${k}`);
  // Function nutzt den App-Code (keine zweite Implementierung).
  const fn = read("netlify/functions/push-dispatch.mts");
  assert.match(fn, /from "\.\.\/\.\.\/src\/utils\/pushDispatch"/);
  assert.doesNotMatch(fn, /Führungswechsel|Ausgleich|round-summary|lead-change/);
  assert.match(read("src/utils/pushDispatch.ts"), /from "\.\/pushHighlights"/);
  assert.match(read("src/utils/pushHighlights.ts"), /deriveGameHighlights/);
  // App-Abo: RPC-Argumente, Base64url.
  const s = pf.setAutoFollowNew(pf.setGameFollowed(pf.createPushFollowSettings("dev-1", "2026-10-16T06:00:00.000Z"), "g1", true), true, "2026-10-16T06:01:00.000Z");
  const args = pf.getPushFollowRpcArgs(s);
  assert.deepEqual(args, { p_device_id: "dev-1", p_auto_follow: true, p_auto_follow_since: "2026-10-16T06:01:00.000Z", p_followed: ["g1"], p_unfollowed: [] });
  assert.equal(pf.urlBase64ToUint8Array("AQID_w").join(","), "1,2,3,255");
  // Service Worker: Push anzeigen + Klick auf url (nur Pfade dieser App).
  const sw = read("src/pwa/sw.template.js");
  assert.match(sw, /showNotification/); assert.match(sw, /targetUrl\(data\)/); assert.match(sw, /openWindow\(target\)/);
  // Migration + Rollback im Repo, ohne Secret.
  const mig = read("supabase/migrations/20261016_02_web_push.sql");
  assert.match(mig, /enable row level security/); assert.match(mig, /exception when others/); assert.match(mig, /unique \(game_id, highlight_key\)/);
  assert.doesNotMatch(mig, /[0-9a-f]{64}/);
  assert.ok(fs.existsSync(path.join(__dirname, "..", "supabase/migrations/20261016_02_web_push.rollback.sql")));
  // Touch-Ziel Bearbeiten/Loeschen.
  assert.match(read("src/styles/index.css"), /@media \(pointer: coarse\) \{\s*\.event-editor__actions \{[^}]*\}\s*\.event-editor__actions \.compact-button \{\s*min-height: 44px;\s*min-width: 44px;/);
  return { total, sent };
};

module.exports = { runPushBTests };
