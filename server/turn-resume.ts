import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ParkedTurn {
  botId: string;
  turnId: string;
  threadId: string;
  status: "running" | "interrupted";
}

function fileOf(dir: string): string {
  return join(dir, "turn-queue.json");
}

function readTurns(dir: string): ParkedTurn[] {
  try {
    const value: unknown = JSON.parse(readFileSync(fileOf(dir), "utf8"));
    if (!Array.isArray(value)) return [];
    return value.flatMap((row): ParkedTurn[] => {
      if (!row || typeof row !== "object") return [];
      const turn = row as ParkedTurn;
      if (typeof turn.botId !== "string" || typeof turn.turnId !== "string" || typeof turn.threadId !== "string") return [];
      if (turn.status !== "running" && turn.status !== "interrupted") return [];
      return [turn];
    });
  } catch {
    return [];
  }
}

function writeTurns(dir: string, turns: ParkedTurn[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(fileOf(dir), JSON.stringify(turns));
}

export function parkTurn(dir: string, turn: Omit<ParkedTurn, "status">): void {
  const turns = readTurns(dir).filter((row) => row.turnId !== turn.turnId);
  turns.push({ ...turn, status: "running" });
  writeTurns(dir, turns);
}

export function readParkedTurns(dir: string): ParkedTurn[] {
  return readTurns(dir);
}

export function interruptParkedTurns(dir: string): ParkedTurn[] {
  const turns = readTurns(dir).map((turn) => (
    turn.status === "running" ? { ...turn, status: "interrupted" as const } : turn
  ));
  writeTurns(dir, turns);
  return turns;
}

export function clearParkedTurn(dir: string, turnId: string): void {
  writeTurns(dir, readTurns(dir).filter((turn) => turn.turnId !== turnId));
}

export function clearParkedThread(dir: string, threadId: string): void {
  writeTurns(dir, readTurns(dir).filter((turn) => turn.threadId !== threadId));
}

/** Mark interrupted rows as noticed after boot so they are not re-announced. */
export function acknowledgeInterruptedTurns(dir: string): ParkedTurn[] {
  const interrupted = readTurns(dir).filter((turn) => turn.status === "interrupted");
  writeTurns(dir, readTurns(dir).filter((turn) => turn.status !== "interrupted"));
  return interrupted;
}
