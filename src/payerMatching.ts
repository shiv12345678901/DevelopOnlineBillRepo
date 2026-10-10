type UserIdentity = {
  email?: string | null;
  user_metadata?: Record<string, unknown>;
};

function normalize(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

export function payerMatchesUser(payerName: string | null | undefined, user: UserIdentity) {
  const payer = normalize(payerName ?? "");
  if (!payer) return false;

  const metadata = user.user_metadata || {};
  const candidates = [
    metadata.member_key,
    metadata.display_name,
    metadata.full_name,
    user.email?.split("@")[0],
  ].filter((value): value is string => typeof value === "string" && Boolean(value.trim()));

  return candidates.some((candidate) => payer === normalize(candidate));
}
