/**
 * Persistent state for the WhatsApp importer so re-imports are idempotent:
 * already-scanned images are never OCR'd twice, "not a receipt" exclusions
 * are honoured forever (by name+size fingerprint), and imported settled
 * periods are skipped. Kept per-device in localStorage.
 */

const STATE_KEY = "rockdale-import-state";

export type MediaStatus = "imported" | "excluded";

export type MediaRecord = {
  status: MediaStatus;
  /** Canonical stored name: Sender_YYYY-MM-DD_HH-MM-SS-mmm.ext */
  savedName: string;
  /** Bucket path when the image was uploaded (receipts bucket). */
  storagePath?: string;
  cycleId?: string;
  entryId?: string;
};

export type ImportState = {
  version: 1;
  /** fingerprint -> record */
  media: Record<string, MediaRecord>;
  /** settled-period key (rangeEnd) -> cycleId */
  segments: Record<string, { cycleId: string; rangeStart: string; rangeEnd: string }>;
};

const emptyState = (): ImportState => ({ version: 1, media: {}, segments: {} });

export function loadImportState(): ImportState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as ImportState;
    if (parsed.version !== 1) return emptyState();
    return { version: 1, media: parsed.media ?? {}, segments: parsed.segments ?? {} };
  } catch {
    return emptyState();
  }
}

export function saveImportState(state: ImportState) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // State is an optimisation; a failed save just means re-processing later.
  }
}

/** Stable fingerprint: original file name + byte size (+ sender when known). */
export function mediaFingerprint(name: string, size: number, sender?: string): string {
  return `${name.replace(/^.*\//, "")}|${size}|${sender ?? ""}`;
}

/**
 * Canonical, collision-free stored name:
 *   Sender_YYYY-MM-DD_HH-MM-SS-mmm.ext
 * Multiple images inside the same second get a running millisecond suffix so
 * they can never collide.
 */
export function canonicalName(sender: string, date: string, time: string, originalName: string, seq: number): string {
  const safeSender = (sender.split(/\s+/)[0] || "Unknown").replace(/[^A-Za-z0-9]/g, "");
  const extMatch = originalName.match(/\.(jpe?g|png|webp)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
  const [hh = "00", mm = "00", ssWithMs = "00"] = time.split(":");
  const [ss, msRaw] = ssWithMs.split(".");
  const ms = msRaw ? msRaw.padEnd(3, "0").slice(0, 3) : String(seq * 7 + 101).slice(0, 3);
  return `${safeSender}_${date}_${hh}-${mm}-${ss}-${ms}.${ext}`;
}
