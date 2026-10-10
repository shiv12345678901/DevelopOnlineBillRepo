import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRightLeft, CalendarDays, CircleDollarSign, FileImage, Fingerprint, Hash, Layers3, RefreshCw, ShieldCheck, Store, Tag, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createEvidenceSignedUrl } from "../api";

export type EvidenceDetails = {
  locator: string;
  kind: "Receipt" | "Bank transfer";
  title: string;
  subtitle: string;
  amount: string;
  facts: Array<{ label: string; value: string }>;
};

const factIcons: Record<string, LucideIcon> = {
  Merchant: Store,
  Amount: CircleDollarSign,
  "Paid by": UserRound,
  Date: CalendarDays,
  Category: Tag,
  "Receipt ID": Fingerprint,
  From: UserRound,
  To: UserRound,
  "Transfer date": CalendarDays,
  Settlement: Layers3,
  "Step ID": Hash,
  "Transfer ID": Fingerprint,
};

export function EvidenceDetailPage({ evidence, onBack }: { evidence: EvidenceDetails; onBack: () => void }) {
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const swipeStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const swipeDistance = useRef(0);
  const backTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImageUrl("");
    setError("");
    createEvidenceSignedUrl(evidence.locator)
      .then((url) => { if (!cancelled) setImageUrl(url); })
      .catch(() => { if (!cancelled) setError("We couldn’t open this private image."); });
    return () => { cancelled = true; };
  }, [evidence.locator, loadAttempt]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onBack();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  useEffect(() => () => {
    if (backTimer.current !== null) window.clearTimeout(backTimer.current);
  }, []);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" || event.clientX > 32) return;
    swipeStart.current = { x: event.clientX, y: event.clientY, time: performance.now() };
    swipeDistance.current = 0;
    setSwiping(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!swipeStart.current) return;
    const distanceX = Math.max(0, event.clientX - swipeStart.current.x);
    const distanceY = Math.abs(event.clientY - swipeStart.current.y);
    if (distanceY > distanceX && distanceY > 12) {
      swipeStart.current = null;
      swipeDistance.current = 0;
      setSwipeX(0);
      setSwiping(false);
      return;
    }
    swipeDistance.current = Math.min(distanceX, window.innerWidth);
    setSwipeX(swipeDistance.current);
  }

  function finishSwipe(event: React.PointerEvent<HTMLDivElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;

    const elapsed = Math.max(performance.now() - start.time, 1);
    const distance = swipeDistance.current;
    const velocity = distance / elapsed;
    const shouldGoBack = distance >= Math.min(120, window.innerWidth * 0.3) || (distance > 48 && velocity > 0.45);
    setSwiping(false);
    if (!shouldGoBack) {
      setSwipeX(0);
      return;
    }

    setSwipeX(window.innerWidth);
    backTimer.current = window.setTimeout(onBack, 180);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function cancelSwipe() {
    swipeStart.current = null;
    swipeDistance.current = 0;
    setSwiping(false);
    setSwipeX(0);
  }

  return (
    <div
      className={`screen screen--evidence-detail${swiping ? " is-swiping" : ""}`}
      style={{ "--swipe-x": `${swipeX}px` } as React.CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishSwipe}
      onPointerCancel={cancelSwipe}
    >
      <button
        className="evidence-floating-back"
        type="button"
        onClick={onBack}
        aria-label={`Back to ${evidence.kind === "Receipt" ? "receipts" : "settlement"}`}
      >
        <ArrowLeft aria-hidden="true" />
        <span>Back</span>
      </button>

      <section className="evidence-detail-hero" aria-labelledby="evidence-title">
        <div>
          <p>{evidence.subtitle}</p>
          <h1 id="evidence-title">{evidence.title}</h1>
        </div>
        <strong>{evidence.amount}</strong>
      </section>

      <section className="content-section evidence-photo-section" aria-labelledby="evidence-image-heading">
        <div className="section-heading compact"><h2 id="evidence-image-heading">Original image</h2><span className="evidence-private-label"><ShieldCheck aria-hidden="true" /> Private</span></div>
        <div className="evidence-image-frame">
          {imageUrl ? <img src={imageUrl} alt={`${evidence.title} ${evidence.kind.toLocaleLowerCase()}`} /> : error ? <div className="evidence-state evidence-state--error"><FileImage aria-hidden="true" /><p>{error}</p><button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}><RefreshCw aria-hidden="true" /> Try again</button></div> : <div className="evidence-state"><span className="spinner" aria-hidden="true" /><p>Opening image…</p></div>}
        </div>
      </section>

      <section className="content-section" aria-labelledby="evidence-details-heading">
        <div className="section-heading compact"><h2 id="evidence-details-heading">{evidence.kind === "Receipt" ? "OCR details" : "Transfer details"}</h2></div>
        <dl className="evidence-facts">
          {evidence.facts.map((fact) => { const Icon = factIcons[fact.label] || ArrowRightLeft; const iconTone = fact.label.toLocaleLowerCase().replaceAll(" ", "-"); return <div key={fact.label}><dt><span className={`evidence-fact-icon evidence-fact-icon--${iconTone}`} aria-hidden="true"><Icon /></span>{fact.label}</dt><dd>{fact.value}</dd></div>; })}
        </dl>
      </section>
    </div>
  );
}
