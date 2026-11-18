import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRightLeft, CalendarDays, CircleDollarSign, FileImage, Fingerprint, Hash, Layers3, RefreshCw, ShieldCheck, Store, Tag, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { GlassButton } from "@zakisheriff/liquid-glass";
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

  useEffect(() => {
    let cancelled = false;
    setImageUrl("");
    setError("");
    createEvidenceSignedUrl(evidence.locator)
      .then((url) => { if (!cancelled) setImageUrl(url); })
      .catch(() => { if (!cancelled) setError("We couldn’t open this private image."); });
    return () => { cancelled = true; };
  }, [evidence.locator, loadAttempt]);

  return (
    <div className="screen screen--evidence-detail">
      <GlassButton
        className="evidence-floating-back"
        variant="clear"
        size="md"
        intensity={5}
        icon={<ArrowLeft aria-hidden="true" />}
        type="button"
        onClick={onBack}
        aria-label={`Back to ${evidence.kind === "Receipt" ? "receipts" : "settlement"}`}
      />

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
