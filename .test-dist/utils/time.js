"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatClockTimeWithSeconds = exports.formatClockTime = exports.formatDateLabel = exports.formatDuration = exports.getDurationMs = exports.toBerlinDateTimeInput = exports.toLocalTimeInput = exports.toLocalDateInput = exports.getNowIso = exports.berlinWallClockToMs = exports.getBerlinParts = exports.APP_TIME_ZONE = void 0;
const serverClock_1 = require("./serverClock");
// Alle angezeigten Uhrzeiten fest in Europe/Berlin (#45): Pepper sah im Browser mit anderer Zeitzone "Sync 14:57" statt
// 20:57 MESZ. Gilt auch fuer Eingaben (geplanter Start, Ereigniszeit) und deren Rueckumrechnung, damit beides zusammenpasst.
exports.APP_TIME_ZONE = "Europe/Berlin";
const partsFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: exports.APP_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
});
const pad = (value) => String(value).padStart(2, "0");
// Wanduhr in Berlin zu einem Zeitpunkt.
const getBerlinParts = (date) => {
    const parts = {};
    for (const part of partsFormatter.formatToParts(date))
        if (part.type !== "literal")
            parts[part.type] = Number(part.value);
    return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute, second: parts.second };
};
exports.getBerlinParts = getBerlinParts;
const berlinOffsetMs = (utcMs) => {
    const p = (0, exports.getBerlinParts)(new Date(utcMs));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
};
// "YYYY-MM-DD" + "HH:MM[:SS]" als Berliner Wanduhr -> Zeitpunkt (ms). Ungueltig -> NaN.
const berlinWallClockToMs = (date, time = "00:00") => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const clock = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(time);
    if (!match || !clock)
        return Number.NaN;
    const guess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(clock[1]), Number(clock[2]), Number(clock[3] ?? 0));
    if (!Number.isFinite(guess))
        return Number.NaN;
    const first = guess - berlinOffsetMs(guess);
    // Sommer-/Winterzeit: Versatz am Ergebnis erneut pruefen.
    return guess - berlinOffsetMs(first);
};
exports.berlinWallClockToMs = berlinWallClockToMs;
const getNowIso = () => new Date((0, serverClock_1.getServerNow)()).toISOString();
exports.getNowIso = getNowIso;
const toLocalDateInput = (date = new Date()) => {
    const p = (0, exports.getBerlinParts)(date);
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};
exports.toLocalDateInput = toLocalDateInput;
const toLocalTimeInput = (date = new Date()) => {
    const p = (0, exports.getBerlinParts)(date);
    return `${pad(p.hour)}:${pad(p.minute)}`;
};
exports.toLocalTimeInput = toLocalTimeInput;
// Fuer <input type="datetime-local">: Zeitpunkt -> Berliner Wanduhr "YYYY-MM-DDTHH:MM:SS".
const toBerlinDateTimeInput = (date) => {
    const p = (0, exports.getBerlinParts)(date);
    return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
};
exports.toBerlinDateTimeInput = toBerlinDateTimeInput;
const getDurationMs = (startedAt, endedAt) => {
    if (!startedAt || !endedAt) {
        return 0;
    }
    const start = new Date(startedAt).getTime();
    const end = new Date(endedAt).getTime();
    return (0, serverClock_1.elapsedTimerMs)(start, 0, true, end);
};
exports.getDurationMs = getDurationMs;
const formatDuration = (durationMs) => {
    if (!durationMs) {
        return "0m";
    }
    const totalSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
};
exports.formatDuration = formatDuration;
const formatDateLabel = (date, time) => {
    if (!date) {
        return "-";
    }
    const formattedDate = new Date(`${date}T${time || "00:00"}`).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });
    return time ? `${formattedDate}, ${time}` : formattedDate;
};
exports.formatDateLabel = formatDateLabel;
const formatClockTime = (iso) => {
    if (!iso) {
        return "-";
    }
    return new Date(iso).toLocaleTimeString("de-DE", {
        timeZone: exports.APP_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit"
    });
};
exports.formatClockTime = formatClockTime;
const formatClockTimeWithSeconds = (iso) => {
    if (!iso) {
        return "-";
    }
    return new Date(iso).toLocaleTimeString("de-DE", {
        timeZone: exports.APP_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
};
exports.formatClockTimeWithSeconds = formatClockTimeWithSeconds;
