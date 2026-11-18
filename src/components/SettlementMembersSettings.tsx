import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleAlert, LockKeyhole, UsersRound } from "lucide-react";
import { GlassButton, GlassSegmented, GlassSheet } from "@zakisheriff/liquid-glass";
import {
  fetchSettlementCycleMembership,
  fetchSettlementCycleMembershipPermissions,
  fetchSettlementCyclePreview,
  fmt,
  memberNameKey,
  setSettlementCycleMemberMode,
  type MembershipPermissions,
  type ParticipationMode,
  type Period,
  type SettlementCycleMembership,
  type SettlementCyclePreview,
} from "../api";
import { MEMBERSHIP_FEATURE_ENABLED, classifyMembershipError, membershipErrorMessage, modeDescription, modeLabel, permissionsMatch } from "../membership";
import { ProfileAvatar } from "./ProfileAvatar";

const MODES: ParticipationMode[] = ["enabled", "keep_receipts", "disabled"];
const MODE_OPTIONS = ["Enabled", "Keep Receipts", "Disabled"];

type PendingChange = { memberName: string; previousMode: ParticipationMode; nextMode: ParticipationMode };

export function SettlementMembersSettings({ period, memberAvatarUrls, onMembershipChanged }: {
  period: Period | undefined;
  memberAvatarUrls: Record<string, string>;
  onMembershipChanged: () => Promise<void>;
}) {
  const [permissions, setPermissions] = useState<MembershipPermissions | null>(null);
  const [membership, setMembership] = useState<SettlementCycleMembership | null>(null);
  const [preview, setPreview] = useState<SettlementCyclePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);

  const load = useCallback(async (preserve = false) => {
    if (!MEMBERSHIP_FEATURE_ENABLED || !period?.id) return;
    if (!preserve) {
      setPermissions(null);
      setMembership(null);
      setPreview(null);
    }
    setLoading(true);
    setMessage("");
    try {
      const nextPermissions = await fetchSettlementCycleMembershipPermissions(period.id);
      setPermissions(nextPermissions);
      if (!nextPermissions.can_view) {
        setMembership(null);
        setPreview(null);
        setMessage("Settlement membership isn’t available for this account.");
        return;
      }
      const [nextMembership, nextPreview] = await Promise.all([
        fetchSettlementCycleMembership(period.id),
        fetchSettlementCyclePreview(period.id),
      ]);
      if (!permissionsMatch(nextPermissions, nextMembership.permissions, nextPreview.permissions) || nextMembership.period_id !== period.id || nextPreview.period_id !== period.id || nextMembership.revision !== nextPreview.revision) {
        throw new Error("Membership responses did not agree.");
      }
      setMembership(nextMembership);
      setPreview(nextPreview);
    } catch (error) {
      const kind = classifyMembershipError(error);
      if (kind === "unauthorized") {
        setPermissions({ can_view: false, can_edit: false, can_review_disabled_receipts: false });
        setMembership(null);
        setPreview(null);
      } else if (!preserve) {
        setMembership(null);
        setPreview(null);
      }
      setMessage(membershipErrorMessage(kind));
    } finally {
      setLoading(false);
    }
  }, [period?.id]);

  useEffect(() => { void load(); }, [load]);

  const previewByMember = useMemo(() => new Map(preview?.members.map((member) => [member.member_name, member])), [preview]);
  const enabledCount = membership?.members.filter((member) => member.participation_mode === "enabled").length || 0;
  const editable = Boolean(permissions?.can_edit && membership?.status === "CURRENT");

  async function confirmChange() {
    if (!pendingChange || !membership || !period?.id || saving) return;
    setSaving(true);
    setMessage("");
    try {
      await setSettlementCycleMemberMode(period.id, pendingChange.memberName, pendingChange.nextMode, membership.revision);
      setPendingChange(null);
      await onMembershipChanged();
      await load(true);
      setMessage("Settlement membership updated.");
    } catch (error) {
      const kind = classifyMembershipError(error);
      setPendingChange(null);
      if (["stale", "unauthorized", "closed", "finalized", "invalid_member", "invalid_mode"].includes(kind)) await load(true);
      setMessage(membershipErrorMessage(kind));
    } finally {
      setSaving(false);
    }
  }

  if (!MEMBERSHIP_FEATURE_ENABLED) return <div className="membership-unavailable"><LockKeyhole aria-hidden="true" /><div><strong>Settlement Members</strong><span>Available after the membership backend is deployed.</span></div></div>;
  if (loading && !membership) return <div className="membership-loading" role="status"><span className="status-spinner" aria-hidden="true" />Loading settlement members…</div>;
  if (!permissions?.can_view || !membership || !preview) return <div className="membership-unavailable" role="status"><LockKeyhole aria-hidden="true" /><div><strong>Settlement Members</strong><span>{message || "Read-only access could not be verified."}</span></div></div>;

  return <>
    <div className="membership-summary" aria-label="Settlement membership summary">
      <div><span>Participants</span><strong>{enabledCount}</strong></div>
      <div><span>Eligible expenses</span><strong>{fmt(preview.total_cents)}</strong></div>
      <div><span>Equal share</span><strong>{fmt(preview.equal_share_cents)}</strong></div>
      <div><span>Revision</span><strong>{membership.revision}</strong></div>
    </div>
    {!editable && <div className="membership-permission-note"><LockKeyhole aria-hidden="true" /><span>{membership.status === "CURRENT" ? "Membership is read-only for this account." : "Historical membership is read-only."}</span></div>}
    {message && <div className="membership-message" role="status"><CircleAlert aria-hidden="true" /><span>{message}</span><button type="button" disabled={loading || saving} onClick={() => void load(true)}>Reload</button></div>}
    <ul className="membership-list">
      {membership.members.map((member) => {
        const financial = previewByMember.get(member.member_name);
        const modeIndex = MODES.indexOf(member.participation_mode);
        return <li className={`membership-member mode-${member.participation_mode}`} key={member.member_name}>
          <div className="membership-member-heading">
            <ProfileAvatar name={member.member_name} src={memberAvatarUrls[memberNameKey(member.member_name)]} />
            <div><strong>{member.member_name}</strong><span>{modeLabel(member.participation_mode)}</span></div>
          </div>
          {editable ? <GlassSegmented className="membership-mode-control" options={MODE_OPTIONS} value={modeIndex} onChange={(index) => { const nextMode = MODES[index]; if (nextMode !== member.participation_mode) setPendingChange({ memberName: member.member_name, previousMode: member.participation_mode, nextMode }); }} size="sm" aria-label={`Participation mode for ${member.member_name}`} /> : <span className="membership-mode-readonly">{modeLabel(member.participation_mode)}</span>}
          <p>{modeDescription(member.participation_mode)}</p>
          {financial && member.participation_mode !== "disabled" ? <dl className="membership-financials"><div><dt>Paid</dt><dd>{fmt(financial.paid_cents)}</dd></div><div><dt>Share</dt><dd>{fmt(financial.share_cents)}</dd></div><div><dt>{financial.net_cents >= 0 ? "Preview credit" : "Preview shortfall"}</dt><dd className={financial.net_cents >= 0 ? "balance-credit" : "balance-due"}>{fmt(Math.abs(financial.net_cents))}</dd></div></dl> : <span className="membership-not-participating">Not participating this cycle</span>}
        </li>;
      })}
    </ul>
    <GlassSheet open={Boolean(pendingChange)} onClose={() => !saving && setPendingChange(null)} intensity={6} aria-label="Confirm membership change">
      {pendingChange && <section className="membership-confirm" aria-labelledby="membership-confirm-title">
        <span className="membership-confirm-icon" aria-hidden="true"><UsersRound /></span>
        <h2 id="membership-confirm-title">Change {pendingChange.memberName}?</h2>
        <p><strong>{modeLabel(pendingChange.previousMode)} → {modeLabel(pendingChange.nextMode)}</strong></p>
        <p>{modeDescription(pendingChange.nextMode)}</p>
        <p>Historical records remain unchanged. Current figures shown above reflect the saved configuration and will refresh after confirmation.</p>
        <div className="confirm-actions"><GlassButton type="button" variant="clear" disabled={saving} onClick={() => setPendingChange(null)}>Cancel</GlassButton><GlassButton type="button" variant="filled" disabled={saving} onClick={() => void confirmChange()}>{saving ? "Saving…" : "Confirm"}</GlassButton></div>
      </section>}
    </GlassSheet>
  </>;
}
