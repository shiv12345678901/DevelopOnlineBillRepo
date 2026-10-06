import { useRef, useState } from "react";
import { useSheetGesture } from "../App";
import { Icon } from "../App";
import { paddleScan } from "./paddle";

type ScanState =
  | { phase: "idle" }
  | { phase: "running"; note: string }
  | { phase: "done"; lines: string[]; total: number | null; ms: number }
  | { phase: "error"; message: string };

/** Test bench for the PaddleOCR experiment: pick a receipt, run the
 *  in-browser PP-OCRv2 models, and inspect every line it reads. Kept fully
 *  separate from the app's Gemini pipeline so the two can be compared. */
export default function OcrScannerSheet({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<ScanState>({ phase: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { sheetRef, dismiss, dragProps } = useSheetGesture(onClose);

  const run = async () => {
    if (!file) return;
    setState({ phase: "running", note: "Loading PaddleOCR models (first run downloads them)…" });
    try {
      const scan = await paddleScan(file);
      setState({ phase: "done", lines: scan.lines, total: scan.total, ms: scan.ms });
    } catch (error) {
      setState({ phase: "error", message: error instanceof Error ? error.message : "Scan failed." });
    }
  };

  return (
    <div className="sheet-backdrop receipt-sheet-backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && dismiss()}>
      <div className="bottom-sheet compact-sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label="OCR scanner test">
        <div className="sheet-drag-region" aria-hidden="true" {...dragProps}><div className="sheet-handle" /></div>
        <div className="sheet-header receipt-sheet-header">
          <div>
            <p className="receipt-sheet-context">OCR scanner · experiment</p>
            <h2>PaddleOCR test</h2>
          </div>
          <button className="icon-button receipt-sheet-close" onClick={onClose} aria-label="Close scanner test"><Icon name="close" size={18} /></button>
        </div>

        <div className="form-stack">
          <p className="ocr-test-note">
            Runs PP-OCRv2 fully in this browser — no API key, nothing uploaded. First run downloads the models.
          </p>

          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept="image/*"
            onChange={(event) => {
              const picked = event.target.files?.[0] ?? null;
              setFile(picked);
              setState({ phase: "idle" });
              event.target.value = "";
            }}
          />
          <button className="primary-button ocr-pick" onClick={() => inputRef.current?.click()}>
            {file ? `Image: ${file.name.length > 28 ? `${file.name.slice(0, 25)}…` : file.name}` : "Choose a receipt image"}
          </button>

          <button className="tinted-button" disabled={!file || state.phase === "running"} onClick={() => void run()}>
            {state.phase === "running" ? "Scanning…" : "Run PaddleOCR"}
          </button>

          {state.phase === "running" && <p className="ocr-test-note">{state.note}</p>}

          {state.phase === "error" && (
            <div className="settings-list"><div className="insight-row"><span className="ocr-error">{state.message}</span></div></div>
          )}

          {state.phase === "done" && (
            <>
              <div className="settings-list">
                <div className="insight-row">
                  <span className="row-icon row-icon-green"><Icon name="check" size={15} /></span>
                  <div className="insight-copy"><strong>Parsed total</strong><i>{state.ms} ms in-browser</i></div>
                  <span className="insight-value">{state.total === null ? "None found" : `$${state.total.toFixed(2)}`}</span>
                </div>
              </div>
              <div>
                <span className="member-editor-label">All recognized lines ({state.lines.length})</span>
                <div className="settings-list ocr-lines">
                  {state.lines.length
                    ? state.lines.map((line, index) => <div className="insight-row" key={index}><span className="ocr-line">{line}</span></div>)
                    : <div className="insight-row"><span>No text detected</span></div>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
