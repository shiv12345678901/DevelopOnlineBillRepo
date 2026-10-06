/**
 * Terminal importer: links a user-provided OCR JSON to the WhatsApp chat
 * export's images and stores the results in Supabase.
 *
 * Usage:
 *   node scripts/import-chat.mjs <ocr.json> [--zip <path>] [--dry]
 *
 * - Images are ordered by file name ascending and paired with the OCR JSON
 *   results at the same index.
 * - Chat messages attribute every image to a sender and a date.
 * - Settlement periods split on the household's "clear" markers become
 *   cycles (closed for settled ones, open for the live one).
 * - Entries with a usable total are inserted into their period's cycle,
 *   referencing the image already stored in the grocery-receipts bucket
 *   under its original WhatsApp file name.
 * - Idempotent: images whose fingerprint is already in the ledger are
 *   skipped, so the script can be re-run safely at any time.
 */

import { unzipSync } from "fflate";
import { readFileSync } from "node:fs";

const SUPABASE_URL = "https://oisbygwncnperuxfkvfd.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pc2J5Z3duY25wZXJ1eGZrdmZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExNzg0ODcsImV4cCI6MjEwNjc1NDQ4N30.Zp4mhbNt2DPT1ricYwf0BlWbEz22pJBk4AfQoFDQUyQ";
const BUCKET = "grocery-receipts";
const MEMBERS = ["Shiva", "Arjun", "Arpan", "Swasti"];
const EXPORTER_MEMBER = "Shiva";
const zipFlag = process.argv.indexOf("--zip");
const ZIP_PATH = zipFlag !== -1 ? process.argv[zipFlag + 1] : "C:/Users/shiva/OneDrive/Documents/WhatsApp Chat - Rockdale Homies Grocery.zip";
const DRY = process.argv.includes("--dry");
const OCR_PATH = process.argv.find((arg, index) => index >= 2 && !arg.startsWith("--") && process.argv[index - 1] !== "--zip");

const MESSAGE_RE = /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AaPp][Mm])\]\s*([^:]+?):\s([\s\S]*)$/;
const CLEAR_RE = /\bclear(ed)?\b/i;
const OMITTED_RE = /<(image|video|album message|document)[^>]*omitted[^>]*>/gi;
const NOISE = /(card|tel|phone|abn|fax|www|http|invoice\s*no|receipt\s*no|ref\s*no|reg\.?\s*no)/i;
const MONEY = /(?:[$₹€£]\s*)?([0-9]{1,3}(?:[,\s][0-9]{3})*\.[0-9]{2}|[0-9]+\.[0-9]{1,2})(?![0-9])/g;
const TOTAL_RANKS = [
  { re: /(grand\s+total|total\s+due|amount\s+due|balance\s+due|total\s+payable|amount\s+payable)/i, rank: 3 },
  { re: /(^|\W)total(\W|$)/i, rank: 2 },
  { re: /sub\s*total|subtotal/i, rank: 1 },
];
const SUMMARY_HEAD_RE = /\(\s*(\d+)\s*members?\s*\)\s*[·\-–—]\s*(\d{4}-\d{2}-\d{2})\s*[·\-–—]\s*(\d{4}-\d{2}-\d{2})/;
const SUMMARY_TOTAL_RE = /Total:\s*\$([\d,]+(?:\.\d+)?)/i;
const SUMMARY_PAID_RE = /^[·\s]*([A-Za-z][A-Za-z .'’-]*?):\s*paid\s*\$([\d,]+(?:\.\d+)?)\s*·\s*share/i;

function cleanText(raw) { return raw.replace(/\u200e/g, "").trim(); }
function toIso(m, d, y) { const year = y.length === 2 ? `20${y}` : y; return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function parseMoney(raw) {
  const match = MONEY.exec(raw.replace(/\u00a0/g, " "));
  MONEY.lastIndex = 0;
  if (!match) return null;
  const value = Number(match[1].replace(/[,\s]/g, ""));
  return Number.isFinite(value) && value > 0 && value <= 100_000 ? value : null;
}
function parseTotalFromText(text) {
  let best = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || NOISE.test(line)) continue;
    let rank = 0;
    for (const { re, rank: value } of TOTAL_RANKS) if (re.test(line)) rank = Math.max(rank, value);
    if (rank === 0) continue;
    const candidate = parseMoney(line);
    if (candidate === null) continue;
    if (!best || rank >= best.rank) best = { rank, amount: candidate };
  }
  return best?.amount ?? null;
}
function guessMerchant(text) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length >= 3 && /^[A-Za-z][A-Za-z0-9&'.\- ]+$/.test(trimmed)) return trimmed;
  }
  return undefined;
}
function mapMember(chatName) {
  const first = String(chatName).split(/\s+/)[0].toLowerCase();
  if (first === "you") return EXPORTER_MEMBER;
  return MEMBERS.find((member) => member.toLowerCase().startsWith(first) || first.startsWith(member.toLowerCase())) ?? "";
}

