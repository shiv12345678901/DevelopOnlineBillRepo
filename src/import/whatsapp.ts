import { unzipSync } from "fflate";

/**
 * WhatsApp chat-export importer.
 *
 * Household convention: a settlement is confirmed with a "clear" message
 * ("Clear up to date 19 th September") and the app's own summary block is
 * pasted shortly before it. Everything after the last clear marker is the
 * live cycle. Handles both zip and extracted-folder exports, with or
 * without media.
 */

export type WhatsAppMessage = {
  /** ISO yyyy-mm-dd */
  date: string;
  time: string;
  sender: string;
  text: string;
};

export type SummaryBlock = {
  rangeStart: string;
  rangeEnd: string;
  total: number;
  paid: { name: string; amount: number }[];
};

export type RawMedia = {
  name: string;
  /** Present for folder imports; zip media is wrapped into a File later. */
  file?: File;
  data?: Uint8Array;
  sender?: string;
  date?: string;
  /** HH:MM:SS of the message that carried this image. */
  time?: string;
};

export type Segment = {
  start: string;
  end: string;
  settled: boolean;
  boundaryText: string | null;
  summary: SummaryBlock | null;
  messages: WhatsAppMessage[];
  media: RawMedia[];
};

export type ParsedExport = {
  participants: string[];
  segments: Segment[];
  totalMedia: number;
};

const MESSAGE_RE = /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AaPp][Mm])\]\s*([^:]+?):\s([\s\S]*)$/;

