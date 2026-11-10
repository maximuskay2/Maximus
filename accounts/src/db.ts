import { Pool, types as pgTypes } from "pg";

import type { Database, DbStatement } from "./types.ts";

pgTypes.setTypeParser(20, (value: string) => Number.parseInt(value, 10));

type QueryFn = (text: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;

export function translatePlaceholders(sql: string): string {
  let index = 0;
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]!;
    if (quote) {
      out += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          out += sql[i + 1];
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "?") {
      const next = sql[i + 1];
      if (next !== undefined && next >= "0" && next <= "9") {
        throw new Error("numbered placeholders are not supported; use sequential ?");
      }
      index += 1;
      out += `$${index}`;
      continue;
    }
    out += ch;
  }
  return out;
}

class PgStatement implements DbStatement {
  readonly sql: string;
  readonly params: unknown[];
  private readonly query: QueryFn;
  constructor(sql: string, params: unknown[], query: QueryFn) {
    this.sql = sql;
    this.params = params;
    this.query = query;
  }

  bind(...values: unknown[]): DbStatement {
    return new PgStatement(this.sql, values, this.query);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const result = await this.query(translatePlaceholders(this.sql), this.params);
    return (result.rows[0] as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const result = await this.query(translatePlaceholders(this.sql), this.params);
    return { results: result.rows as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const result = await this.query(translatePlaceholders(this.sql), this.params);
    return { meta: { changes: result.rowCount ?? 0 } };
  }
}

export function createDatabase(pool: Pool): Database {
  const query: QueryFn = (text, params) => pool.query(text, params as unknown[]);
  return {
    prepare: (sql: string) => new PgStatement(sql, [], query),
    batch: async (statements: DbStatement[]) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out: { meta: { changes: number }; results: unknown[] }[] = [];
        for (const statement of statements) {
          if (!(statement instanceof PgStatement)) throw new Error("batch received a foreign statement");
          const result = await client.query(
            translatePlaceholders(statement.sql),
            statement.params as unknown[],
          );
          out.push({ meta: { changes: result.rowCount ?? 0 }, results: result.rows });
        }
        await client.query("COMMIT");
        return out;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10 });
}
