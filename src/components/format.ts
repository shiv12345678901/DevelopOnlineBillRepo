export function formatDate(d: string) {
  try {
    return new Date(d + "T12:00:00").toLocaleDateString("en-AU", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch {
    return d;
  }
}

/** Stable semantic tint for a person, merchant, or category label. */
export function toneClass(value: string) {
  const hash = Array.from(value || "?").reduce((total, char) => total + char.charCodeAt(0), 0);
  return `tone-${(hash % 6) + 1}`;
}
