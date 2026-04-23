export const getNowIso = (): string => new Date().toISOString();

export const toLocalDateInput = (date = new Date()): string => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

export const toLocalTimeInput = (date = new Date()): string => {
  return date.toTimeString().slice(0, 5);
};

export const getDurationMs = (startedAt?: string, endedAt?: string): number => {
  if (!startedAt || !endedAt) {
    return 0;
  }

  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  return Math.max(end - start, 0);
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
    hour: "2-digit",
    minute: "2-digit"
  });
};
