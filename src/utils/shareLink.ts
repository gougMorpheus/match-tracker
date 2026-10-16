import { getTvModeHash } from "./gameAccessMode";

// Direktlink zur Zuschaueransicht (View only) eines Spiels.
export const buildSpectatorLink = (origin: string, pathname: string, gameId: string): string =>
  `${origin}${pathname || "/"}#${getTvModeHash(gameId)}`;

export interface ShareDeps {
  clipboardWrite?: (text: string) => Promise<void>;
  share?: (data: { title: string; url: string }) => Promise<void>;
  isMobile: boolean;
}

export type ShareResult = "copied" | "shared" | "cancelled" | "failed";

const isAbort = (error: unknown) => Boolean(error && typeof error === "object" && (error as { name?: string }).name === "AbortError");

// Handy: Teilen-Dialog (navigator.share). Nur wenn es ihn nicht gibt (oder er technisch scheitert), kopieren.
// Abbruch im Teilen-Dialog: keine Meldung. Desktop: kopieren.
export const shareSpectatorLink = async (url: string, title: string, deps: ShareDeps): Promise<ShareResult> => {
  if (deps.isMobile && deps.share) {
    try { await deps.share({ title, url }); return "shared"; } catch (error) { if (isAbort(error)) return "cancelled"; }
  }
  if (deps.clipboardWrite) { try { await deps.clipboardWrite(url); return "copied"; } catch { /* Fallback: Link anzeigen */ } }
  return "failed";
};

export const shareResultMessage = (result: ShareResult, url: string): string | null =>
  result === "cancelled" ? null : result === "failed" ? `Link: ${url}` : result === "shared" ? "Link geteilt" : "Link kopiert";
