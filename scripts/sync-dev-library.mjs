// Refreshes .scaffold/data-real, the COPY of the real Zotero library that
// `npm start` opens. Dev runs then exercise real collections and items while
// the live database stays untouched.
//
// The copy must be taken with every Zotero closed. SQLite keeps recent writes
// in a -wal sidecar, so a snapshot taken while Zotero is writing can be
// internally inconsistent — the copy would open, then fail in ways that look
// like plugin bugs. Hence the process check below, which is a correctness
// guard and not a convenience.

import { execSync } from "node:child_process";
import console from "node:console";
import { cp, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";

const source = resolve(
  process.env.MERISTEMA_REAL_DATA_DIR ?? join(homedir(), "Zotero"),
);
const target = resolve("./.scaffold/data-real");

function zoteroIsRunning() {
  if (process.platform !== "win32") {
    try {
      return execSync("pgrep -x zotero", { stdio: "pipe" }).length > 0;
    } catch {
      return false;
    }
  }
  const out = execSync('tasklist /fi "imagename eq zotero.exe" /nh', {
    encoding: "utf8",
  });
  return out.toLowerCase().includes("zotero.exe");
}

// Logs are noise, and .bak/.tmp sidecars are snapshots of other moments that
// would only confuse a debugging session.
const skip = (path) => {
  const name = basename(path);
  return (
    name === "logs" ||
    name.endsWith(".bak") ||
    name.includes(".tmp-") ||
    name.endsWith(".1.bak")
  );
};

if (zoteroIsRunning()) {
  console.error(
    "Zotero is running. Quit every Zotero window (the dev one included) and\n" +
      "re-run, so the database is copied in a consistent state.",
  );
  process.exit(1);
}

await stat(source).catch(() => {
  console.error(
    `No Zotero data directory at ${source}.\n` +
      "Set MERISTEMA_REAL_DATA_DIR to the right path and re-run.",
  );
  process.exit(1);
});

console.log(`Copying ${source}\n     to ${target}`);
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true, filter: (src) => !skip(src) });
console.log("Done. `npm start` will now open a copy of your real library.");
