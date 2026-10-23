import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Attempt {
  at: number;
  result: string;
}

export interface StateData {
  /** Last ntfy message id seen; used as `since=` on reconnect so nothing is missed or replayed twice. */
  lastId?: string;
  /** Content hash -> first-seen time, for the 10-minute duplicate window. */
  seen: Record<string, number>;
  /** Every code ever submitted. A code is recorded here *before* it is submitted. */
  attempted: Record<string, Attempt>;
  lastSeenHeartbeat?: number;
  lastPing?: number;
  startedAt?: number;
}

export const DEDUPE_WINDOW_MS = 10 * 60_000;

/** Small JSON state that survives restarts. Writes are atomic (tmp file + rename). */
export class State {
  data: StateData;

  constructor(readonly path: string, now = Date.now()) {
    this.data = existsSync(path)
      ? { seen: {}, attempted: {}, ...JSON.parse(readFileSync(path, 'utf8')) }
      : { seen: {}, attempted: {} };
    this.data.startedAt = now;
  }

  save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path);
  }

  /** True if this content was already handled within the dedupe window. Records it otherwise. */
  isDuplicate(hash: string, now = Date.now()): boolean {
    for (const [h, t] of Object.entries(this.data.seen)) {
      if (now - t > DEDUPE_WINDOW_MS) delete this.data.seen[h];
    }
    if (hash in this.data.seen) return true;
    this.data.seen[hash] = now;
    this.save();
    return false;
  }

  wasAttempted(code: string): boolean {
    return code in this.data.attempted;
  }

  recordAttempt(code: string, result: string, now = Date.now()): void {
    this.data.attempted[code] = { at: now, result };
    this.save();
  }

  setLastId(id: string): void {
    this.data.lastId = id;
    this.save();
  }
}
