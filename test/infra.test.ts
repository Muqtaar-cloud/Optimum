import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireLock, releaseLock } from '../src/lock.js';
import { PageQueue } from '../src/queue.js';
import { State } from '../src/state.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'tb-'));

describe('acquireLock', () => {
  it('refuses when another live instance holds the pid file', () => {
    const p = join(tmp(), 'bot.pid');
    writeFileSync(p, '4242');
    expect(acquireLock(p, 1000, () => true)).toBe(false);
  });

  it('takes over a stale pid file', () => {
    const p = join(tmp(), 'bot.pid');
    writeFileSync(p, '4242');
    expect(acquireLock(p, 1000, () => false)).toBe(true);
    releaseLock(p, 1000);
    expect(acquireLock(p, 1001, () => true)).toBe(true);
  });
});

describe('PageQueue', () => {
  it('a redeem cancels an in-flight session check and runs next', async () => {
    const q = new PageQueue();
    const log: string[] = [];
    const check = q.run(
      (signal) =>
        new Promise<void>((resolve, reject) => {
          log.push('check start');
          signal.addEventListener('abort', () => (log.push('check aborted'), reject(signal.reason)));
          setTimeout(resolve, 5000);
        }),
      { cancellable: true },
    );
    await new Promise((r) => setTimeout(r, 5));
    const redeem = q.run(async () => void log.push('redeem'));
    await expect(check).rejects.toThrow('preempted');
    await redeem;
    expect(log).toEqual(['check start', 'check aborted', 'redeem']);
  });

  it('serialises tasks', async () => {
    const q = new PageQueue();
    const log: number[] = [];
    await Promise.all([1, 2, 3].map((i) => q.run(async () => void log.push(i))));
    expect(log).toEqual([1, 2, 3]);
  });
});

describe('State', () => {
  it('persists attempted codes across restarts', () => {
    const p = join(tmp(), 'state.json');
    const a = new State(p);
    a.recordAttempt('AB12CD', 'submitting');
    expect(new State(p).wasAttempted('AB12CD')).toBe(true);
  });

  it('expires duplicates after 10 minutes', () => {
    const s = new State(join(tmp(), 'state.json'));
    expect(s.isDuplicate('h', 0)).toBe(false);
    expect(s.isDuplicate('h', 60_000)).toBe(true);
    expect(s.isDuplicate('h', 11 * 60_000)).toBe(false);
  });
});
