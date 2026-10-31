"use strict";
// Projektübersicht = Freischaltung/Sichtbarkeit (nur lesen).
// Match-Tracker-Modi bleiben Edit und View only, nicht die Dashboard-Begriffe.
// Keine Schreibzugriffe auf dashboard.app_access oder andere Rechte.
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDashboardRoleOnce = exports.clearCachedDashboardRole = exports.clearDashboardRoleMemory = exports.isSessionWriteBlocked = exports.setSessionWriteGate = exports.getSessionWriteGate = exports.appHashAfterAuth = exports.hashHasAuthTokens = exports.accessScreenForRole = exports.dashboardLoginErrorMessage = exports.classifyDashboardConfig = exports.readAppRoleResult = exports.serializeCachedDashboardRole = exports.parseCachedDashboardRole = exports.roleAllowsEdit = exports.parseDashboardRole = exports.DASHBOARD_ROLE_CACHE_KEY = exports.DASHBOARD_HOME_URL = exports.MATCH_TRACKER_APP_SLUG = void 0;
exports.MATCH_TRACKER_APP_SLUG = "match-tracker";
exports.DASHBOARD_HOME_URL = "https://bfg-projekte-uebersicht.netlify.app/";
exports.DASHBOARD_ROLE_CACHE_KEY = "match-tracker.dashboard-role.v1";
const parseDashboardRole = (value) => value === "admin" || value === "bearbeiten" || value === "ansehen" ? value : null;
exports.parseDashboardRole = parseDashboardRole;
const roleAllowsEdit = (role) => role === "admin" || role === "bearbeiten";
exports.roleAllowsEdit = roleAllowsEdit;
// null = gelesen, kein Zugang. undefined = kein Cache fuer dieses Konto.
const parseCachedDashboardRole = (raw, userId) => {
    if (!raw)
        return undefined;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || parsed.userId !== userId || !("role" in parsed))
            return undefined;
        if (parsed.role == null || parsed.role === "")
            return null;
        return (0, exports.parseDashboardRole)(parsed.role) ?? undefined;
    }
    catch {
        return undefined;
    }
};
exports.parseCachedDashboardRole = parseCachedDashboardRole;
const serializeCachedDashboardRole = (userId, role) => JSON.stringify({ userId, role });
exports.serializeCachedDashboardRole = serializeCachedDashboardRole;
const readAppRoleResult = (data) => {
    if (data == null)
        return { ok: true, role: null };
    if (typeof data === "string") {
        const trimmed = data.trim();
        if (!trimmed)
            return { ok: true, role: null };
        const role = (0, exports.parseDashboardRole)(trimmed);
        return role ? { ok: true, role } : { ok: false };
    }
    return { ok: false };
};
exports.readAppRoleResult = readAppRoleResult;
const classifyDashboardConfig = (url, key) => {
    const configuredUrl = (url ?? "").trim();
    const configuredKey = (key ?? "").trim();
    if (!configuredUrl && !configuredKey)
        return "off";
    if (!configuredUrl || !configuredKey)
        return "incomplete";
    return "ready";
};
exports.classifyDashboardConfig = classifyDashboardConfig;
const dashboardLoginErrorMessage = (error) => {
    const code = error?.code ?? "";
    const message = error?.message ?? "";
    if (code === "invalid_credentials" || /invalid login/i.test(message))
        return "E-Mail-Adresse oder Passwort ist falsch.";
    if (code === "email_not_confirmed")
        return "Diese E-Mail-Adresse ist noch nicht bestätigt. Bitte wenden Sie sich an die Administration.";
    if (code === "user_banned")
        return "Dieser Zugang ist gesperrt. Bitte wenden Sie sich an die Administration.";
    if (error?.status === 429 || /rate limit|too many/i.test(message))
        return "Zu viele Versuche in kurzer Zeit. Bitte warten Sie einige Minuten und versuchen Sie es dann erneut.";
    if (error?.name === "AuthRetryableFetchError" || error?.status === 0 || /fetch|network/i.test(message)) {
        return "Der Anmeldedienst ist gerade nicht erreichbar. Bitte prüfen Sie die Verbindung und versuchen Sie es erneut.";
    }
    return "Die Anmeldung hat nicht geklappt. Bitte versuchen Sie es erneut.";
};
exports.dashboardLoginErrorMessage = dashboardLoginErrorMessage;
// Nicht angemeldet → Login. Rolle null → Hinweis. ansehen → View only. bearbeiten/admin → Edit wie bisher.
const accessScreenForRole = (signedIn, role) => {
    if (!signedIn)
        return "login";
    if (role == null)
        return "no-access";
    return (0, exports.roleAllowsEdit)(role) ? "edit" : "view";
};
exports.accessScreenForRole = accessScreenForRole;
const hashHasAuthTokens = (hash) => /(?:^|#|&)(?:access_token|refresh_token)=/.test(hash);
exports.hashHasAuthTokens = hashHasAuthTokens;
// Dashboard haengt die Sitzung an den Hash. Danach wieder die App-Route.
const appHashAfterAuth = (hash) => ((0, exports.hashHasAuthTokens)(hash) ? "#/games" : null);
exports.appHashAfterAuth = appHashAfterAuth;
let gate = "legacy";
const getSessionWriteGate = () => gate;
exports.getSessionWriteGate = getSessionWriteGate;
const setSessionWriteGate = (next) => {
    gate = next;
};
exports.setSessionWriteGate = setSessionWriteGate;
// "view" sperrt Schreiben ueber die bestehende View-only-Sperre. "legacy" und "edit" lassen sie unveraendert.
const isSessionWriteBlocked = () => gate === "view";
exports.isSessionWriteBlocked = isSessionWriteBlocked;
const inflight = new Map();
const clearDashboardRoleMemory = () => {
    inflight.clear();
};
exports.clearDashboardRoleMemory = clearDashboardRoleMemory;
const clearCachedDashboardRole = (storage) => {
    storage.removeItem(exports.DASHBOARD_ROLE_CACHE_KEY);
    inflight.clear();
};
exports.clearCachedDashboardRole = clearCachedDashboardRole;
// Ein Abruf pro Konto und Sitzung. Weitere Aufrufe lesen den Cache und treffen das Dashboard nicht erneut.
const loadDashboardRoleOnce = (userId, storage, fetchRole) => {
    const cached = (0, exports.parseCachedDashboardRole)(storage.getItem(exports.DASHBOARD_ROLE_CACHE_KEY), userId);
    if (cached !== undefined)
        return Promise.resolve(cached);
    const existing = inflight.get(userId);
    if (existing)
        return existing;
    const pending = fetchRole().then((data) => {
        const parsed = (0, exports.readAppRoleResult)(data);
        if (!parsed.ok)
            throw new Error("Unerwartete Antwort von my_app_role.");
        storage.setItem(exports.DASHBOARD_ROLE_CACHE_KEY, (0, exports.serializeCachedDashboardRole)(userId, parsed.role));
        return parsed.role;
    }).finally(() => {
        if (inflight.get(userId) === pending)
            inflight.delete(userId);
    });
    inflight.set(userId, pending);
    return pending;
};
exports.loadDashboardRoleOnce = loadDashboardRoleOnce;
