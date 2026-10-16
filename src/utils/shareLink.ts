import { getTvModeHash } from "./gameAccessMode";

// Direktlink zur Zuschaueransicht (View only) eines Spiels.
export const buildSpectatorLink = (origin: string, pathname: string, gameId: string): string =>
  `${origin}${pathname || "/"}#${getTvModeHash(gameId)}`;

export interface ShareDeps {
  clipboardWrite?: (text: string) => Promise<void>;
  share?: (data: { title: string; url: string }) => Promise<void>;
  isMobile: boolean;
}

export type ShareResult = "copied" | "shared" | "copied+shared" | "failed";

// Immer kopieren (mit kurzer Bestaetigung); auf dem Handy zusaetzlich den Teilen-Dialog oeffnen.
export const shareSpectatorLink = async (url: string, title: string, deps: ShareDeps): Promise<ShareResult> => {
  let copied = false, shared = false;
  if (deps.clipboardWrite) { try { await deps.clipboardWrite(url); copied = true; } catch { copied = false; } }
  if (deps.isMobile && deps.share) { try { await deps.share({ title, url }); shared = true; } catch { shared = false; } }
  return copied && shared ? "copied+shared" : copied ? "copied" : shared ? "shared" : "failed";
};

export const shareResultMessage = (result: ShareResult, url: string): string =>
  result === "failed" ? `Link: ${url}` : result === "shared" ? "Link geteilt" : "Link kopiert";
