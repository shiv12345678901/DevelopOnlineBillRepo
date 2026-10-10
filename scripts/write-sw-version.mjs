import { readFile, writeFile } from "node:fs/promises";

const versionData = JSON.parse(await readFile("public/version.json", "utf8"));
const serviceWorkerPath = "dist/sw.js";
const serviceWorker = await readFile(serviceWorkerPath, "utf8");
const updated = serviceWorker.replace(
  'const BUILD_VERSION = "__BUILD_VERSION__";',
  `const BUILD_VERSION = ${JSON.stringify(versionData.version)};`,
);

await writeFile(serviceWorkerPath, updated, "utf8");
