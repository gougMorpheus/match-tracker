// Punkte 1-7 (Edit / View only), 14.10.2026.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createBaseGame, createCompletedGameFixture } = require('./helpers/gameFixtures.cjs');
const m = require('../.test-dist/utils/gameAccessMode.js');

const runEditViewOnlyTests = () => {
  const running = createBaseGame({ id: '11111111-1111-4111-8111-111111111111' });
  const done = createCompletedGameFixture('22222222-2222-4222-8222-222222222222');
  const page = fs.readFileSync('src/pages/GamePage.tsx', 'utf8');
  const tv = fs.readFileSync('src/components/TvGameView.tsx', 'utf8');
  const css = fs.readFileSync('src/styles/index.css', 'utf8');
  const store = fs.readFileSync('src/store/GameStore.tsx', 'utf8');
  // Begriffe: nur "Edit" und "View only".
  assert.doesNotMatch(page + tv, /TV-Modus|Nur ansehen|TV mode/, 'alte Modusnamen entfernt');
  assert.match(page, />\s*Edit\s*</); assert.match(page, />\s*View only\s*</);
  // 1) View only = TV-Ansicht, kein "TV-Modus verlassen", Full screen bleibt; Scoreboard im Edit oeffnet View only.
  assert.match(tv, /"Full screen verlassen" : "Full screen"/);
  assert.doesNotMatch(tv, /verlassen<\/button>|onExit\(\)/);
  assert.match(page, /label: "Scoreboard",\s*onClick: openViewOnly/);
  // 2) Laufendes Spiel: Dialog Edit / View only; Edit = normale Ansicht.
  assert.equal(m.shouldAskGameAccessMode(running, null), true);
  assert.equal(m.shouldShowViewOnly(running, 'edit'), false);
  assert.equal(m.shouldShowViewOnly(running, 'view'), true);
  assert.equal(m.shouldShowViewOnly(running, null, true), true, 'View-only-Link');
  // 3) Abgeschlossen: immer View only, kein Dialog.
  assert.equal(m.shouldAskGameAccessMode(done, null), false);
  assert.equal(m.shouldShowViewOnly(done, null), true);
  assert.equal(m.shouldShowViewOnly(done, 'view'), true);
  assert.equal(m.shouldShowViewOnly(done, null, true), true);
  // 4) View only schreibgeschuetzt: Store blockiert (siehe gameStoreReadOnly), Verlauf ohne Bearbeiten/Loeschen/Undo.
  assert.equal(m.isGameWriteBlocked(m.setGameAccessModeInState({}, running.id, 'view'), running.id, { gameId: running.id, tv: false }), true);
  assert.equal(m.isGameWriteBlocked(m.setGameAccessModeInState({}, running.id, 'edit'), running.id, { gameId: running.id, tv: true }), true);
  assert.match(page, /\{!isReadOnly && event.kind !== "highlight" \? \(\s*<div className="button-row button-row--compact event-editor__actions">/);
  assert.match(page, /\{!isReadOnly \? \(\s*<div className="button-row button-row--compact">\s*<button[^>]*\s*type="button"\s*className="ghost-button compact-button"\s*onClick=\{\(\) => void handleUndoLastEvent\(\)\}/);
  // 5) Menue wie ueberall (Main, Neues Spiel, Statistik), verschwindet im Full screen.
  assert.deepEqual(m.getViewOnlyMenuLabels(done).navigation, ['Main', 'Neues Spiel', 'Statistik']);
  assert.doesNotMatch(page, /Zur Uebersicht/);
  assert.match(css, /:root:fullscreen \.tv-game__menu[^{]*\{ display: none; \}/);
  // 6) Entsperren bei gesperrtem Spiel; Ursache: reopenGame auf eigener Seite blockiert -> jetzt mit Modus "edit" erlaubt.
  assert.ok(m.getViewOnlyMenuLabels(done).options.includes('Entsperren'));
  assert.equal(m.canReopenFromGamePage(true, true, 'edit'), true);
  assert.equal(m.canReopenFromGamePage(true, true, 'view'), false);
  assert.equal(m.canReopenFromGamePage(true, true, null), false);
  assert.match(store, /canReopenFromGamePage\(completed, openedHere/);
  assert.match(page, /await reopenGame\(game\.id\);\s*\/\/[^\n]*\n\s*await pauseActiveTimer\(game\.id\);/);
  // 7) Laufendes Spiel in View only: kein Entsperren/Edit im Menue.
  assert.deepEqual(m.getViewOnlyMenuLabels(running).options, ['Verlauf', 'Notizen', 'Einstellungen', 'Folgen', 'Benachrichtigungen']);
  assert.match(page, /\.\.\.\(closedTv \? \[\{ label: "Entsperren"/);
};
module.exports = { runEditViewOnlyTests };
