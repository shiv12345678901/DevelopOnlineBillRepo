import { createClient } from "@supabase/supabase-js";

const members = [
  { username: "shiva", name: "Shiva Kafle", passwordVariable: "SHIVA_PASSWORD" },
  { username: "arpan", name: "Arpan Bhurtel", passwordVariable: "ARPAN_PASSWORD" },
  { username: "arjun", name: "Arjun Bhurtel", passwordVariable: "ARJUN_PASSWORD" },
  { username: "swasti", name: "Swasti Adhikari", passwordVariable: "SWASTI_PASSWORD" },
];

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !secretKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY before running this script.");
}

const missingPasswords = members.filter(({ passwordVariable }) => !process.env[passwordVariable]);
if (missingPasswords.length) {
  throw new Error(`Set these password variables: ${missingPasswords.map(({ passwordVariable }) => passwordVariable).join(", ")}`);
}

const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

for (const member of members) {
  const email = `${member.username}@billforus.netlify.app`;
  const { error } = await supabase.auth.admin.createUser({
    email,
    password: process.env[member.passwordVariable],
    email_confirm: true,
    user_metadata: {
      display_name: member.name,
      member_key: member.username,
    },
  });

  if (error) console.error(`Could not create ${member.name}: ${error.message}`);
  else console.log(`Created ${member.name} (${email})`);
}
