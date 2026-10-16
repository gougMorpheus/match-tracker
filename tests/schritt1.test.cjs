const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const d = require("../.test-dist/utils/tvDashboard.js");
const share = require("../.test-dist/utils/shareLink.js");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const runSchritt1Tests = async () => {
  // "Zug noch nicht gestartet" nur ohne gelaufene Zugzeit; echte Pause bleibt "Pausiert".
  const base = { completed: false, timeout: false, running: false, started: true, hasTurn: true };
  assert.equal(d.getTvStatusLabel({ ...base, turnMs: 0 }), "Zug noch nicht gestartet");
  assert.equal(d.getTvStatusLabel({ ...base, turnMs: 65000 }), "Pausiert");
  assert.equal(d.getTvStatusLabel({ ...base, running: true, turnMs: 0 }), "Läuft");
  assert.equal(d.getTvStatusLabel({ ...base, started: false, turnMs: 0 }), "Bereit");
  // Aufstellung pausiert (noch kein Zug): ebenfalls "Zug noch nicht gestartet".
  assert.equal(d.getTvStatusLabel({ ...base, hasTurn: false, turnMs: 0 }), "Zug noch nicht gestartet");
  assert.equal(d.getTvStatusLabel({ ...base, completed: true, turnMs: 0 }), "Beendet");

  // Link teilen: Direktlink View only; kopieren immer, Teilen-Dialog nur mobil.
  const url = share.buildSpectatorLink("https://40k-match-tracker.netlify.app", "/", "abc");
  assert.equal(url, "https://40k-match-tracker.netlify.app/#/game/abc?tv=1");
  const calls = [];
  const deps = (isMobile) => ({ isMobile, clipboardWrite: async (t) => calls.push(["copy", t]), share: async (x) => calls.push(["share", x.url]) });
  assert.equal(await share.shareSpectatorLink(url, "A vs. B", deps(false)), "copied");
  assert.equal(await share.shareSpectatorLink(url, "A vs. B", deps(true)), "shared");
  // Handy: nur Teilen-Dialog, kein zusaetzliches Kopieren.
  assert.deepEqual(calls, [["copy", url], ["share", url]]);
  // Handy ohne navigator.share: kopieren.
  assert.equal(await share.shareSpectatorLink(url, "x", { isMobile: true, clipboardWrite: async () => {} }), "copied");
  // Abbruch im Teilen-Dialog: keine Meldung, kein Kopieren.
  const abort = Object.assign(new Error("abgebrochen"), { name: "AbortError" });
  let copiedAfterAbort = false;
  assert.equal(await share.shareSpectatorLink(url, "x", { isMobile: true, share: async () => { throw abort; }, clipboardWrite: async () => { copiedAfterAbort = true; } }), "cancelled");
  assert.equal(copiedAfterAbort, false);
  assert.equal(share.shareResultMessage("cancelled", url), null);
  // Technischer Fehler beim Teilen: Fallback kopieren.
  assert.equal(await share.shareSpectatorLink(url, "x", { isMobile: true, share: async () => { throw new Error("NotAllowed"); }, clipboardWrite: async () => {} }), "copied");
  assert.equal(await share.shareSpectatorLink(url, "x", { isMobile: true, share: async () => { throw new Error("x"); } }), "failed");
  assert.equal(share.shareResultMessage("copied", url), "Link kopiert");
  assert.match(share.shareResultMessage("failed", url), /abc\?tv=1/);

  // Full screen im Fluss der Mitte-Kachel, kein absolutes Overlay mehr.
  const tv = read("src/components/TvGameView.tsx"), css = read("src/styles/index.css");
  assert.ok(tv.indexOf('className="tv-game__controls"') > tv.indexOf('className="tv-panel tv-phase"') && tv.indexOf('className="tv-game__controls"') < tv.indexOf("{renderPlayer(1)}"));
  assert.match(css, /\.tv-game__controls \{ position: static;/);
  assert.doesNotMatch(tv, /latestNote|Notiz:/);

  // Notizen: kein Menuepunkt, keine Eingabe, keine Anzeige.
  const page = read("src/pages/GamePage.tsx");
  assert.doesNotMatch(page, /label: "Notizen"|Notiz hinzufügen|<option value="note">|"Keine Notiz"/);
  assert.doesNotMatch(page, /noteAction=/);

  // Umlaute in sichtbaren Texten (Stichproben).
  for (const bad of ['"Spiel loeschen"', '"Schliessen"', "Timer laeuft", '"Zurueck"', "Spielmenue\""]) {
    for (const f of ["src/pages/GamePage.tsx", "src/pages/StatsPage.tsx", "src/pages/GamesPage.tsx", "src/store/GameStore.tsx"]) assert.ok(!read(f).includes(bad), `${bad} in ${f}`);
  }
};
module.exports = { runSchritt1Tests };
