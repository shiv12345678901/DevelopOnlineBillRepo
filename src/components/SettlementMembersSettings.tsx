import { useCallback, useEffect, useState } from "react";
import { CircleAlert, LockKeyhole, UsersRound } from "lucide-react";
import {
  fetchSettlementCycleMembership,
  fetchSettlementCycleMembershipPermissions,
  fetchSettlementCyclePreview,
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
import { IosSheet } from "./IosSheet";
import { OVERLAY_PRIORITY } from "../navigationOverlays";

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
        return;
      }
      if (!nextPermissions.can_edit && !nextPermissions.can_review_disabled_receipts) {
        setMembership(null);
        setPreview(null);
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

  const administrator = Boolean(permissions?.can_edit || permissions?.can_review_disabled_receipts);
  if (!MEMBERSHIP_FEATURE_ENABLED || (loading && !membership) || !administrator || !permissions?.can_view || !membership || !preview) return null;

  return <>
    <div className="settlement-members-block">
    <div className="section-heading compact"><h3>Settlement Members</h3><span>{membership.members.length} members</span></div>
    {!editable && <div className="membership-permission-note"><LockKeyhole aria-hidden="true" /><span>{membership.status === "CURRENT" ? "Membership is read-only for this account." : "Historical membership is read-only."}</span></div>}
    {message && <div className="membership-message" role="status"><CircleAlert aria-hidden="true" /><span>{message}</span><button type="button" disabled={loading || saving} onClick={() => void load(true)}>Reload</button></div>}
    <ul className="membership-list">
      {membership.members.map((member) => {
        const enabled = member.participation_mode === "enabled";
        const legacyMode = member.participation_mode === "keep_receipts";
        return <li className={`membership-member mode-${member.participation_mode}`} key={member.member_name}>
          <div className="membership-member-heading">
            <ProfileAvatar name={member.member_name} src={memberAvatarUrls[memberNameKey(member.member_name)]} />
            <div><strong>{member.member_name}</strong><span>{legacyMode ? "Legacy Keep Receipts · choose Enabled or Disabled" : enabled ? "Enabled" : "Disabled · hidden from this cycle"}</span></div>
            {editable ? <button
              className={`membership-toggle${enabled ? " enabled" : ""}${legacyMode ? " legacy" : ""}`}
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={`${enabled ? "Disable" : "Enable"} ${member.member_name}`}
              disabled={saving}
              onClick={() => setPendingChange({ memberName: member.member_name, previousMode: member.participation_mode, nextMode: enabled ? "disabled" : "enabled" })}
            ><span aria-hidden="true" /></button> : <span className={`membership-mode-badge mode-${member.participation_mode}`}>{modeLabel(member.participation_mode)}</span>}
          </div>
        </li>;
      })}
    </ul>
    </div>
    <IosSheet open={Boolean(pendingChange)} onClose={() => { if (!saving) setPendingChange(null); }} label="Confirm membership change" className="membership-confirm-modal" overlayPriority={OVERLAY_PRIORITY.confirmation}>
      {pendingChange && <section className="membership-confirm" aria-labelledby="membership-confirm-title">
        <span className="membership-confirm-icon" aria-hidden="true"><UsersRound /></span>
        <h2 id="membership-confirm-title">Change {pendingChange.memberName}?</h2>
        <p><strong>{modeLabel(pendingChange.previousMode)} → {modeLabel(pendingChange.nextMode)}</strong></p>
        <p>{modeDescription(pendingChange.nextMode)}</p>
        <p>Historical records remain unchanged. Current figures shown above reflect the saved configuration and will refresh after confirmation.</p>
        <div className="confirm-actions"><button className="ios-secondary-button" type="button" disabled={saving} onClick={() => setPendingChange(null)}>Cancel</button><button className="ios-primary-button" type="button" disabled={saving} onClick={() => void confirmChange()}>{saving ? "Saving…" : "Confirm"}</button></div>
      </section>}
    </IosSheet>
  </>;
}
