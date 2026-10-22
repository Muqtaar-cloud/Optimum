import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkWatchdogs, createHandler, SEEN_TIMEOUT_MS } from '../src/handler.js';
import type { Alert } from '../src/notify.js';
import { parseRelayBody, runRelay, type NtfyEvent } from '../src/relay.js';
import { State } from '../src/state.js';

const TOKEN = 'tok_0123456789abcdef';

function body(kind: string, title = '', text = '', big = '') {
  return `OPTBOT1\ntoken: ${TOKEN}\nkind: ${kind}\n@@TITLE@@\n${title}\n@@TEXT@@\n${text}\n@@BIG@@\n${big}`;
}

function streamOf(lines: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const l of lines) c.enqueue(enc.encode(l + '\n'));
        c.close();
      },
    }),
  );
}

function setup(stage: 1 | 2 = 1) {
  const dir = mkdtempSync(join(tmpdir(), 'tb-'));
  const path = join(dir, 'state.json');
  const alerts: Alert[] = [];
  const notify = { send: async (a: Alert) => void alerts.push(a) };
  const redeemed: string[][] = [];
  const cfg = { stage, relayToken: TOKEN, xDisplayName: 'Optimum', ignorePhrases: ['liked your'], walletDeeplink: 'https://x', dataDir: dir };
  const mk = (state: State) =>
    createHandler({ cfg, state, notify, autoRedeem: stage >= 2 ? async (c) => void redeemed.push(c) : undefined });
  return { dir, path, alerts, redeemed, notify, mk };
}

describe('parseRelayBody', () => {
  it('keeps quotes and newlines intact', () => {
    const m = parseRelayBody(body('notif', 'Optimum', 'say "hi"\nline2', 'Code: "AB12CD"'));
    expect(m).toMatchObject({ token: TOKEN, kind: 'notif', title: 'Optimum', text: 'say "hi"\nline2', big: 'Code: "AB12CD"' });
  });

  it('rejects other messages', () => {
    expect(parseRelayBody('hello')).toBeNull();
    expect(parseRelayBody('OPTBOT1\nkind: nope')).toBeNull();
  });
});

describe('runRelay', () => {
  it('reconnects with since=<last id> and backs off', async () => {
    const urls: string[] = [];
    let lastId = '';
    const sleeps: number[] = [];
    const ctrl = new AbortController();
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      calls++;
      if (calls === 1) return streamOf([JSON.stringify({ id: 'a1', time: 1, event: 'message', message: 'x' })]);
      if (calls === 2) throw new Error('wifi blip');
      ctrl.abort();
      return streamOf([]);
    }) as unknown as typeof fetch;
    await runRelay({
      server: 'https://ntfy.test',
      topic: 'in',
      since: () => lastId || '10m',
      onMessage: async (e) => void (lastId = e.id),
      signal: ctrl.signal,
      fetchImpl,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(urls[0]).toContain('since=10m');
    expect(urls[1]).toContain('since=a1');
    expect(urls[2]).toContain('since=a1');
    expect(sleeps).toEqual([1000, 2000]);
  });
});

describe('handler', () => {
  it('replies pipeline OK to PING', async () => {
    const s = setup();
    await s.mk(new State(s.path))({ id: '1', time: 1, event: 'message', message: body('ping') });
    expect(s.alerts[0].title).toBe('pipeline OK');
  });

  it('ignores a wrong token', async () => {
    const s = setup();
    await s.mk(new State(s.path))({ id: '1', time: 1, event: 'message', message: body('ping').replace(TOKEN, 'bad') });
    expect(s.alerts).toHaveLength(0);
  });

  it('pushes the code in stage 1 without redeeming', async () => {
    const s = setup(1);
    await s.mk(new State(s.path))({ id: '1', time: 1, event: 'message', message: body('notif', 'Optimum', 'Code: AB12CD', 'Code: AB12CD') });
    expect(s.alerts[0].title).toBe('CODE: AB12CD');
    expect(s.alerts[0].priority).toBe(5);
  });

  it('auto-redeems only verified posts in stage 2', async () => {
    const s = setup(2);
    const h = s.mk(new State(s.path));
    await h({ id: '1', time: 1, event: 'message', message: body('notif', 'Optimum 🟢', 'Code: AB12CD', 'Code: AB12CD') });
    expect(s.redeemed).toEqual([]);
    expect(s.alerts[0].title).toMatch(/^UNVERIFIED CODE/);
    await h({ id: '2', time: 2, event: 'message', message: body('notif', 'Optimum', 'Code: ZZ99YY', 'Code: ZZ99YY') });
    expect(s.redeemed).toEqual([['ZZ99YY']]);
  });

  it('dedupes a replayed message across a restart and keeps lastId', async () => {
    const s = setup(2);
    const ev: NtfyEvent = { id: 'abc', time: 1, event: 'message', message: body('notif', 'Optimum', 'Code: AB12CD', 'Code: AB12CD') };
    await s.mk(new State(s.path))(ev);
    const reloaded = new State(s.path);
    expect(reloaded.data.lastId).toBe('abc');
    await s.mk(reloaded)(ev);
    expect(s.redeemed).toHaveLength(1);
  });

  it('records SEEN and alerts once when it goes quiet for 12h', async () => {
    const s = setup();
    const state = new State(s.path, 0);
    const w = { seenAlerted: false };
    await checkWatchdogs(state, s.notify, w, SEEN_TIMEOUT_MS - 1);
    expect(s.alerts).toHaveLength(0);
    await checkWatchdogs(state, s.notify, w, SEEN_TIMEOUT_MS + 1);
    await checkWatchdogs(state, s.notify, w, SEEN_TIMEOUT_MS + 2);
    expect(s.alerts.map((a) => a.title)).toEqual(['MacroDroid listener may be dead']);
    await createHandler({ cfg: { stage: 1, relayToken: TOKEN, xDisplayName: 'Optimum', ignorePhrases: [], walletDeeplink: '', dataDir: s.dir }, state, notify: s.notify, now: () => SEEN_TIMEOUT_MS + 3 })({
      id: 's',
      time: 1,
      event: 'message',
      message: body('seen'),
    });
    await checkWatchdogs(state, s.notify, w, SEEN_TIMEOUT_MS + 4);
    expect(w.seenAlerted).toBe(false);
  });

  it('pushes "open the post" for a truncated code mention', async () => {
    const s = setup(2);
    await s.mk(new State(s.path))({ id: '1', time: 1, event: 'message', message: body('notif', 'Optimum', 'Codes are live, here is the first one…', '') });
    expect(s.alerts[0].title).toBe('Optimum post: open it');
    expect(s.redeemed).toEqual([]);
  });
});
