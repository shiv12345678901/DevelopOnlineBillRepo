import { useEffect, useRef, useState } from "react";
import { Calculator, Check, ChevronRight, ClipboardCopy, RefreshCw, X } from "lucide-react";
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
import { IosSheet } from "./IosSheet";

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
  const [adminAccess, setAdminAccess] = useState(false);
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
    let cancelled = false;
    setAdminAccess(false);
    if (!MEMBERSHIP_FEATURE_ENABLED || !period?.id) return () => { cancelled = true; };
    void fetchSettlementCycleMembershipPermissions(period.id)
      .then((permissions) => {
        if (!cancelled) setAdminAccess(permissions.can_edit || permissions.can_review_disabled_receipts);
      })
      .catch(() => {
        if (!cancelled) setAdminAccess(false);
      });
    return () => { cancelled = true; };
  }, [period?.id]);

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
        if (!permissions.can_view || (!permissions.can_edit && !permissions.can_review_disabled_receipts)) throw new Error("UNAUTHORIZED_MEMBERSHIP_ACCESS");
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

  if (!adminAccess) return null;

  return <>
    <li className="settings-action-row copy-calculation-row">
      <button className="settings-action-button" type="button" onClick={showSheet} disabled={!MEMBERSHIP_FEATURE_ENABLED || !period}>
        <span className="settings-icon tile-blue" aria-hidden="true"><Calculator /></span>
        <span className="settings-copy"><span className="settings-title">Copy Calculation</span><span className="settings-subtitle">{MEMBERSHIP_FEATURE_ENABLED ? "WhatsApp-ready expense breakdown" : "Available after membership backend deployment"}</span></span>
        <ChevronRight aria-hidden="true" />
      </button>
    </li>
    <IosSheet open={open} onClose={() => { if (!copying) setOpen(false); }} label="Copy calculation" className="copy-calculation-modal">
      <section className="copy-calculation-sheet" aria-labelledby="copy-calculation-title">
        <header className="copy-calculation-header">
          <div className="copy-calculation-heading">
            <span className="copy-calculation-icon" aria-hidden="true"><Calculator /></span>
            <div><h2 id="copy-calculation-title">Copy Calculation</h2>{period && <p>{formatDate(period.start_date)} – {period.status === "CURRENT" ? "Today" : formatDate(period.end_date)}</p>}</div>
          </div>
          <button className="copy-calculation-close" type="button" aria-label="Close calculation" onClick={() => setOpen(false)} disabled={copying}><X /></button>
        </header>

        <div className="copy-calculation-body">
          {loading && <div className="copy-calculation-state" role="status"><span className="status-spinner" aria-hidden="true" /><strong>Preparing calculation</strong></div>}
          {error && <div className="copy-calculation-state error" role="alert"><p>{error}</p><button className="ios-secondary-button" type="button" onClick={() => void loadCalculation()}><RefreshCw />Try again</button></div>}
          {membership && preview && calculation && <>
            <section className="copy-calculation-overview" aria-label="Calculation summary">
              <div className="copy-calculation-total"><span>Eligible total</span><strong>{fmt(preview.total_cents)}</strong></div>
              <dl>
                <div><dt>Equal share</dt><dd>{fmt(preview.equal_share_cents)}</dd></div>
                <div><dt>Participants</dt><dd>{calculation.enabledCount}</dd></div>
                <div><dt>Receipts</dt><dd>{calculation.receiptCount}</dd></div>
              </dl>
            </section>

            <section className="copy-calculation-section" aria-labelledby="copy-members-heading">
              <h3 id="copy-members-heading">Settlement members</h3>
              <ul className="copy-calculation-members">{membership.members.filter((member) => member.participation_mode !== "disabled").map((member) => (
                <li className={`mode-${member.participation_mode}`} key={member.member_name}>
                  <span>{member.member_name.split(" ")[0]}</span><strong>{modeLabel(member.participation_mode)}</strong>
                </li>
              ))}</ul>
            </section>

            <section className="copy-calculation-section copy-calculation-preview-card" aria-labelledby="copy-preview-heading">
              <div className="copy-calculation-section-title"><h3 id="copy-preview-heading">Message preview</h3><span>Plain text</span></div>
              <pre className="copy-calculation-preview" tabIndex={0} aria-label="Calculation text">{calculation.text}</pre>
            </section>
          </>}
        </div>

        {calculation && <footer className="copy-calculation-footer">
          <p className={`copy-calculation-status${copyStatus === "Calculation copied!" ? " success" : ""}`} aria-live="polite">{copyStatus === "Calculation copied!" && <Check aria-hidden="true" />}{copyStatus || "Ready to paste into WhatsApp"}</p>
          <button className="ios-primary-button copy-calculation-action" type="button" disabled={copying} onClick={() => void copyCalculation()}>{copyStatus === "Calculation copied!" ? <Check /> : <ClipboardCopy />}{copying ? "Copying…" : copyStatus === "Calculation copied!" ? "Copied" : "Copy Calculation"}</button>
        </footer>}
      </section>
    </IosSheet>
  </>;
}
