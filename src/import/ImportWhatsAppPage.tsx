import { useMemo, useRef, useState } from "react";
import { useEdgeSwipeBack, Icon } from "../App";
import { resizeImage, scanReceipt, uploadImportedMedia, confidenceScore } from "../api";
import {
  parseWhatsAppZip,
  parseWhatsAppFolder,
  type ParsedExport,
  type Segment,
} from "./whatsapp";
import {
  loadImportState,
  saveImportState,
  mediaFingerprint,
  canonicalName,
  type ImportState,
} from "./import-state";

export type ImportedEntry = { payer: string; amount: number; merchant: string; spentOn: string; note: string; savedName?: string; imagePath?: string };
export type SegmentImport = { name: string; members: string[]; startsOn: string; endsOn: string | null; entries: ImportedEntry[] };

type ReviewItem = {
  fingerprint: string;
  savedName: string;
  payer: string;
  date: string;
  file: File;
  reason: string;
  extractedAmount: number;
  importAmount: number | null;
};

type AcceptedItem = {
  fingerprint: string;
  savedName: string;
  payer: string;
  amount: number;
  merchant: string;
  spentOn: string;
  file: File;
};

const firstName = (name: string) => name.split(/\s+/)[0].toLowerCase();

function autoMap(names: string[], members: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const name of names) {
    const hit = members.find((member) => firstName(member).startsWith(firstName(name)) || firstName(name).startsWith(firstName(member)));
    map[name] = hit ?? members[0] ?? "";
  }
  return map;
}

