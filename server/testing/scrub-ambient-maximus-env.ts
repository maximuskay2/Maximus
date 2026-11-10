// Side-effect import that scrubs ambient MAXIMUS env before a module snapshots it (scripts/mcp-server.ts reads
// MAXIMUS_URL / MAXIMUS_PORT at evaluation). Import order is the contract: keep it above the module under test.
import { isAmbientMaximusKey } from "./maximus-env.ts";

for (const key of Object.keys(process.env)) {
  if (isAmbientMaximusKey(key)) delete process.env[key];
}
