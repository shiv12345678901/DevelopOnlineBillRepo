import type { MembershipPermissions, ParticipationMode } from "./api";

export const MEMBERSHIP_FEATURE_ENABLED = import.meta.env?.VITE_ENABLE_CYCLE_MEMBERSHIP === "true";

export type MembershipErrorKind = "unauthorized" | "stale" | "closed" | "finalized" | "invalid_member" | "invalid_mode" | "zero_enabled" | "configuration" | "network" | "unknown";

export function classifyMembershipError(error: unknown): MembershipErrorKind {
  const value = error as { code?: string; message?: string } | null;
  const message = value?.message || "";
  if (value?.code === "42501" || message === "UNAUTHORIZED_MEMBERSHIP_ACCESS" || message === "UNAUTHORIZED_MEMBERSHIP_CHANGE") return "unauthorized";
  if (message === "STALE_MEMBERSHIP_REVISION") return "stale";
  if (message === "CLOSED_CYCLE_MEMBERSHIP_CHANGE") return "closed";
  if (message === "FINALIZED_OBLIGATIONS") return "finalized";
  if (message === "INVALID_MEMBER_IDENTITY") return "invalid_member";
  if (message === "INVALID_PARTICIPATION_MODE") return "invalid_mode";
  if (message === "ZERO_ENABLED_MEMBERS") return "zero_enabled";
  if (["MEMBERSHIP_REVISION_REQUIRED", "MEMBERSHIP_NOT_INITIALIZED", "INVALID_PERIOD"].includes(message)) return "configuration";
  if (!value?.code) return "network";
  if (value?.code && value.code !== "P0001") return "network";
  return "unknown";
}

export function membershipErrorMessage(kind: MembershipErrorKind) {
  if (kind === "unauthorized") return "You don’t have permission to change settlement members.";
  if (kind === "stale") return "Membership changed elsewhere. The latest configuration has been loaded; review it before trying again.";
  if (kind === "closed") return "Historical settlement membership is read-only.";
  if (kind === "finalized") return "Payment obligations are finalized, so membership can no longer be changed.";
  if (kind === "invalid_member" || kind === "invalid_mode") return "That membership change is no longer valid. The latest configuration has been loaded.";
  if (kind === "zero_enabled") return "At least one member must remain enabled for equal sharing.";
  if (kind === "configuration") return "Settlement membership is not ready. Check the backend deployment before enabling this feature.";
  if (kind === "network") return "Couldn’t reach Supabase. Your current membership view has been preserved.";
  return "Couldn’t update settlement membership. Please try again.";
}

export function permissionsMatch(...permissions: MembershipPermissions[]) {
  return permissions.every((value) => value.can_view === permissions[0].can_view && value.can_edit === permissions[0].can_edit && value.can_review_disabled_receipts === permissions[0].can_review_disabled_receipts);
}

export function modeLabel(mode: ParticipationMode) {
  if (mode === "keep_receipts") return "Keep Receipts";
  return mode === "enabled" ? "Enabled" : "Disabled";
}

export function modeDescription(mode: ParticipationMode) {
  if (mode === "enabled") return "Receipts count and this member receives an equal share.";
  if (mode === "keep_receipts") return "Receipts count and payments stay credited; equal share is zero.";
  return "Receipts stay stored but are hidden and excluded from this cycle.";
}
