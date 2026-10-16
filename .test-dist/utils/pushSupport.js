"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPushEnvironment = exports.getPushHint = exports.FOLLOWED_LINE = exports.getPushStatus = exports.PUSH_DELIVERY_AVAILABLE = void 0;
// Stufe (b) ist live: echte Push-Meldungen (Netlify Function + DB-Abos).
exports.PUSH_DELIVERY_AVAILABLE = true;
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
exports.FOLLOWED_LINE = "Du folgst dem Spiel.";
const getPushHint = (status, isIos = false, context = "overview") => {
    const lead = context === "hint" ? [exports.FOLLOWED_LINE] : [];
    switch (status) {
        case "ios-install":
            return {
                title: "Erst zum Home-Bildschirm hinzufügen",
                lines: [...lead,
                    "Auf iPhone und iPad gibt es Notifications nur für installierte Web-Apps (ab iOS 16.4).",
                    "In Safari unten auf „Teilen“ (Quadrat mit Pfeil) tippen, dann „Zum Home-Bildschirm“ und „Hinzufügen“.",
                    "Danach den Match-Tracker über das neue Symbol auf dem Home-Bildschirm öffnen und hier „Notifications erlauben“ tippen."
                ],
                canRequestPermission: false
            };
        case "insecure":
            return { title: "Nur über https", lines: [...lead, "Notifications funktionieren nur über die sichere Adresse (https)."], canRequestPermission: false };
        case "unsupported":
            return {
                title: "Dieser Browser kann keine Notifications",
                lines: [...lead, "Bitte einen aktuellen Browser nutzen, z. B. Chrome, Edge, Firefox oder Safari (auf dem iPhone als Home-Bildschirm-App)."],
                canRequestPermission: false
            };
        case "denied":
            return {
                title: "Notifications sind blockiert",
                lines: [...lead,
                    isIos
                        ? "iPhone: Einstellungen → Mitteilungen → Match-Tracker → „Mitteilungen erlauben“ einschalten."
                        : "Im Browser links neben der Adresse auf das Schloss bzw. die Seiteneinstellungen tippen und „Benachrichtigungen“ auf „Zulassen“ stellen (so heißt die Einstellung im Browser). Danach die Seite neu laden."
                ],
                canRequestPermission: false
            };
        case "ask":
            return {
                title: "Notifications erlauben",
                lines: [...lead, "Erlaube Notifications, dann meldet sich dieses Gerät bei Spielstart, Führungswechsel, Ausgleich, Rundenende, Spielende und weiteren Highlights der gefolgten Spiele."],
                canRequestPermission: true
            };
        case "granted":
        default:
            return { title: "Notifications erlaubt", lines: [...lead, "Dieses Gerät bekommt Meldungen zu den Spielen, denen du folgst. Ein Tipp auf die Meldung öffnet das Spiel (View only)."], canRequestPermission: false };
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
