export function formatDate(d: string) {
  try {
    return new Date(d + "T12:00:00").toLocaleDateString("en-AU", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch {
    return d;
  }
}

export function formatRelativeTime(value: string, now = Date.now()) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;

  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (elapsedSeconds < 60) return "just now";

  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return minutes === 1 ? "1m ago" : `${minutes}min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}hr ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  if (days < 30) return `${Math.floor(days / 7)} wk ago`;

  const months = Math.floor(days / 30);
  return `${months} mo ago`;
}

/** Stable semantic tint for a person, merchant, or category label. */
export function toneClass(value: string) {
  const hash = Array.from(value || "?").reduce((total, char) => total + char.charCodeAt(0), 0);
  return `tone-${(hash % 6) + 1}`;
}
