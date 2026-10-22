import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import type { Alert } from '../src/notify.js';
import type { RedeemOutcome } from '../src/site.js';
import { State } from '../src/state.js';

const outcomes: Record<string, RedeemOutcome> = {};
const submitted: string[] = [];
let attemptedAtSubmit: Record<string, boolean> = {};
let state: State;

vi.mock('../src/browser.js', () => ({
  launch: async () => ({
    context: { close: async () => undefined },
    wallet: { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', publicClient: {} },
    site: {
      open: async () => undefined,
      ensureSignedIn: async () => true,
      followQuestStatus: async () => 'done',
      screenshot: async () => 'shot.png',
      redeem: async (code: string, dryRun: boolean) => {
        attemptedAtSubmit[code] = state.wasAttempted(code);
        if (dryRun) return { outcome: 'dry-run', detail: '' };
        submitted.push(code);
        return { outcome: outcomes[code] ?? 'unknown', detail: '' };
      },
    },
  }),
}));

const { startBot } = await import('../src/bot.js');

const cfg = (): Config => ({ stage: 2, dryRun: false, walletDeeplink: 'https://x', mintCardText: 'Turbo' }) as Config;

describe('startBot redeem path', () => {
  let alerts: Alert[];
  const notify = { send: async (a: Alert) => void alerts.push(a) };

  beforeEach(() => {
    alerts = [];
    submitted.length = 0;
    attemptedAtSubmit = {};
    state = new State(join(mkdtempSync(join(tmpdir(), 'tb-')), 'state.json'));
  });

  it('records the attempt before submitting, and stops after success', async () => {
    outcomes.AAA111 = 'success';
    const redeem = await startBot(cfg(), state, notify, new AbortController().signal);
    await redeem(['AAA111', 'BBB222']);
    expect(submitted).toEqual(['AAA111']);
    expect(attemptedAtSubmit.AAA111).toBe(true);
    expect(state.data.attempted.AAA111.result).toBe('success');
    expect(alerts.some((a) => a.title === 'Code accepted: AAA111' && a.body.includes('0xf39F'))).toBe(true);
  });

  it('tries the second candidate only after an explicit "invalid"', async () => {
    outcomes.CCC333 = 'invalid';
    outcomes.DDD444 = 'success';
    const redeem = await startBot(cfg(), state, notify, new AbortController().signal);
    await redeem(['CCC333', 'DDD444']);
    expect(submitted).toEqual(['CCC333', 'DDD444']);
  });

  it('stops on an unrecognised or rate-limited response', async () => {
    outcomes.EEE555 = 'unknown';
    outcomes.FFF666 = 'success';
    const redeem = await startBot(cfg(), state, notify, new AbortController().signal);
    await redeem(['EEE555', 'FFF666']);
    expect(submitted).toEqual(['EEE555']);
    expect(alerts.at(-1)?.title).toBe('Needs you: unknown (EEE555)');
  });

  it('never resubmits a code attempted before a restart', async () => {
    state.recordAttempt('GGG777', 'submitting');
    const redeem = await startBot(cfg(), state, notify, new AbortController().signal);
    await redeem(['GGG777']);
    expect(submitted).toEqual([]);
  });

  it('does not record attempts in a dry run', async () => {
    const redeem = await startBot({ ...cfg(), dryRun: true }, state, notify, new AbortController().signal);
    await redeem(['HHH888']);
    expect(state.wasAttempted('HHH888')).toBe(false);
    expect(alerts.some((a) => a.title === 'dry run OK')).toBe(true);
  });
});
