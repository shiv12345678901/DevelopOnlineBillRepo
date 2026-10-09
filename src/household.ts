export const HOUSEHOLD_MEMBERS = [
  { username: "shiva", name: "Shiva Kafle" },
  { username: "arpan", name: "Arpan Bhurtel" },
  { username: "arjun", name: "Arjun Bhurtel" },
  { username: "swasti", name: "Swasti Adhikari" },
] as const;

export const ACCOUNT_DOMAIN = "billforus.netlify.app";

export function memberEmail(username: string) {
  return `${username}@${ACCOUNT_DOMAIN}`;
}
