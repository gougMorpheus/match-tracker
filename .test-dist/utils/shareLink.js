"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shareResultMessage = exports.shareSpectatorLink = exports.buildSpectatorLink = void 0;
const gameAccessMode_1 = require("./gameAccessMode");
// Direktlink zur Zuschaueransicht (View only) eines Spiels.
const buildSpectatorLink = (origin, pathname, gameId) => `${origin}${pathname || "/"}#${(0, gameAccessMode_1.getTvModeHash)(gameId)}`;
exports.buildSpectatorLink = buildSpectatorLink;
// Immer kopieren (mit kurzer Bestaetigung); auf dem Handy zusaetzlich den Teilen-Dialog oeffnen.
const shareSpectatorLink = async (url, title, deps) => {
    let copied = false, shared = false;
    if (deps.clipboardWrite) {
        try {
            await deps.clipboardWrite(url);
            copied = true;
        }
        catch {
            copied = false;
        }
    }
    if (deps.isMobile && deps.share) {
        try {
            await deps.share({ title, url });
            shared = true;
        }
        catch {
            shared = false;
        }
    }
    return copied && shared ? "copied+shared" : copied ? "copied" : shared ? "shared" : "failed";
};
exports.shareSpectatorLink = shareSpectatorLink;
const shareResultMessage = (result, url) => result === "failed" ? `Link: ${url}` : result === "shared" ? "Link geteilt" : "Link kopiert";
exports.shareResultMessage = shareResultMessage;
