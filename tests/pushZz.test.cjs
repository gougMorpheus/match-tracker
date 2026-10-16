const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runPushDispatch, isZzOnlyGame } = require("../.test-dist/utils/pushDispatch.js");

// Push-Ausschluss nur fuer reine ZZ-Testspiele; "Nicht zaehlen" allein schliesst nicht aus.
const runPushZzTests = async () => {
  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/push-real-games.json"), "utf8"));
  const list = Array.isArray(fixtures) ? fixtures : fixtures.games ?? Object.values(fixtures);
  const base = list.find((f) => f.events.some((e) => e.event_type === "game-end")) ?? list[0];
  const gameEnd = [...base.events].filter((e) => e.event_type === "game-end").pop();
  const run = async (overrides) => {
    const row = { ...base.row, ...overrides };
    const calls = { claim: 0, targets: 0, send: 0 };
    const deps = {
      loadGame: async () => ({ row, events: base.events }),
      claim: async (_g, _e, items) => { calls.claim++; return items.map((m) => m.key); },
      targets: async () => { calls.targets++; return [{ device_id: "d1", endpoint: "https://push.example/1", p256dh: "x", auth: "y" }]; },
      send: async () => { calls.send++; return { statusCode: 201 }; },
      report: async () => {},
      now: () => Date.parse(gameEnd.occurred_at) + 1000
    };
    return { result: await runPushDispatch(row.id, gameEnd.id, deps), calls };
  };
  // 1) Nur ZZ-Spieler: kein Claim (= keine Zeile in push_sent_highlights), kein Versand.
  const zz = await run({ player1_name: "ZZ-Push-A", player2_name: "ZZ-Push-B", stats_eligibility_mode: "exclude" });
  assert.equal(zz.result.status, "test-game");
  assert.deepEqual(zz.calls, { claim: 0, targets: 0, send: 0 });
  // 2) Gemischt (ein echter Spieler): wird gepusht.
  const mixed = await run({ player1_name: "ZZ-Push-A", player2_name: "Tim" });
  assert.equal(mixed.result.status, "sent");
  assert.ok(mixed.calls.claim === 1 && mixed.calls.send > 0);
  // 3) Echte Spieler mit "Nicht zaehlen": wird gepusht.
  const excluded = await run({ player1_name: "Guido", player2_name: "Janis", stats_eligibility_mode: "exclude" });
  assert.equal(excluded.result.status, "sent");
  assert.ok(excluded.calls.claim === 1 && excluded.calls.send > 0);
  assert.equal(isZzOnlyGame({ player1_name: " ZZ-A", player2_name: "ZZ-B" }), true);
  assert.equal(isZzOnlyGame({ player1_name: "Tim", player2_name: "Guido" }), false);
  assert.equal(isZzOnlyGame({ player1_name: "Jazz", player2_name: "ZZ-B" }), false, "nur Praefix ZZ zaehlt");
};
module.exports = { runPushZzTests };
