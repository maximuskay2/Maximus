import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";

export async function migrate(pool: Pool, dir: string): Promise<string[]> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)",
  );
  const applied = await pool.query<{ id: string }>("SELECT id FROM schema_migrations");
  const done = new Set(applied.rows.map((row) => row.id));
  const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    const id = file.slice(0, -".sql".length);
    if (done.has(id)) continue;
    const sql = await readFile(join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)", [id, Date.now()]);
      await client.query("COMMIT");
      ran.push(id);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return ran;
}