function money(value: number): string {
  return `$${value.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function segmentKey(segment: Segment): string {
  return segment.summary?.rangeEnd ?? `${segment.start}_${segment.end}`;
}

export default function ImportWhatsAppPage({ members, activeCycleName, onClose, onImportSegment, onImportExpenses, onEnsureChatCycle, onImportMediaEntry }: {
  members: string[];
  activeCycleName: string;
  onClose: () => void;
  onImportSegment: (segment: SegmentImport) => Promise<boolean>;
  onImportExpenses: (expenses: ImportedEntry[]) => Promise<boolean>;
  onEnsureChatCycle: (startsOn: string, name: string) => Promise<string | null>;
  onImportMediaEntry: (cycleId: string, entry: ImportedEntry, savedName: string, file: File) => Promise<boolean>;
}) {
  const swipe = useEdgeSwipeBack(onClose);
  const [parsed, setParsed] = useState<ParsedExport | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [importedKeys, setImportedKeys] = useState<string[]>([]);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [accepted, setAccepted] = useState<AcceptedItem[]>([]);
  const [importing, setImporting] = useState(false);
  const importStateRef = useRef<ImportState>(loadImportState());
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const persistState = () => saveImportState(importStateRef.current);

  const collectNames = (result: ParsedExport): string[] => {
    const names = new Set<string>();
    for (const segment of result.segments) {
      segment.messages.forEach((message) => names.add(message.sender));
      segment.summary?.paid.forEach((paid) => names.add(paid.name));
    }
    return [...names].filter((name) => name !== "You");
  };

  const handleZip = async (file: File) => {
    setError("");
    setParsed(null);
    setReview([]);
    setAccepted([]);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const result = parseWhatsAppZip(buffer);
      setParsed(result);
      setMapping(autoMap(collectNames(result), members));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that export.");
    }
  };

  const handleFolder = async (files: File[]) => {
    setError("");
    setParsed(null);
    setReview([]);
    setAccepted([]);
    try {
      const result = await parseWhatsAppFolder(files);
      setParsed(result);
      setMapping(autoMap(collectNames(result), members));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that folder.");
    }
  };

  const settledSegments = useMemo(
    () => (parsed ? parsed.segments.filter((segment) => segment.settled && segment.summary) : []),
    [parsed],
  );
  const liveSegment = useMemo(
    () => (parsed ? parsed.segments.find((segment) => !segment.settled) ?? null : null),
    [parsed],
  );

  const isAlreadyImported = (segment: Segment): boolean => {
    const key = segmentKey(segment);
    return importedKeys.includes(key) || Boolean(importStateRef.current.segments[key]);
  };

  /** Settled periods -> closed cycles with one settlement entry per member. */
  const importSettled = async (segment: Segment) => {
    if (!segment.summary) return;
    const entries: ImportedEntry[] = segment.summary.paid
      .map((paid) => ({
        payer: mapping[paid.name] ?? members[0],
        amount: paid.amount,
        merchant: "WhatsApp settlement import",
        spentOn: segment.end,
        note: `Imported from chat — ${segment.start} to ${segment.end}`,
      }))
      .filter((entry) => entry.payer && entry.amount > 0);
    const ok = await onImportSegment({
      name: `Grocery ${shortDate(segment.summary.rangeStart)} – ${shortDate(segment.summary.rangeEnd)}`,
      members: members.length ? members : [...new Set(entries.map((entry) => entry.payer))],
      startsOn: segment.summary.rangeStart,
      endsOn: segment.summary.rangeEnd,
      entries,
    });
    if (ok) {
      const state = importStateRef.current;
      state.segments[segmentKey(segment)] = { cycleId: "", rangeStart: segment.summary.rangeStart, rangeEnd: segment.summary.rangeEnd };
      persistState();
      setImportedKeys((current) => [...current, segmentKey(segment)]);
    }
  };

  /** Scan every never-processed image in the live segment through the auditor. */
  const scanLiveMedia = async (segment: Segment) => {
    const state = importStateRef.current;
    const fresh = segment.media.filter((file) => {
      const fp = mediaFingerprint(file.name.replace(/^.*\//, ""), file.data?.length ?? file.file?.size ?? 0, file.sender);
      return !state.media[fp];
    });
    if (!fresh.length) {
      setError("Every image in this export has already been processed.");
      return;
    }

    setScanProgress({ done: 0, total: fresh.length });
    const newReview: ReviewItem[] = [];
    const newAccepted: AcceptedItem[] = [];
    const seqBySecond = new Map<string, number>();

    for (const file of fresh) {
      const sender = file.sender ?? "Unknown";
      const date = file.date ?? "";
      const time = file.time ?? "";
      const fp = mediaFingerprint(file.name.replace(/^.*\//, ""), file.data?.length ?? file.file?.size ?? 0, sender);
      const blob = file.file ?? new File([file.data!.slice().buffer as ArrayBuffer], file.name, { type: file.name.endsWith(".png") ? "image/png" : "image/jpeg" });
      try {
        const image = await resizeImage(blob, 1600, 0.9);
        const read = await scanReceipt(image.imageBase64, image.mimeType);
        const secondKey = `${sender}${date}${time}`;
        const seq = (seqBySecond.get(secondKey) ?? 0) + 1;
        seqBySecond.set(secondKey, seq);
        const savedName = canonicalName(mapping[sender] ?? sender, date, time, file.name, seq);
        const payer = mapping[sender] ?? members[0] ?? "";

        if (read.isBankTransfer || !(read.amount > 0)) {
          // Personal transfer or unreadable: needs a human decision.
          newReview.push({
            fingerprint: fp,
            savedName,
            payer,
            date,
            file: blob,
            reason: read.isBankTransfer ? "Looks like a personal transfer" : "No receipt total found",
            extractedAmount: read.amount,
            importAmount: read.amount > 0 ? read.amount : null,
          });
        } else {
          newAccepted.push({
            fingerprint: fp,
            savedName,
            payer,
            amount: read.amount,
            merchant: read.merchant || "Receipt",
            spentOn: date,
            file: blob,
          });
          state.media[fp] = { status: "imported", savedName };
          persistState();
        }
      } catch {
        newReview.push({
          fingerprint: fp,
          savedName: file.name,
          payer: mapping[sender] ?? sender,
          date,
          file: blob,
          reason: "OCR failed on this image",
          extractedAmount: 0,
          importAmount: null,
        });
      }
      setScanProgress({ done: newAccepted.length + newReview.length, total: fresh.length });
      setReview([...newReview]);
      setAccepted([...newAccepted]);
    }
    setScanProgress(null);
  };

  const markExcluded = (item: ReviewItem) => {
    const state = importStateRef.current;
    state.media[item.fingerprint] = { status: "excluded", savedName: item.savedName };
    persistState();
    setReview((current) => current.filter((entry) => entry.fingerprint !== item.fingerprint));
  };

  const keepAsReceipt = (item: ReviewItem) => {
    const amount = item.importAmount ?? 0;
    if (!(amount > 0)) return;
    setAccepted((current) => [
      ...current,
      { fingerprint: item.fingerprint, savedName: item.savedName, payer: item.payer, amount, merchant: "Reviewed receipt", spentOn: item.date, file: item.file },
    ]);
    setReview((current) => current.filter((entry) => entry.fingerprint !== item.fingerprint));
  };

  /** Push accepted items into a chat-import cycle: upload originals under
   *  canonical names, then create one entry per image. Idempotent —
   *  fingerprints are marked the moment an entry is written. */
  const importAccepted = async () => {
    if (!accepted.length) return;
    const live = liveSegment;
    if (!live) return;
    setImporting(true);
    try {
      const cycleId = await onEnsureChatCycle(live.start, `Chat ${shortDate(live.start)} – ongoing`);
      if (!cycleId) throw new Error("Could not prepare the import cycle.");
      let importedCount = 0;
      for (const item of accepted) {
        const storagePath = `imported/${item.savedName}`;
        const uploaded = await uploadImportedMedia(
          storagePath,
          item.file,
          item.savedName.endsWith(".png") ? "image/png" : "image/jpeg",
        );
        const entry: ImportedEntry = {
          payer: item.payer,
          amount: item.amount,
          merchant: item.merchant,
          spentOn: item.spentOn,
          note: `Imported from WhatsApp — ${item.savedName}`,
          savedName: item.savedName,
          imagePath: uploaded ? storagePath : undefined,
        };
        const ok = await onImportMediaEntry(cycleId, entry, item.savedName, item.file);
        if (ok) {
          importedCount++;
          const state = importStateRef.current;
          state.media[item.fingerprint] = {
            status: "imported",
            savedName: item.savedName,
            cycleId,
            storagePath: uploaded ? `imported/${item.savedName}` : undefined,
          };
          persistState();
        }
      }
      if (importedCount) {
        setAccepted([]);
        setError("");
      } else {
        setError("Nothing imported — check your connection and try again.");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="install-guide import-page"
      ref={swipe.ref}
      onPointerDown={swipe.onPointerDown}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      onClickCapture={swipe.onClickCapture}
      role="dialog" aria-modal="true" aria-label="Import WhatsApp export"
    >
      <header className="guide-nav">
        <button className="guide-back" onClick={onClose}><Icon name="chevron" size={20} />Settings</button>
        <strong>Import</strong>
        <span className="guide-nav-spacer" aria-hidden="true" />
      </header>
      <div className="guide-body">
        <section className="push-group">
          <p className="settings-group-label">WhatsApp export</p>
          <div className="settings-list">
            <div className="insight-row">
              <span className="row-icon row-icon-green"><Icon name="check" size={15} /></span>
              <div className="insight-copy">
                <strong>Settlements become closed cycles</strong>
                <i>Clear markers split periods; receipt images are scanned, transfers go to review</i>
              </div>
            </div>
            <input ref={fileRef} className="visually-hidden" type="file" accept=".zip,application/zip"
              onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleZip(file); event.target.value = ""; }} />
            <input ref={folderRef} className="visually-hidden" type="file" multiple
              onChange={(event) => { const files = [...(event.target.files ?? [])]; if (files.length) void handleFolder(files); event.target.value = ""; }} />
            <button className="insight-row action-row" onClick={() => fileRef.current?.click()}>
              Choose chat export (.zip)
            </button>
            <button className="insight-row action-row" onClick={() => folderRef.current?.click()}>
              Or choose an extracted folder
            </button>
          </div>
        </section>

        {error && (
          <section className="push-group">
            <div className="settings-list"><div className="insight-row"><span className="ocr-error">{error}</span></div></div>
          </section>
        )}

        {parsed && (
          <>
            <section className="push-group">
              <p className="settings-group-label">Found {parsed.segments.length} period{parsed.segments.length === 1 ? "" : "s"} · {parsed.totalMedia} image{parsed.totalMedia === 1 ? "" : "s"}</p>
              <div className="settings-list">
                {parsed.segments.map((segment, index) => {
                  const already = isAlreadyImported(segment);
                  return (
                    <div className="insight-row" key={segmentKey(segment) + index}>
                      <span className={`row-icon ${segment.settled ? "row-icon-blue" : "row-icon-gray"}`}><Icon name="calendar" size={15} /></span>
                      <div className="insight-copy">
                        <strong>{segment.settled ? "Settled period" : "Live period"} · {shortDate(segment.start)} – {shortDate(segment.end)}</strong>
                        <i>{segment.summary
                          ? `Summary: ${money(segment.summary.total)} across ${segment.summary.paid.length} members`
                          : segment.boundaryText
                            ? `“${segment.boundaryText}”`
                            : `${segment.media.length} images · no clear marker yet`}</i>
                      </div>
                      {already && <span className="settings-row-value">imported</span>}
                    </div>
                  );
                })}
              </div>
            </section>

            {settledSegments.map((segment) => {
              const key = segmentKey(segment);
              if (!isAlreadyImported(segment)) {
                return (
                  <div className="push-group" key={key}>
                    <div className="settings-list">
                      {segment.summary?.paid.map((paid) => (
                        <div className="insight-row" key={paid.name}>
                          <span>{paid.name} →</span>
                          <span className="mapping-select">
                            <select value={mapping[paid.name] ?? members[0] ?? ""} onChange={(event) => setMapping({ ...mapping, [paid.name]: event.target.value })}>
                              {members.map((member) => <option key={member} value={member}>{member}</option>)}
                            </select>
                          </span>
                          <span className="insight-value">{money(paid.amount)}</span>
                        </div>
                      ))}
                      <button className="insight-row action-row" onClick={() => void importSettled(segment)}>
                        Import as closed cycle
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <div className="push-group" key={key}>
                  <div className="settings-list">
                    <div className="insight-row">
                      <span className="row-icon row-icon-green"><Icon name="check" size={15} /></span>
                      <div className="insight-copy"><strong>Settled cycle imported</strong></div>
                    </div>
                  </div>
                </div>
              );
            })}

            {liveSegment && (
              <section className="push-group">
                <p className="settings-group-label">Live period · {shortDate(liveSegment.start)} onwards · {liveSegment.media.length} images</p>
                <div className="settings-list">
                  {scanProgress ? (
                    <div className="insight-row">
                      <div className="insight-copy">
                        <strong>Scanning {scanProgress.done} / {scanProgress.total}…</strong>
                        <i>Gemini reads each image; transfers go to review below</i>
                      </div>
                    </div>
                  ) : review.length === 0 && accepted.length === 0 ? (
                    <button className="insight-row action-row" onClick={() => void scanLiveMedia(liveSegment)}>
                      {liveSegment.media.length ? `Scan ${liveSegment.media.length} new images` : "No images in this export"}
                    </button>
                  ) : null}
                </div>
              </section>
            )}

            {review.length > 0 && (
              <section className="push-group">
                <p className="settings-group-label">Needs review ({review.length}) — excluded items are skipped forever</p>
                <div className="settings-list">
                  {review.map((item) => (
                    <div className="insight-row review-row" key={item.fingerprint}>
                      <div className="insight-copy">
                        <strong>{item.reason}</strong>
                        <i>{item.payer} · {shortDate(item.date)} · {item.savedName.slice(0, 30)}</i>
                      </div>
                      <div className="review-actions">
                        {item.importAmount !== null && item.importAmount > 0 && (
                          <button className="review-keep" onClick={() => keepAsReceipt(item)}>Keep {money(item.importAmount)}</button>
                        )}
                        <button className="review-exclude" onClick={() => markExcluded(item)}>Not a receipt</button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {accepted.length > 0 && (
              <section className="push-group">
                <p className="settings-group-label">Ready to import ({accepted.length})</p>
                <div className="settings-list">
                  {accepted.map((item) => (
                    <div className="insight-row" key={item.fingerprint}>
                      <div className="insight-copy">
                        <strong>{item.merchant} · {item.payer}</strong>
                        <i>{item.savedName.slice(0, 32)}</i>
                      </div>
                      <span className="insight-value">{money(item.amount)}</span>
                    </div>
                  ))}
                  <button className="insight-row action-row" disabled={importing} onClick={() => void importAccepted()}>
                    {importing ? "Importing…" : `Import ${accepted.length} expenses`}
                  </button>
                </div>
              </section>
            )}

            <p className="guide-footnote with-icon">
              <Icon name="refresh" size={15} />
              Already-analysed images and periods are remembered — a new export only processes what is new.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