const CLEAR_RE = /\bclear(ed)?\b/i;
const SUMMARY_HEAD_RE = /\(\s*(\d+)\s*members?\s*\)\s*[·\-–—]\s*(\d{4}-\d{2}-\d{2})\s*[·\-–—]\s*(\d{4}-\d{2}-\d{2})/;
const TOTAL_RE = /Total:\s*\$([\d,]+(?:\.\d+)?)/i;
const PAID_RE = /^[\s·]*([A-Za-z][A-Za-z .'’-]*?):\s*paid\s*\$([\d,]+(?:\.\d+)?)\s*·\s*share/i;
const SYSTEM_PREFIXES = ["Messages and calls are end-to-end encrypted", "This message was deleted", " joined using this group", " left", " changed the subject", " created group"];
const OMITTED_RE = /<(image|video|album message|document)[^>]*omitted[^>]*>/gi;

function toIso(month: string, day: string, year: string): string {
  const y = year.length === 2 ? `20${year}` : year;
  return `${y}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function isMediaName(name: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(name);
}

function cleanText(raw: string): string {
  // iOS exports sprinkle left-to-right marks everywhere.
  return raw.replace(/\u200e/g, "").trim();
}

function isSystemLine(text: string): boolean {
  return SYSTEM_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function parseSummaryBlock(text: string): SummaryBlock | null {
  const head = text.match(SUMMARY_HEAD_RE);
  if (!head) return null;
  const totalMatch = text.match(TOTAL_RE);
  if (!totalMatch) return null;
  const paid: { name: string; amount: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const paidMatch = line.match(PAID_RE);
    if (paidMatch) {
      paid.push({ name: paidMatch[1].trim(), amount: Number(paidMatch[2].replace(/,/g, "")) });
    }
  }
  if (!paid.length) return null;
  return {
    rangeStart: head[2],
    rangeEnd: head[3],
    total: Number(totalMatch[1].replace(/,/g, "")),
    paid,
  };
}

export function parseChatMessages(text: string): WhatsAppMessage[] {
  // Different phones export different date orders (9/19/26 M/D vs 20/4/2026
  // D/M). Vote across every matched line: a component above 12 can only be a
  // day, which settles the order for the whole file.
  const matches: Array<RegExpMatchArray> = [];
  let dayFirst = false;
  let decided = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = cleanText(rawLine);
    if (!line) continue;
    const match = line.match(MESSAGE_RE);
    if (!match) continue;
    if (!decided) {
      const a = Number(match[1]);
      const b = Number(match[2]);
      if (a > 12) { dayFirst = true; decided = true; }
      else if (b > 12) { dayFirst = false; decided = true; }
      else if (matches.length > 60) decided = true;
    }
    matches.push(match);
  }

  const messages: WhatsAppMessage[] = [];
  let last: WhatsAppMessage | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = cleanText(rawLine);
    if (!line) continue;
    const match = line.match(MESSAGE_RE);
    if (!match) {
      // Continuation of a multi-line message.
      if (last) last.text += `\n${line}`;
      continue;
    }
    const [, a, b, y, hh, mm, ss, ampm, sender, body] = match;
    const month = dayFirst ? b : a;
    const day = dayFirst ? a : b;
    let hour = Number(hh) % 12;
    if (/p/i.test(ampm)) hour += 12;
    const clean = cleanText(body);
    if (isSystemLine(clean)) { last = null; continue; }
    last = {
      date: toIso(String(month), String(day), y),
      time: `${String(hour).padStart(2, "0")}:${mm}:${ss}`,
      sender: sender.trim(),
      text: clean,
    };
    messages.push(last);
  }
  return messages;
}

function buildSegments(messages: WhatsAppMessage[]): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;

  for (const message of messages) {
    if (!current) {
      current = { start: message.date, end: message.date, settled: false, boundaryText: null, summary: null, messages: [], media: [] };
    }
    current.end = message.date;
    current.messages.push(message);

    // A short "clear" message marks the end of a settled period.
    if (CLEAR_RE.test(message.text) && message.text.length < 80) {
      current.settled = true;
      current.boundaryText = message.text;
      current.end = message.date;
      // The pasted summary lives somewhere earlier in this segment — walk back.
      for (let i = current.messages.length - 2; i >= 0; i--) {
        const summary = parseSummaryBlock(current.messages[i].text);
        if (summary) {
          current.summary = summary;
          current.start = summary.rangeStart;
          current.end = summary.rangeEnd;
          break;
        }
      }
      segments.push(current);
      current = null;
    }
  }
  if (current) segments.push(current);
  return segments;
}

/** Shared pipeline for zip bytes and extracted folders. */
export function parseExport(chatText: string, mediaFiles: RawMedia[]): ParsedExport {
  const messages = parseChatMessages(chatText);
  if (!messages.length) throw new Error("No messages could be parsed from chat.txt.");

  // Attribute media to senders: every omitted-media mention consumes the next
  // unclaimed media file (WhatsApp orders files chronologically in both).
  const mediaByName = new Map(mediaFiles.map((file) => [file.name.replace(/^.*\//, ""), file]));
  const sortedNames = [...mediaByName.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const stamped: RawMedia[] = mediaFiles.map((file) => ({ ...file }));
  let cursor = 0;
  for (const message of messages) {
    const mentions = (message.text.match(OMITTED_RE) ?? []).length;
    for (let i = 0; i < mentions; i++) {
      const name = sortedNames[cursor++];
      if (!name) break;
      const file = stamped.find((f) => f.name.replace(/^.*\//, "") === name);
      if (file && !file.sender) {
        file.sender = message.sender;
        file.date = message.date;
      }
    }
  }

  const participants = [...new Set(messages.map((message) => message.sender))].filter((name) => name !== "You");
  const segments = buildSegments(messages);

  for (const file of stamped) {
    const segment =
      segments.find((s) => (file.date ?? "") >= s.start && (file.date ?? "") <= s.end) ?? segments[segments.length - 1];
    if (segment) segment.media.push(file);
  }

  return { participants, segments, totalMedia: stamped.length };
}

/** WhatsApp exports are UTF-8 without media but often UTF-16 with media —
 *  detect the encoding from the BOM or null-byte pattern before decoding. */
function decodeChatFile(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.slice(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.slice(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.slice(3));
  let nulls = 0;
  for (let i = 0; i < Math.min(bytes.length, 400); i++) if (bytes[i] === 0) nulls++;
  if (nulls > 20) return new TextDecoder("utf-16le").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

/** Zip source: chat.txt + media files straight from the archive. */
export function parseWhatsAppZip(zipData: Uint8Array): ParsedExport {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipData);
  } catch {
    throw new Error("That file is not a readable zip archive.");
  }
  const chatName = Object.keys(entries).find((name) => /_chat\.txt$/i.test(name) || /^chat\.txt$/i.test(name));
  if (!chatName) {
    throw new Error("No chat.txt found — export the chat from WhatsApp (with or without media) and try again.");
  }
  const chatText = decodeChatFile(entries[chatName]);
  const mediaFiles: RawMedia[] = Object.entries(entries)
    .filter(([name]) => name !== chatName && isMediaName(name))
    .map(([name, data]) => ({
      name,
      file: new File([data.slice().buffer as ArrayBuffer], name.replace(/^.*\//, ""), {
        type: name.endsWith(".png") ? "image/png" : "image/jpeg",
      }),
    }));
  return parseExport(chatText, mediaFiles);
}

/** Extracted-folder source: a flat File list containing chat.txt + media. */
export async function parseWhatsAppFolder(files: File[]): Promise<ParsedExport> {
  const chatFile = files.find((file) => /_chat\.txt$/i.test(file.name) || /^chat\.txt$/i.test(file.name));
  if (!chatFile) throw new Error("No chat.txt in that folder — select the whole exported folder.");
  const chatText = await chatFile.text();
  return parseExport(
    chatText,
    files.filter((file) => file !== chatFile && isMediaName(file.name)).map((file) => ({ name: file.name, file })),
  );
}
