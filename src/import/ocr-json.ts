/**
 * OCR-results importer: links a user-provided OCR JSON (one result per
 * image, in ascending image order) to the chat export's media files.
 *
 * Accepts flexible shapes: an array of raw text strings, an array of
 * objects ({ text | lines | raw, merchant?, amount? }), or an object
 * wrapping such an array under results/images/items/data/ocr.
 */

export type OcrJsonItem = {
  text: string;
  merchant?: string;
  amount?: number;
};

export function normalizeOcrJson(raw: unknown): OcrJsonItem[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["results", "images", "items", "data", "ocr"]) {
      if (Array.isArray(obj[key])) {
        arr = obj[key] as unknown[];
        break;
      }
    }
  }
  return arr.map((item) => {
    if (typeof item === "string") return { text: item };
    if (!item || typeof item !== "object") return { text: "" };
    const o = item as Record<string, unknown>;
    const text =
      typeof o.text === "string"
        ? o.text
        : Array.isArray(o.lines)
          ? o.lines.map((line) => String(line)).join("\n")
          : typeof o.raw === "string"
            ? o.raw
            : "";
    const amount = typeof o.amount === "number" ? o.amount : undefined;
    const merchant = typeof o.merchant === "string" ? o.merchant : undefined;
    return { text, amount, merchant };
  });
}

// Total-extraction rules (hardened: labelled totals only, cents required,
// identifier lines excluded — same policy as the rest of the app).
const TOTAL_RANKS: Array<{ re: RegExp; rank: number }> = [
  { re: /(grand\s+total|total\s+due|amount\s+due|balance\s+due|total\s+payable|amount\s+payable)/i, rank: 3 },
  { re: /(^|\W)total(\W|$)/i, rank: 2 },
  { re: /sub\s*total|subtotal/i, rank: 1 },
];

const NOISE = /(card|tel|phone|abn|fax|www|http|invoice\s*no|receipt\s*no|ref\s*no|reg\.?\s*no)/i;

const MONEY = /(?:[$₹€£]\s*)?([0-9]{1,3}(?:[,\s][0-9]{3})*\.[0-9]{2}|[0-9]+\.[0-9]{1,2})(?![0-9])/g;

function parseMoney(raw: string): number | null {
  const match = MONEY.exec(raw.replace(/\u00a0/g, " "));
  MONEY.lastIndex = 0;
  if (!match) return null;
  const value = Number(match[1].replace(/[,\s]/g, ""));
  if (!Number.isFinite(value) || value <= 0 || value > 100_000) return null;
  return value;
}

export function parseTotalFromText(text: string): number | null {
  let best: { rank: number; amount: number } | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || NOISE.test(line)) continue;
    let rank = 0;
    for (const { re, rank: value } of TOTAL_RANKS) {
      if (re.test(line)) rank = Math.max(rank, value);
    }
    if (rank === 0) continue;
    const candidate = parseMoney(line);
    if (candidate === null) continue;
    if (!best || rank >= best.rank) best = { rank, amount: candidate };
  }
  return best?.amount ?? null;
}

/** Merchant heuristic: the first line that reads like a store name. */
export function guessMerchant(text: string): string | undefined {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length >= 3 && /^[A-Za-z][A-Za-z0-9&'.\- ]+$/.test(line) && !/^\d/.test(line)) {
      return line;
    }
  }
  return undefined;
}
