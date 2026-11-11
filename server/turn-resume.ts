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