async function restPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function restGet(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function main() {
  if (!OCR_PATH) {
    console.error("Usage: node scripts/import-chat.mjs <ocr.json> [--zip <path>] [--dry]");
    process.exit(1);
  }

  // --- 1. chat export ---
  const zip = unzipSync(readFileSync(ZIP_PATH));
  const chatName = Object.keys(zip).find((name) => /_chat\.txt$/i.test(name) || /^chat\.txt$/i.test(name));
  if (!chatName) throw new Error("No chat.txt in the export zip.");
  const chatText = Buffer.from(zip[chatName]).toString("utf8");

  // --- 2. messages with date-order voting ---
  const rawMatches = [];
  let dayFirst = false;
  let decided = false;
  for (const rawLine of chatText.split(/\r?\n/)) {
    const line = cleanText(rawLine);
    const match = line.match(MESSAGE_RE);
    if (!match) continue;
    if (!decided) {
      const a = Number(match[1]);
      const b = Number(match[2]);
      if (a > 12) { dayFirst = true; decided = true; }
      else if (b > 12) { dayFirst = false; decided = true; }
      else if (rawMatches.length > 60) decided = true;
    }
    rawMatches.push(match);
  }
  const messages = [];
  let last = null;
  for (const [, a, b, y, hh, mm, ss, ampm, sender, body] of rawMatches) {
    const month = dayFirst ? b : a;
    const day = dayFirst ? a : b;
    let hour = Number(hh) % 12;
    if (/p/i.test(ampm)) hour += 12;
    const text = cleanText(body);
    if (text.startsWith("Messages and calls are end-to-end encrypted")) { last = null; continue; }
    last = { date: toIso(month, day, y), time: `${String(hour).padStart(2, "0")}:${mm}:${ss}`, sender: sender.trim(), text };
    messages.push(last);
  }
  console.log(`chat: ${messages.length} messages, date order = ${dayFirst ? "D/M" : "M/D"}`);

  // --- 3. media attribution via <attached: NAME> markers ---
  const mediaNames = Object.keys(zip).filter((name) => /\.(jpe?g|png|webp)$/i.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const attached = new Map(); // basename -> { sender, date }
  for (const message of messages) {
    for (const att of message.text.matchAll(/<attached:\s*([^>]+)>/g)) {
      const base = att[1].trim().replace(/^.*\//, "");
      attached.set(base, { sender: message.sender, date: message.date });
    }
  }
  const attributed = new Map();
  for (const base of mediaNames) {
    const hit = attached.get(base);
    if (hit) attributed.set(base, { sender: mapMember(hit.sender) || hit.sender, date: hit.date });
  }
  console.log(`media in zip: ${mediaNames.length}, attributed to a member: ${attributed.size}`);

  // --- 4. settlement periods from clear markers ---
  const segments = [];
  let current = null;
  let lastMessage = null;
  let summaryPending = null; // summary pasted since the last boundary
  for (const message of messages) {
    if (!current) current = { start: message.date, end: message.date, settled: false, summary: null, images: [] };
    current.end = message.date;
    lastMessage = message;

    const head = message.text.match(SUMMARY_HEAD_RE);
    if (head && message.text.match(SUMMARY_TOTAL_RE)) {
      const paid = [];
      for (const line of message.text.split(/\r?\n/)) {
        const paidMatch = line.match(SUMMARY_PAID_RE);
        if (paidMatch) paid.push({ name: paidMatch[1].trim(), amount: Number(paidMatch[2].replace(/,/g, "")) });
      }
      if (paid.length) summaryPending = { start: head[2], end: head[3], total: Number(message.text.match(SUMMARY_TOTAL_RE)[1].replace(/,/g, "")), paid };
    }

    if (CLEAR_RE.test(message.text) && message.text.length < 80) {
      current.settled = true;
      current.end = message.date;
      if (summaryPending) { current.summary = summaryPending; current.start = summaryPending.start; }
      summaryPending = null;
      segments.push(current);
      current = { start: message.date, end: message.date, settled: false, summary: null, images: [] };
    }
  }
  if (current) segments.push(current);
  console.log(`periods: ${segments.length} (${segments.filter((s) => s.settled).length} settled, 1 live)`);

  // --- 5. OCR JSON linking (ascending image order) ---
  const ocrRaw = JSON.parse(readFileSync(OCR_PATH, "utf8"));
  let ocrItems = Array.isArray(ocrRaw) ? ocrRaw : null;
  if (!ocrItems && ocrRaw && typeof ocrRaw === "object") {
    for (const key of ["results", "images", "items", "data", "ocr"]) {
      if (Array.isArray(ocrRaw[key])) { ocrItems = ocrRaw[key]; break; }
    }
  }
  if (!ocrItems) throw new Error("The OCR JSON is not an array (nor wraps one under results/images/items/data/ocr).");
  console.log(`ocr results: ${ocrItems.length}`);

  const sortedMedia = [...mediaNames].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (ocrItems.length !== sortedMedia.length) {
    console.warn(`! OCR count (${ocrItems.length}) != image count (${sortedMedia.length}) — pairing by index up to the shorter length.`);
  }

  // --- 6. build per-period imports ---
  const short = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  const plans = segments.map((segment) => ({
    segment,
    name: segment.settled
      ? `Grocery ${short(segment.start)} – ${short(segment.end)}`
      : `Chat ${short(segment.start)} – ongoing`,
    members: MEMBERS,
    startsOn: segment.start,
    endsOn: segment.settled ? segment.end : null,
    entries: [],
  }));
  const segmentForDate = (date) => plans.find((plan) => date >= plan.startsOn && (!plan.endsOn || date <= plan.endsOn)) ?? plans[plans.length - 1];

  sortedMedia.forEach((basename, index) => {
    const item = ocrItems[index];
    if (item === undefined || item === null) return;
    const info = attributed.get(basename) ?? { sender: EXPORTER_MEMBER, date: "", time: "" };
    const text = typeof item === "string" ? item : (item.text ?? (Array.isArray(item.lines) ? item.lines.join("\n") : ""));
    const total = typeof item === "object" && typeof item.amount === "number" ? item.amount : parseTotalFromText(text);
    if (!(total > 0)) return;
    const merchant = typeof item === "object" && typeof item.merchant === "string" && item.merchant ? item.merchant : guessMerchant(text) ?? "Receipt";
    const plan = segmentForDate(info.date);
    if (!plan) return;
    const payer = mapMember(info.sender) || MEMBERS[0];
    plan.entries.push({ payer, amount: total, merchant, spentOn: info.date, note: `Imported from WhatsApp — ${basename}`, receipt_path: basename });
  });

  // --- 7. plan summary ---
  for (const plan of plans) {
    console.log(`${plan.endsOn ? "CLOSED" : "OPEN   "} | ${plan.name} | entries: ${plan.entries.length}`);
  }

  if (DRY) {
    console.log("DRY RUN — nothing written.");
    return;
  }

  // --- 8. write: cycles (skip existing by name) then entries ---
  const existingCycles = await restGet("/settlement_cycles?select=id,name,ends_on");
  const cycleIdByName = new Map(existingCycles.map((cycle) => [cycle.name, cycle.id]));

  for (const plan of plans) {
    let cycleId = cycleIdByName.get(plan.name);
    if (!cycleId) {
      const [created] = await restPost("/settlement_cycles", {
        name: plan.name,
        members: MEMBERS,
        starts_on: plan.startsOn,
        ends_on: plan.endsOn,
      });
      cycleId = created.id;
      console.log(`created cycle ${plan.name} (id ${cycleId})`);
    } else {
      console.log(`cycle exists: ${plan.name} (id ${cycleId})`);
    }
    plan.cycleId = cycleId;
  }

  // Existing entries (dedup by receipt_path)
  const existingEntries = await restGet("/grocery_ledger?select=id,receipt_path");
  const existingPaths = new Set(existingEntries.map((entry) => entry.receipt_path).filter(Boolean));

  const rows = [];
  for (const plan of plans) {
    for (const entry of plan.entries) {
      if (existingPaths.has(entry.receipt_path)) continue; // already imported
      rows.push({
        cycle_id: plan.cycleId,
        payer: entry.payer,
        amount: entry.amount,
        merchant: entry.merchant,
        note: entry.note,
        spent_on: entry.spentOn,
        ai_confidence: 1,
        receipt_path: entry.receipt_path,
      });
    }
  }
  console.log(`entries to insert: ${rows.length}`);
  for (let i = 0; i < rows.length; i += 50) {
    await restPost("/grocery_ledger", rows.slice(i, i + 50));
    console.log(`inserted ${Math.min(i + 50, rows.length)} / ${rows.length}`);
  }
  console.log("DONE");
}

main().catch((error) => { console.error("FAILED:", error.message); process.exit(1); });
