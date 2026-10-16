const assert = require("node:assert/strict");
const v = require("../.test-dist/utils/syncVersioning.js");
const f = require("../.test-dist/utils/pushFollow.js");
const runRetestTests = () => {
  // Falschalarm-Konflikt: veraltete Serverantwort (vor eigenem Schreiben gelesen) ersetzt den lokalen Stand nicht.
  const local = { id: "g", syncVersion: 3, syncFlowVersion: 7, tag: "lokal" };
  assert.equal(v.isStaleRemoteGame(local, { syncVersion: 3, syncFlowVersion: 6 }), true);
  assert.equal(v.isStaleRemoteGame(local, { syncVersion: 2, syncFlowVersion: 7 }), true);
  assert.equal(v.isStaleRemoteGame(local, { syncVersion: 3, syncFlowVersion: 7 }), false);
  // Fremdes Geraet hat geschrieben: hoehere Version -> Serverstand gilt (Konfliktschutz bleibt).
  assert.equal(v.isStaleRemoteGame(local, { syncVersion: 3, syncFlowVersion: 8 }), false);
  assert.equal(v.isStaleRemoteGame(undefined, { syncVersion: 1 }), false);
  assert.equal(v.isStaleRemoteGame({ id: "x" }, { syncVersion: 1 }), false, "Altdaten ohne Version");
  const merged = v.keepNewerLocalGames(
    [{ id: "g", syncVersion: 3, syncFlowVersion: 6, tag: "server-alt" }, { id: "h", syncVersion: 1, syncFlowVersion: 1, tag: "server" }],
    [local, { id: "h", syncVersion: 1, syncFlowVersion: 1, tag: "lokal-h" }]);
  assert.deepEqual(merged.map((g) => g.tag), ["lokal", "server"]);
  assert.equal(v.keepNewerLocalGames([{ id: "g", syncVersion: 4, syncFlowVersion: 9, tag: "fremd" }], [local])[0].tag, "fremd");

  // Retry nach Netzfehler: erster Versuch war gespeichert -> noop, Server = Basis + 1 -> eigenes Schreiben.
  assert.equal(v.resolveOwnRetryResult({ matched: false, noop: true, flow_version: 8 }, 7, "turn-pause").matched, true);
  // Fremde Aenderung dazwischen (Basis + 2): bleibt unmatched (Konflikt bei der naechsten Ablauf-Aktion).
  assert.equal(v.resolveOwnRetryResult({ matched: false, noop: true, flow_version: 9 }, 7, "turn-pause").matched, false);
  assert.equal(v.resolveOwnRetryResult({ matched: false, noop: true, flow_version: 8 }, 7, "cp-gained").matched, false);
  assert.equal(v.resolveOwnRetryResult({ matched: false, flow_version: 8 }, 7, "turn-pause").matched, false, "kein noop");

  // Geloeschte Spiele verschwinden aus den gefolgten Spielen.
  let s = f.createPushFollowSettings("dev", "2026-10-16T05:00:00.000Z");
  s = f.setGameFollowed(s, "a", true, "2026-10-16T05:00:01.000Z");
  s = f.setGameFollowed(s, "bb633bbd", true, "2026-10-16T05:00:02.000Z");
  const pruned = f.pruneDeletedFollows(s, ["a", "c"], "2026-10-16T05:00:03.000Z");
  assert.deepEqual(Object.keys(pruned.follows), ["a"]);
  assert.equal(f.pruneDeletedFollows(pruned, ["a"]), pruned, "keine Aenderung -> gleiches Objekt");
};
module.exports = { runRetestTests };
