import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const KEY_LEN = 32;

export interface PasswordAccount {
  email: string;
  salt: string;
  hash: string;
  createdAt: number;
}

export type PasswordFailure = "invalid-email" | "short-password" | "taken" | "wrong";

export function validAccountEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  return /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/.test(email) && email.length <= 320;
}

export function normalizeAccountEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** The earliest password account is the owner. Anyone else with an account is a member. */
export function passwordAccountScopes(accounts: readonly PasswordAccount[], rawEmail: string): Array<"admin" | "client"> | null {
  const email = normalizeAccountEmail(rawEmail);
  if (!accounts.some((account) => account.email === email)) return null;
  const owner = accounts.reduce((earliest, account) => account.createdAt < earliest.createdAt ? account : earliest).email === email;
  return owner ? ["admin", "client"] : ["client"];
}

export function passwordLongEnough(value: string): boolean {
  return value.length >= 8 && value.length <= 200;
}

function hashPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LEN);
}

export function createPasswordAccounts(file: string, now: () => number = Date.now) {
  const read = (): PasswordAccount[] => {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { accounts?: PasswordAccount[] };
      return Array.isArray(parsed.accounts) ? parsed.accounts : [];
    } catch {
      return [];
    }
  };
  const write = (accounts: PasswordAccount[]): void => {
    mkdirSync(dirname(file), { recursive: true });
    const next = `${file}.${process.pid}.tmp`;
    writeFileSync(next, JSON.stringify({ accounts }));
    chmodSync(next, 0o600);
    renameSync(next, file);
    chmodSync(file, 0o600);
  };
  return {
    list(): PasswordAccount[] {
      return read();
    },
    signup(rawEmail: string, password: string): { ok: true; email: string; owner: boolean } | { ok: false; reason: PasswordFailure } {
      const email = normalizeAccountEmail(rawEmail);
      if (!validAccountEmail(email)) return { ok: false, reason: "invalid-email" };
      if (!passwordLongEnough(password)) return { ok: false, reason: "short-password" };
      const accounts = read();
      if (accounts.some((account) => account.email === email)) return { ok: false, reason: "taken" };
      const salt = randomBytes(16);
      accounts.push({ email, salt: salt.toString("hex"), hash: hashPassword(password, salt).toString("hex"), createdAt: now() });
      write(accounts);
      return { ok: true, email, owner: accounts.length === 1 };
    },
    signin(rawEmail: string, password: string): { ok: true; email: string; owner: boolean } | { ok: false; reason: PasswordFailure } {
      const email = normalizeAccountEmail(rawEmail);
      if (!validAccountEmail(email) || !password) return { ok: false, reason: "wrong" };
      const account = read().find((row) => row.email === email);
      if (!account) return { ok: false, reason: "wrong" };
      const salt = Buffer.from(account.salt, "hex");
      const expected = Buffer.from(account.hash, "hex");
      const actual = hashPassword(password, salt);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: "wrong" };
      const owner = read().slice().sort((left, right) => left.createdAt - right.createdAt)[0]?.email === email;
      return { ok: true, email, owner };
    },
    setPassword(rawEmail: string, password: string): { ok: true; email: string } | { ok: false; reason: PasswordFailure } {
      const email = normalizeAccountEmail(rawEmail);
      if (!validAccountEmail(email)) return { ok: false, reason: "invalid-email" };
      if (!passwordLongEnough(password)) return { ok: false, reason: "short-password" };
      const accounts = read();
      const index = accounts.findIndex((row) => row.email === email);
      if (index < 0) return { ok: false, reason: "wrong" };
      const salt = randomBytes(16);
      accounts[index] = { ...accounts[index]!, salt: salt.toString("hex"), hash: hashPassword(password, salt).toString("hex") };
      write(accounts);
      return { ok: true, email };
    },
  };
}
