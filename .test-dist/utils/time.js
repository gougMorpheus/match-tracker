"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatClockTimeWithSeconds = exports.formatClockTime = exports.formatDateLabel = exports.formatDuration = exports.getDurationMs = exports.toLocalTimeInput = exports.toLocalDateInput = exports.getNowIso = void 0;
const getNowIso = () => new Date().toISOString();
exports.getNowIso = getNowIso;
const toLocalDateInput = (date = new Date()) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
};
exports.toLocalDateInput = toLocalDateInput;
const toLocalTimeInput = (date = new Date()) => {
    return date.toTimeString().slice(0, 5);
};
exports.toLocalTimeInput = toLocalTimeInput;
const getDurationMs = (startedAt, endedAt) => {
    if (!startedAt || !endedAt) {
        return 0;
    }
    const start = new Date(startedAt).getTime();
    const end = new Date(endedAt).getTime();
    return Math.max(end - start, 0);
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
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
};
exports.formatClockTimeWithSeconds = formatClockTimeWithSeconds;
