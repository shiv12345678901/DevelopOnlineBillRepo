import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const version = process.env.COMMIT_REF
  || process.env.NETLIFY_COMMIT_REF
  || process.env.GITHUB_SHA
  || `local-${Date.now()}`;

await mkdir("public", { recursive: true });
await writeFile(
  join("public", "version.json"),
  `${JSON.stringify({ version, builtAt: new Date().toISOString() }, null, 2)}\n`,
  "utf8",
);
