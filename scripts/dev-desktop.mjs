// Local desktop: stage this Mac's cua-driver, then run Electron so computer control can ask for its permissions.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

if (process.platform === "darwin") {
  const arch = process.arch === "arm64" || process.arch === "x64" ? process.arch : null;
  if (!arch) throw new Error(`computer control has no cua-driver build for ${process.arch}`);
  process.env.MAXIMUS_CUA_ARCHES = arch;
  process.env.MAXIMUS_CUA_ARCHES_PARTIAL = "1";
  await import("./prepare-cua.mjs");
  process.env.MAXIMUS_CUA_DEV = "1";
}

const electron = createRequire(import.meta.url)("electron");
const child = spawn(electron, ["."], { stdio: "inherit", env: process.env });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
