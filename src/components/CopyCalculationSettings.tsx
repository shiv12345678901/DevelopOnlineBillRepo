import { useEffect, useRef, useState } from "react";
import { Calculator, Check, ChevronRight, ClipboardCopy, RefreshCw, X } from "lucide-react";
import { GlassButton, GlassSheet } from "@zakisheriff/liquid-glass";
import {
  fetchAllEligibleReceiptsForPeriod,
  fetchEffectiveReceiptVisibility,
  fetchSettlementCycleMembership,
  fetchSettlementCycleMembershipPermissions,
  fetchSettlementCyclePreview,
  fmt,
  type Period,
  type SettlementCycleMembership,
  type SettlementCyclePreview,
} from "../api";
import { CopyCalculationError, generateCopyCalculation, writeCalculationText, type CalculationResult } from "../copyCalculation";
import { MEMBERSHIP_FEATURE_ENABLED, modeLabel, permissionsMatch } from "../membership";
import { formatDate } from "./format";

function fallbackCopy(text: string) {
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  return copied;
}

function calculationErrorMessage(error: unknown) {
  if (error instanceof CopyCalculationError) {
    if (error.code === "STALE_REVISION") return "Membership changed while loading. Refresh and try again.";
    if (error.code === "DISABLED_RECEIPT_VISIBLE") return "Receipt visibility is still updating. Refresh or sync before copying.";
    if (error.code === "TOTAL_MISMATCH" || error.code === "MEMBER_MISMATCH") return "Receipt totals do not match the authoritative financial preview. Refresh or sync before copying.";
    return "Some receipt data is incomplete. Refresh or sync before copying.";
  }
  return "The calculation could not be loaded. Check your connection and try again.";
}

