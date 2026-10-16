"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shareResultMessage = exports.shareSpectatorLink = exports.buildSpectatorLink = void 0;
const gameAccessMode_1 = require("./gameAccessMode");
// Direktlink zur Zuschaueransicht (View only) eines Spiels.
const buildSpectatorLink = (origin, pathname, gameId) => `${origin}${pathname || "/"}#${(0, gameAccessMode_1.getTvModeHash)(gameId)}`;
exports.buildSpectatorLink = buildSpectatorLink;
const isAbort = (error) => Boolean(error && typeof error === "object" && error.name === "AbortError");
// Handy: Teilen-Dialog (navigator.share). Nur wenn es ihn nicht gibt (oder er technisch scheitert), kopieren.
// Abbruch im Teilen-Dialog: keine Meldung. Desktop: kopieren.
const shareSpectatorLink = async (url, title, deps) => {
    if (deps.isMobile && deps.share) {
        try {
            await deps.share({ title, url });
            return "shared";
        }
        catch (error) {
            if (isAbort(error))
                return "cancelled";
        }
    }
    if (deps.clipboardWrite) {
        try {
            await deps.clipboardWrite(url);
            return "copied";
        }
        catch { /* Fallback: Link anzeigen */ }
    }
    return "failed";
};
exports.shareSpectatorLink = shareSpectatorLink;
const shareResultMessage = (result, url) => result === "cancelled" ? null : result === "failed" ? `Link: ${url}` : result === "shared" ? "Link geteilt" : "Link kopiert";
exports.shareResultMessage = shareResultMessage;
