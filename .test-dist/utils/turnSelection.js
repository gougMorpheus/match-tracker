"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSelectedTurnKey = exports.SETUP_TURN_KEY = void 0;
// Auswahl des angezeigten Zugs im Editor (GamePage). Reine Logik, testbar.
// Regel: Wer auf dem bisher neuesten Zug steht (Normalfall), folgt automatisch dem neuen neuesten Zug,
// z. B. wenn ein anderes Gerät "Weiter" drückt oder nach dem Start der Server-Stand neuer ist als der
// lokale Cache. Wer bewusst einen älteren Zug ansieht (Zurück-Navigation), bleibt dort.
// Fehlerbild ohne diese Regel: Auswahl bleibt auf dem alten Zug, "Timer an" pausiert den laufenden neuen Zug
// und setzt den alten (beendeten) Zug fort (turn-pause R1Z2 + turn-resume R1Z1).
exports.SETUP_TURN_KEY = "setup";
const resolveSelectedTurnKey = ({ current, previousLatestKey, latestKey, turnKeys, snapToLatest, setupStarted, setupRunning = false, followActive = false, setupActive = false }) => {
    if (followActive)
        return setupActive && setupStarted ? exports.SETUP_TURN_KEY : latestKey;
    if (snapToLatest && setupRunning && setupStarted)
        return exports.SETUP_TURN_KEY;
    if (!latestKey)
        return null;
    if (snapToLatest || !current)
        return latestKey;
    if (current === exports.SETUP_TURN_KEY && setupStarted)
        return current;
    if (current === previousLatestKey && current !== latestKey)
        return latestKey;
    return turnKeys.includes(current) ? current : latestKey;
};
exports.resolveSelectedTurnKey = resolveSelectedTurnKey;
