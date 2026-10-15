"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPushEnvironment = exports.getPushHint = exports.getPushStatus = exports.PUSH_DELIVERY_AVAILABLE = void 0;
// Solange Stufe (b) (Versand ueber Netlify Function + DB-Abos) fehlt: ehrlich "kommt bald".
exports.PUSH_DELIVERY_AVAILABLE = false;
const getPushStatus = (env) => {
    if (env.isIos && !env.isStandalone)
        return "ios-install";
    if (!env.isSecureContext)
        return "insecure";
    if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification || env.permission === "unsupported")
        return "unsupported";
    if (env.permission === "denied")
        return "denied";
    if (env.permission === "granted")
        return "granted";
    return "ask";
};
exports.getPushStatus = getPushStatus;
const COMING_SOON = "Benachrichtigungen kommen bald: Das Folgen wird schon gespeichert, der Versand der Ticker-Meldungen wird gerade eingerichtet.";
const getPushHint = (status, isIos = false) => {
    switch (status) {
        case "ios-install":
            return {
                title: "Erst zum Home-Bildschirm hinzufügen",
                lines: [
                    "Auf iPhone und iPad gibt es Benachrichtigungen nur für installierte Web-Apps (ab iOS 16.4).",
                    "In Safari unten auf „Teilen“ (Quadrat mit Pfeil) tippen, dann „Zum Home-Bildschirm“ und „Hinzufügen“.",
                    "Danach den Match-Tracker über das neue Symbol auf dem Home-Bildschirm öffnen.",
                    COMING_SOON
                ],
                canRequestPermission: false
            };
        case "insecure":
            return { title: "Nur über https", lines: ["Benachrichtigungen funktionieren nur über die sichere Adresse (https).", COMING_SOON], canRequestPermission: false };
        case "unsupported":
            return {
                title: "Dieser Browser kann keine Benachrichtigungen",
                lines: ["Bitte einen aktuellen Browser nutzen, z. B. Chrome, Edge, Firefox oder Safari (auf dem iPhone als Home-Bildschirm-App).", COMING_SOON],
                canRequestPermission: false
            };
        case "denied":
            return {
                title: "Benachrichtigungen sind blockiert",
                lines: [
                    isIos
                        ? "iPhone: Einstellungen → Mitteilungen → Match-Tracker → „Mitteilungen erlauben“ einschalten."
                        : "Im Browser links neben der Adresse auf das Schloss bzw. die Seiteneinstellungen tippen und „Benachrichtigungen“ auf „Zulassen“ stellen. Danach die Seite neu laden.",
                    COMING_SOON
                ],
                canRequestPermission: false
            };
        case "ask":
            return {
                title: "Benachrichtigungen erlauben",
                lines: ["Du kannst Benachrichtigungen schon jetzt erlauben.", COMING_SOON],
                canRequestPermission: true
            };
        case "granted":
        default:
            return { title: "Benachrichtigungen erlaubt", lines: [COMING_SOON], canRequestPermission: false };
    }
};
exports.getPushHint = getPushHint;
const detectPushEnvironment = () => {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    const win = typeof window !== "undefined" ? window : undefined;
    const ua = nav?.userAgent ?? "";
    const isIos = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1);
    const isStandalone = Boolean(win?.matchMedia?.("(display-mode: standalone)").matches || nav?.standalone);
    const hasNotification = Boolean(win && "Notification" in win);
    return {
        hasServiceWorker: Boolean(nav && "serviceWorker" in nav),
        hasPushManager: Boolean(win && "PushManager" in win),
        hasNotification,
        permission: hasNotification ? Notification.permission : "unsupported",
        isIos,
        isStandalone,
        isSecureContext: Boolean(win?.isSecureContext)
    };
};
exports.detectPushEnvironment = detectPushEnvironment;