export function CopyCalculationSettings({ period }: { period: Period | undefined }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [membership, setMembership] = useState<SettlementCycleMembership | null>(null);
  const [preview, setPreview] = useState<SettlementCyclePreview | null>(null);
  const [calculation, setCalculation] = useState<CalculationResult | null>(null);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    setOpen(false);
    setMembership(null);
    setPreview(null);
    setCalculation(null);
  }, [period?.id]);

  async function loadCalculation() {
    if (!MEMBERSHIP_FEATURE_ENABLED || !period?.id || loading) return;
    const generation = ++generationRef.current;
    setLoading(true);
    setError("");
    setCopyStatus("");
    setMembership(null);
    setPreview(null);
    setCalculation(null);
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const permissions = await fetchSettlementCycleMembershipPermissions(period.id);
        if (!permissions.can_view) throw new Error("UNAUTHORIZED_MEMBERSHIP_ACCESS");
        const firstMembership = await fetchSettlementCycleMembership(period.id);
        const [receipts, visibility, nextPreview] = await Promise.all([
          fetchAllEligibleReceiptsForPeriod(period.id),
          fetchEffectiveReceiptVisibility(period.id),
          fetchSettlementCyclePreview(period.id),
        ]);
        const finalMembership = await fetchSettlementCycleMembership(period.id);
        if (generation !== generationRef.current || period.id !== finalMembership.period_id) return;
        const consistent = firstMembership.revision === finalMembership.revision
          && finalMembership.revision === nextPreview.revision
          && nextPreview.period_id === period.id
          && permissionsMatch(permissions, firstMembership.permissions, finalMembership.permissions, nextPreview.permissions);
        if (!consistent) {
          if (attempt === 0) continue;
          throw new CopyCalculationError("STALE_REVISION", "Membership changed during calculation loading.");
        }
        const eligibleReceiptIds = new Set(visibility
          .filter((receipt) => receipt.visible && receipt.eligible && !receipt.manually_excluded)
          .map((receipt) => receipt.receipt_id));
        const nextCalculation = generateCopyCalculation(
          receipts.filter((receipt) => eligibleReceiptIds.has(receipt.id)),
          finalMembership,
          nextPreview,
        );
        setMembership(finalMembership);
        setPreview(nextPreview);
        setCalculation(nextCalculation);
        return;
      }
    } catch (loadError) {
      if (generation === generationRef.current) setError(calculationErrorMessage(loadError));
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }

  function showSheet() {
    setOpen(true);
    void loadCalculation();
  }

  async function copyCalculation() {
    if (!calculation || copying) return;
    setCopying(true);
    setCopyStatus("");
    try {
      await writeCalculationText(calculation.text, navigator.clipboard, fallbackCopy);
      setCopyStatus("Calculation copied!");
    } catch {
      setCopyStatus("Copy failed. Select the calculation text and copy it manually.");
    } finally {
      setCopying(false);
    }
  }

  return <>
    <li className="settings-row copy-calculation-row">
      <button type="button" onClick={showSheet} disabled={!MEMBERSHIP_FEATURE_ENABLED || !period}>
        <span className="settings-icon tile-blue" aria-hidden="true"><Calculator /></span>
        <span className="settings-copy"><span className="settings-title">Copy Calculation</span><span className="settings-subtitle">{MEMBERSHIP_FEATURE_ENABLED ? "Copy detailed household expense breakdown" : "Available after membership backend deployment"}</span></span>
        <ChevronRight aria-hidden="true" />
      </button>
    </li>
    <GlassSheet open={open} onClose={() => !copying && setOpen(false)} intensity={6} aria-label="Copy calculation">
      <section className="copy-calculation-sheet" aria-labelledby="copy-calculation-title">
        <header><div><span>Selected settlement</span><h2 id="copy-calculation-title">Copy Calculation</h2>{period && <p>{formatDate(period.start_date)} – {period.status === "CURRENT" ? "Today" : formatDate(period.end_date)}</p>}</div><button type="button" aria-label="Close calculation" onClick={() => setOpen(false)}><X /></button></header>
        {loading && <div className="copy-calculation-state" role="status"><span className="status-spinner" aria-hidden="true" />Preparing calculation…</div>}
        {error && <div className="copy-calculation-state error" role="alert"><p>{error}</p><GlassButton type="button" variant="tinted" icon={<RefreshCw />} onClick={() => void loadCalculation()}>Retry</GlassButton></div>}
        {membership && preview && calculation && <>
          <div className="copy-calculation-members" aria-label="Membership configuration">{membership.members.map((member) => <span className={`mode-${member.participation_mode}`} key={member.member_name}>{member.member_name.split(" ")[0]} · {modeLabel(member.participation_mode)}</span>)}</div>
          <div className="copy-calculation-summary"><div><span>Eligible total</span><strong>{fmt(preview.total_cents)}</strong></div><div><span>Equal share</span><strong>{fmt(preview.equal_share_cents)}</strong></div><div><span>Participants</span><strong>{calculation.enabledCount}</strong></div><div><span>Receipts</span><strong>{calculation.receiptCount}</strong></div></div>
          <div className="copy-balance-list">{preview.members.map((member) => <div key={member.member_name}><span>{member.member_name.split(" ")[0]}</span><small>{member.participation_mode === "disabled" ? "Excluded" : `Paid ${fmt(member.paid_cents)} · Share ${fmt(member.share_cents)}`}</small><strong>{member.participation_mode === "disabled" ? "—" : `${member.net_cents >= 0 ? "+" : "−"}${fmt(Math.abs(member.net_cents))}`}</strong></div>)}</div>
          <textarea className="copy-calculation-preview" aria-label="Calculation text" readOnly value={calculation.text} />
          {copyStatus && <p className={`copy-calculation-status${copyStatus === "Calculation copied!" ? " success" : ""}`} role="status">{copyStatus === "Calculation copied!" && <Check aria-hidden="true" />}{copyStatus}</p>}
          <GlassButton className="copy-calculation-action" type="button" variant="filled" size="lg" icon={<ClipboardCopy />} disabled={copying} onClick={() => void copyCalculation()}>{copying ? "Copying…" : "Copy Calculation"}</GlassButton>
        </>}
      </section>
    </GlassSheet>
  </>;
}
