/**
 * Standalone PaddleOCR scanner — an experiment isolated from the app's
 * Gemini pipeline. Loads PP-OCRv2 detection + recognition models in the
 * browser through PaddleJS (WebGL), entirely on-device and key-free.
 *
 * The parser is deliberately self-contained (a copy of the hardened
 * total-extraction rules) so this scanner can be evaluated and swapped in
 * independently of src/api.ts.
 */

export type PaddleScan = {
  lines: string[];
  total: number | null;
  ms: number;
};

type Point = { x: number; y: number };
type PaddleModule = {
  init(): Promise<void>;
  recognize(img: HTMLImageElement): Promise<{ text: string[]; points: Point[][] }>;
};

declare global {
  interface Window {
    paddlejs?: { ocr?: PaddleModule };
  }
}

let modulePromise: Promise<PaddleModule> | null = null;

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not download the PaddleOCR library."));
    document.head.appendChild(script);
  });
}

async function loadPaddle(): Promise<PaddleModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      // The library is an emscripten/UMD bundle that breaks inside Vite's
      // strict ESM output ("Module is not defined"), so it is loaded as a
      // classic script from /public instead of being imported.
      await loadScriptOnce("/paddle-ocr/ocr-lib.js");
      const paddle = window.paddlejs?.ocr;
      if (!paddle) throw new Error("PaddleOCR did not initialise.");
      await paddle.init();
      return paddle;
    })();
  }
  return modulePromise;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image.")); };
    img.src = url;
  });
}

// --- total extraction rules (mirror of the app's hardened parser) ---

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

export function parseTotal(lines: string[]): number | null {
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
  return best?.amount ?? null;
}

/**
 * The detector splits one printed line into several boxes ("TOTAL" and
 * "10.80"), so logical rows are rebuilt geometrically: boxes whose vertical
 * centres sit close together are merged left-to-right.
 */
function mergeRows(texts: string[], boxes: Point[][]): string[] {
  const items = texts
    .map((text, index) => {
      // Points arrive as [x, y] arrays; normalise before measuring.
      const points = (boxes[index] ?? []).map((point) => (Array.isArray(point) ? { x: point[0], y: point[1] } : point));
      if (!points.length) return null;
      const ys = points.map((point) => point.y);
      const xs = points.map((point) => point.x);
      return {
        text: String(text).trim(),
        centerX: xs.reduce((sum, x) => sum + x, 0) / xs.length,
        centerY: ys.reduce((sum, y) => sum + y, 0) / ys.length,
        height: Math.max(...ys) - Math.min(...ys),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null && item.text.length > 0);

  items.sort((a, b) => a.centerY - b.centerY);
  const rows: Array<typeof items> = [];
  for (const item of items) {
    const row = rows[rows.length - 1];
    const reference = row?.[0];
    const tolerance = Math.max(item.height, reference?.height ?? 0) * 0.7 || 8;
    if (row && reference && Math.abs(item.centerY - reference.centerY) <= tolerance) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) =>
    row.sort((a, b) => a.centerX - b.centerX).map((item) => item.text).join(" ").replace(/\s+/g, " ").trim(),
  ).filter(Boolean);
}

export async function paddleScan(file: File): Promise<PaddleScan> {
  const started = performance.now();
  const paddle = await loadPaddle();
  const img = await loadImage(file);
  const result = await paddle.recognize(img);
  const lines = mergeRows(result.text ?? [], result.points ?? []);
  return { lines, total: parseTotal(lines), ms: Math.round(performance.now() - started) };
}
