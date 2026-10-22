import { elapsedTimerMs, getServerNow } from "./serverClock";

// Alle angezeigten Uhrzeiten fest in Europe/Berlin (#45): Pepper sah im Browser mit anderer Zeitzone "Sync 14:57" statt
// 20:57 MESZ. Gilt auch fuer Eingaben (geplanter Start, Ereigniszeit) und deren Rueckumrechnung, damit beides zusammenpasst.
export const APP_TIME_ZONE = "Europe/Berlin";

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit"
});

const pad = (value: number): string => String(value).padStart(2, "0");

// Wanduhr in Berlin zu einem Zeitpunkt.
export const getBerlinParts = (date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } => {
  const parts: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(date)) if (part.type !== "literal") parts[part.type] = Number(part.value);
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute, second: parts.second };
};

const berlinOffsetMs = (utcMs: number): number => {
  const p = getBerlinParts(new Date(utcMs));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
};

// "YYYY-MM-DD" + "HH:MM[:SS]" als Berliner Wanduhr -> Zeitpunkt (ms). Ungueltig -> NaN.
export const berlinWallClockToMs = (date: string, time = "00:00"): number => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(time);
  if (!match || !clock) return Number.NaN;
  const guess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(clock[1]), Number(clock[2]), Number(clock[3] ?? 0));
  if (!Number.isFinite(guess)) return Number.NaN;
  const first = guess - berlinOffsetMs(guess);
  // Sommer-/Winterzeit: Versatz am Ergebnis erneut pruefen.
  return guess - berlinOffsetMs(first);
};

export const getNowIso = (): string => new Date(getServerNow()).toISOString();

export const toLocalDateInput = (date = new Date()): string => {
  const p = getBerlinParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

export const toLocalTimeInput = (date = new Date()): string => {
  const p = getBerlinParts(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
};

// Fuer <input type="datetime-local">: Zeitpunkt -> Berliner Wanduhr "YYYY-MM-DDTHH:MM:SS".
export const toBerlinDateTimeInput = (date: Date): string => {
  const p = getBerlinParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
};

export const getDurationMs = (startedAt?: string, endedAt?: string): number => {
  if (!startedAt || !endedAt) {
    return 0;
  }

  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  return elapsedTimerMs(start, 0, true, end);
};

export const formatDuration = (durationMs: number): string => {
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

export const formatDateLabel = (date: string, time?: string): string => {
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

export const formatClockTime = (iso?: string): string => {
  if (!iso) {
    return "-";
  }

  return new Date(iso).toLocaleTimeString("de-DE", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit"
  });
};

export const formatClockTimeWithSeconds = (iso?: string): string => {
  if (!iso) {
    return "-";
  }

  return new Date(iso).toLocaleTimeString("de-DE", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
};
