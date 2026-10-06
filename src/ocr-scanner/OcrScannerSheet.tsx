import { useRef, useState } from "react";
import { useSheetGesture, Icon } from "../App";
import { scanReceipt, resizeImage, type ScanRead } from "../api";

type ScanState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; read: ScanRead; ms: number }
  | { phase: "error"; message: string };

/** Test bench for the Australian receipt auditor: pick a receipt or bank
 *  screenshot, run the structured Gemini classification, and inspect the
 *  full verdict. Kept fully separate from the app's Gemini pipeline so the
 *  two can be compared before swapping it in. */
export default function OcrScannerSheet({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<ScanState>({ phase: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { sheetRef, dismiss, dragProps } = useSheetGesture(onClose);

  const run = async () => {
    if (!file) return;
    setState({ phase: "running" });
    try {
      const image = await resizeImage(file, 1600, 0.9);
      const started = performance.now();
      const read = await scanReceipt(image.imageBase64, image.mimeType);
      setState({ phase: "done", read, ms: Math.round(performance.now() - started) });
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
            <h2>Gemini receipt auditor</h2>
          </div>
          <button className="icon-button receipt-sheet-close" onClick={onClose} aria-label="Close scanner test"><Icon name="close" size={18} /></button>
        </div>

        <div className="form-stack">
          <p className="ocr-test-note">
            Classifies the image as a valid retail expense or a flatmate bank
            transfer, and grades the read quality. Runs on the server with your
            Gemini keys — nothing is stored.
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
            {file ? `Image: ${file.name.length > 28 ? `${file.name.slice(0, 25)}…` : file.name}` : "Choose a receipt or screenshot"}
          </button>

          <button className="tinted-button" disabled={!file || state.phase === "running"} onClick={() => void run()}>
            {state.phase === "running" ? "Auditing…" : "Run auditor"}
          </button>

          {state.phase === "running" && <p className="ocr-test-note">Reading the image with Gemini…</p>}

          {state.phase === "error" && (
            <div className="settings-list"><div className="insight-row"><span className="ocr-error">{state.message}</span></div></div>
          )}

          {state.phase === "done" && (
            <>
              <div className="settings-list">
                <div className="insight-row">
                  <span className={`row-icon ${state.read.isBankTransfer ? "row-icon-gray" : "row-icon-green"}`}>
                    <Icon name={state.read.isBankTransfer ? "close" : "check"} size={15} />
                  </span>
                  <div className="insight-copy">
                    <strong>{state.read.isBankTransfer ? "Bank transfer — filtered out" : "Valid expense"}</strong>
                    <i>{state.read.category}</i>
                  </div>
                </div>
                <div className="insight-row">
                  <span className="row-icon row-icon-orange"><Icon name="receipt" size={15} /></span>
                  <div className="insight-copy"><strong>Merchant</strong><i>{state.read.isBlurry ? "Image looks blurry" : "Read looks clean"}</i></div>
                  <span className="insight-value">{state.read.merchant}</span>
                </div>
                <div className="insight-row">
                  <span className="row-icon row-icon-blue"><Icon name="settle" size={15} /></span>
                  <div className="insight-copy"><strong>Amount</strong><i>confidence: {state.read.confidence}</i></div>
                  <span className="insight-value">${state.read.amount.toFixed(2)}</span>
                </div>
              </div>
              <p className="ocr-test-note">Model: {state.read.model ?? "gemini"} · {state.ms} ms round-trip</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
