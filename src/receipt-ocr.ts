import { createWorker } from "tesseract.js";

/**
 * On-device receipt OCR fallback (Tesseract.js, runs fully in the browser).
 * Used when the Gemini API is unavailable or returns nothing usable, so the
 * scan flow never dead-ends: AI first, on-device second, manual entry last.
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

const TOTAL_KEYWORDS = /(grand\s+total|sub\s*total|subtotal|total\s+due|amount\s+due|balance\s+due|total\s+payable|amount\s+payable|total)/i;
const MONEY = /(?:[$₹€£]\s*)?([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+\.[0-9]{1,2})/g;

function parseMoney(raw: string): number | null {
  const match = MONEY.exec(raw.replace(/\u00a0/g, " "));
  MONEY.lastIndex = 0;
  if (!match) return null;
  const value = Number(match[1].replace(/[,\s]/g, ""));
  if (!Number.isFinite(value) || value <= 0 || value > 10_000_000) return null;
  return value;
}

export async function ocrOnDevice(imageBase64: string): Promise<OnDeviceResult> {
  const worker = await getWorker();
  const { data } = await worker.recognize(`data:image/jpeg;base64,${imageBase64}`);
  const lines = (data.text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 2);

  // Grand/total lines win; the last match beats earlier subtotal-looking ones.
  let amount: number | null = null;
  for (const line of lines) {
    if (TOTAL_KEYWORDS.test(line)) {
      const candidate = parseMoney(line);
      if (candidate !== null) amount = candidate;
    }
  }
  // No keyword hit: use the last money-looking number on the page, which on
  // receipts is almost always the total.
  if (amount === null) {
    for (const line of lines) {
      const candidate = parseMoney(line);
      if (candidate !== null) amount = candidate;
    }
  }

  const merchant = lines.find((line) => /^[A-Za-z][A-Za-z&'.\- ]{2,30}$/.test(line)) ?? "";

  return {
    amount,
    merchant,
    // Tesseract word confidence scaled down: parsed totals are less certain
    // than a vision model's answer, and the UI treats <50% as "verify".
    confidence: amount === null ? 0 : Math.round(((data.confidence ?? 0) / 100) * 0.6 * 100) / 100,
  };
}
