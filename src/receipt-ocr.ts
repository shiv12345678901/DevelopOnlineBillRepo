import { createWorker } from "tesseract.js";

/**
 * On-device receipt OCR fallback (Tesseract.js, runs fully in the browser).
 * Used when the Gemini API is unavailable or returns nothing usable, so the
 * scan flow never dead-ends: AI first, on-device second, manual entry last.
 *
 * The parser only trusts lines explicitly labelled as a total. A blind
 * "last number on the page" rule once turned a card number (**** 1220)
 * into the amount, so unlabeled numbers are never treated as money.
 */

export type OnDeviceResult = {
  amount: number | null;
  merchant: string;
  confidence: number;
};

let workerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null;

function getWorker() {
  if (!workerPromise) workerPromise = createWorker("eng");
  return workerPromise;
}

// Higher rank beats lower; the last match within a rank wins because the
// grand total prints below the subtotal on almost every receipt.
const TOTAL_RANKS: Array<{ re: RegExp; rank: number }> = [
  { re: /(grand\s+total|total\s+due|amount\s+due|balance\s+due|total\s+payable|amount\s+payable)/i, rank: 3 },
  { re: /(^|\W)total(\W|$)/i, rank: 2 },
  { re: /sub\s*total|subtotal/i, rank: 1 },
];

// Lines that merely contain digits of an identifier are never money.
const NOISE = /(card|tel|phone|abn|fax|www|http|invoice\s*no|receipt\s*no|ref\s*no|reg\.?\s*no)/i;

// Real totals carry cents; bare integers are IDs, quantities or card digits.
const MONEY = /(?:[$₹€£]\s*)?([0-9]{1,3}(?:[,\s][0-9]{3})*\.[0-9]{2}|[0-9]+\.[0-9]{1,2})(?![0-9])/g;

function parseMoney(raw: string): number | null {
  const match = MONEY.exec(raw.replace(/\u00a0/g, " "));
  MONEY.lastIndex = 0;
  if (!match) return null;
  const value = Number(match[1].replace(/[,\s]/g, ""));
  if (!Number.isFinite(value) || value <= 0 || value > 100_000) return null;
  return value;
}

export async function ocrOnDevice(imageBase64: string): Promise<OnDeviceResult> {
  const worker = await getWorker();
  const { data } = await worker.recognize(`data:image/jpeg;base64,${imageBase64}`);
  const lines = (data.text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 2);

  let best: { rank: number; amount: number } | null = null;
  for (const line of lines) {
    if (NOISE.test(line)) continue;
    let rank = 0;
    for (const { re, rank: value } of TOTAL_RANKS) {
      if (re.test(line)) rank = Math.max(rank, value);
    }
    if (rank === 0) continue;
    const candidate = parseMoney(line);
    if (candidate === null) continue;
    if (!best || rank >= best.rank) best = { rank, amount: candidate };
  }

  const merchant = lines.find((line) => /^[A-Za-z][A-Za-z&'.\- ]{2,30}$/.test(line)) ?? "";

  return {
    amount: best?.amount ?? null,
    merchant,
    // Tesseract word confidence scaled down: parsed totals are less certain
    // than a vision model's answer, and the UI treats <50% as "verify".
    confidence: best ? Math.round(((data.confidence ?? 0) / 100) * 0.6 * 100) / 100 : 0,
  };
}
