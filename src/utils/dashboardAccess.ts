// Projektübersicht = Freischaltung/Sichtbarkeit (nur lesen).
// Match-Tracker-Modi bleiben Edit und View only, nicht die Dashboard-Begriffe.
// Keine Schreibzugriffe auf dashboard.app_access oder andere Rechte.

export const MATCH_TRACKER_APP_SLUG = "match-tracker";
export const DASHBOARD_HOME_URL = "https://bfg-projekte-uebersicht.netlify.app/";
export const DASHBOARD_ROLE_CACHE_KEY = "match-tracker.dashboard-role.v1";

export type DashboardRole = "admin" | "bearbeiten" | "ansehen";
export type SessionWriteGate = "legacy" | "edit" | "view";
export type AccessScreen = "login" | "no-access" | "view" | "edit";

export const parseDashboardRole = (value: unknown): DashboardRole | null =>
  value === "admin" || value === "bearbeiten" || value === "ansehen" ? value : null;

export const roleAllowsEdit = (role: DashboardRole | null): boolean =>
  role === "admin" || role === "bearbeiten";

// null = gelesen, kein Zugang. undefined = kein Cache fuer dieses Konto.
export const parseCachedDashboardRole = (raw: string | null, userId: string): DashboardRole | null | undefined => {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { userId?: unknown; role?: unknown };
    if (!parsed || typeof parsed !== "object" || parsed.userId !== userId || !("role" in parsed)) return undefined;
    if (parsed.role == null || parsed.role === "") return null;
    return parseDashboardRole(parsed.role) ?? undefined;
  } catch {
    return undefined;
  }
};

export const serializeCachedDashboardRole = (userId: string, role: DashboardRole | null): string =>
  JSON.stringify({ userId, role });

export const readAppRoleResult = (data: unknown): { ok: true; role: DashboardRole | null } | { ok: false } => {
  if (data == null) return { ok: true, role: null };
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) return { ok: true, role: null };
    const role = parseDashboardRole(trimmed);
    return role ? { ok: true, role } : { ok: false };
  }
  return { ok: false };
};

export const classifyDashboardConfig = (url?: string | null, key?: string | null): "off" | "incomplete" | "ready" => {
  const configuredUrl = (url ?? "").trim();
  const configuredKey = (key ?? "").trim();
  if (!configuredUrl && !configuredKey) return "off";
  if (!configuredUrl || !configuredKey) return "incomplete";
  return "ready";
};

export const dashboardLoginErrorMessage = (error: { code?: string; status?: number; message?: string; name?: string } | null | undefined): string => {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "invalid_credentials" || /invalid login/i.test(message)) return "E-Mail-Adresse oder Passwort ist falsch.";
  if (code === "email_not_confirmed") return "Diese E-Mail-Adresse ist noch nicht bestätigt. Bitte wenden Sie sich an die Administration.";
  if (code === "user_banned") return "Dieser Zugang ist gesperrt. Bitte wenden Sie sich an die Administration.";
  if (error?.status === 429 || /rate limit|too many/i.test(message)) return "Zu viele Versuche in kurzer Zeit. Bitte warten Sie einige Minuten und versuchen Sie es dann erneut.";
  if (error?.name === "AuthRetryableFetchError" || error?.status === 0 || /fetch|network/i.test(message)) {
    return "Der Anmeldedienst ist gerade nicht erreichbar. Bitte prüfen Sie die Verbindung und versuchen Sie es erneut.";
  }
  return "Die Anmeldung hat nicht geklappt. Bitte versuchen Sie es erneut.";
};

// Nicht angemeldet → Login. Rolle null → Hinweis. ansehen → View only. bearbeiten/admin → Edit wie bisher.
export const accessScreenForRole = (signedIn: boolean, role: DashboardRole | null): AccessScreen => {
  if (!signedIn) return "login";
  if (role == null) return "no-access";
  return roleAllowsEdit(role) ? "edit" : "view";
};

export const hashHasAuthTokens = (hash: string): boolean =>
  /(?:^|#|&)(?:access_token|refresh_token)=/.test(hash);

// Dashboard haengt die Sitzung an den Hash. Danach wieder die App-Route.
export const appHashAfterAuth = (hash: string): string | null => (hashHasAuthTokens(hash) ? "#/games" : null);

let gate: SessionWriteGate = "legacy";

export const getSessionWriteGate = (): SessionWriteGate => gate;

export const setSessionWriteGate = (next: SessionWriteGate): void => {
  gate = next;
};

// "view" sperrt Schreiben ueber die bestehende View-only-Sperre. "legacy" und "edit" lassen sie unveraendert.
export const isSessionWriteBlocked = (): boolean => gate === "view";

const inflight = new Map<string, Promise<DashboardRole | null>>();

export const clearDashboardRoleMemory = (): void => {
  inflight.clear();
};

export const clearCachedDashboardRole = (storage: { removeItem: (key: string) => void }): void => {
  storage.removeItem(DASHBOARD_ROLE_CACHE_KEY);
  inflight.clear();
};

// Ein Abruf pro Konto und Sitzung. Weitere Aufrufe lesen den Cache und treffen das Dashboard nicht erneut.
export const loadDashboardRoleOnce = (
  userId: string,
  storage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void },
  fetchRole: () => Promise<unknown>
): Promise<DashboardRole | null> => {
  const cached = parseCachedDashboardRole(storage.getItem(DASHBOARD_ROLE_CACHE_KEY), userId);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = inflight.get(userId);
  if (existing) return existing;
  const pending = fetchRole().then((data) => {
    const parsed = readAppRoleResult(data);
    if (!parsed.ok) throw new Error("Unerwartete Antwort von my_app_role.");
    storage.setItem(DASHBOARD_ROLE_CACHE_KEY, serializeCachedDashboardRole(userId, parsed.role));
    return parsed.role;
  }).finally(() => {
    if (inflight.get(userId) === pending) inflight.delete(userId);
  });
  inflight.set(userId, pending);
  return pending;
};
