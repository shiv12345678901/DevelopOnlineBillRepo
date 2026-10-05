/**
 * Offline-first cache for the ledger snapshot. Page loads serve the last
 * known data instantly and revalidate in the background only when the
 * cache is older than the app's freshness window — a warm load makes zero
 * network calls.
 */

const CACHE_KEY = "rockdale-ledger-cache";
const CACHE_VERSION = 1;

export type LedgerCache = {
  version: number;
  savedAt: number;
  cycles: unknown[];
  entries: unknown[];
  activeId: string | null;
};

export function loadLedgerCache(): LedgerCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LedgerCache;
    if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.cycles) || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLedgerCache(cycles: unknown[], entries: unknown[], activeId: string | null, savedAt = Date.now()) {
  const payload: LedgerCache = { version: CACHE_VERSION, savedAt, cycles, entries, activeId };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Inline data-URL receipt images can exceed the storage quota; retry
    // without them — bucket-hosted images are just URLs and survive.
    try {
      const slim = {
        ...payload,
        entries: entries.map((entry) => {
          const withUrl = entry as { receiptUrl?: string };
          return withUrl.receiptUrl?.startsWith("data:") ? { ...withUrl, receiptUrl: undefined } : entry;
        }),
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(slim));
    } catch {
      // Cache is an optimization; the app works without it.
    }
  }
}
