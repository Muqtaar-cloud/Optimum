import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.js';
import { classifyTrust, extract, type XNotification } from './extract.js';
import type { Notifier } from './notify.js';
import { parseRelayBody, type NtfyEvent } from './relay.js';
import type { State } from './state.js';

export type HandlerConfig = Pick<
  Config,
  'stage' | 'relayToken' | 'xDisplayName' | 'ignorePhrases' | 'walletDeeplink' | 'dataDir'
>;

export interface HandlerDeps {
  cfg: HandlerConfig;
  state: State;
  notify: Notifier;
  /** Stage 2+: submits codes in order. Absent in stage 1. */
  autoRedeem?: (codes: string[]) => Promise<void>;
  now?: () => number;
}

function hashOf(n: XNotification): string {
  return createHash('sha256').update(`${n.title}\n${n.text}\n${n.big}`).digest('hex').slice(0, 16);
}

export function createHandler(d: HandlerDeps): (ev: NtfyEvent) => Promise<void> {
  const now = d.now ?? Date.now;
  return async (ev) => {
    try {
      await handle(ev);
    } finally {
      d.state.setLastId(ev.id);
    }
  };

  async function handle(ev: NtfyEvent): Promise<void> {
    const msg = parseRelayBody(ev.message ?? '');
    if (!msg) return void console.log('[relay] ignored non-bot message on topic');
    if (msg.token !== d.cfg.relayToken) return void console.warn('[relay] ignored message with wrong RELAY_TOKEN');

    switch (msg.kind) {
      case 'ping':
        d.state.data.lastPing = now();
        d.state.save();
        return d.notify.send({ title: 'pipeline OK', body: 'Phone -> ntfy -> PC is working.', priority: 2, tags: ['white_check_mark'] });
      case 'seen':
        d.state.data.lastSeenHeartbeat = now();
        d.state.save();
        return;
      case 'capture': {
        const dir = join(d.cfg.dataDir, 'captures');
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${new Date(now()).toISOString().replace(/[:.]/g, '-')}.json`);
        writeFileSync(file, JSON.stringify({ title: msg.title, text: msg.text, big: msg.big }, null, 2));
        return d.notify.send({ title: 'Capture saved', body: `title: ${msg.title}\nsaved to ${file}`, priority: 2 });
      }
      case 'notif':
        return notif({ title: msg.title, text: msg.text, big: msg.big });
    }
  }

  async function notif(n: XNotification): Promise<void> {
    const t = classifyTrust(n, d.cfg.xDisplayName, d.cfg.ignorePhrases);
    if (t.trust === 'ignored') return void console.log(`[notif] ignored (${t.reason}): ${n.title}`);
    if (d.state.isDuplicate(hashOf(n), now())) return void console.log('[notif] duplicate, skipped');

    const x = extract(n);
    const auto = d.cfg.stage >= 2 && t.trust === 'verified' && x.autoOk && !!d.autoRedeem;
    const tag = t.trust === 'unverified' ? 'UNVERIFIED ' : '';
    const why =
      d.cfg.stage < 2 ? 'stage 1 (notify only)' : t.trust !== 'verified' ? t.reason : !x.autoOk ? x.reason : 'yes';

    if (x.candidates.length) {
      await d.notify.send({
        title: `${tag}CODE: ${x.candidates.slice(0, 3).join(' / ')}`,
        body: [`Codes: ${x.candidates.join(', ')}`, `Auto-claim: ${auto ? 'yes, submitting ' + x.redeem.join(', ') : 'no - ' + why}`, `Post: ${n.big || n.text}`].join('\n'),
        priority: 5,
        tags: ['rotating_light'],
        click: d.cfg.walletDeeplink,
      });
    } else if (x.mentionsCode || x.truncated || x.bundled) {
      await d.notify.send({
        title: `${tag}Optimum post: open it`,
        body: `${x.reason}\nPost: ${n.big || n.text}`,
        priority: 4,
        click: d.cfg.walletDeeplink,
      });
    } else {
      console.log(`[notif] no code: ${n.text}`);
    }

    if (auto) await d.autoRedeem!(x.redeem);
  }
}

export interface WatchdogState {
  seenAlerted: boolean;
}

export const SEEN_TIMEOUT_MS = 12 * 3_600_000;

/** Alerts once if the phone's notification listener has gone quiet; resets when SEEN resumes. */
export async function checkWatchdogs(state: State, notify: Notifier, w: WatchdogState, now = Date.now()): Promise<void> {
  const last = Math.max(state.data.lastSeenHeartbeat ?? 0, state.data.startedAt ?? 0);
  const quiet = now - last > SEEN_TIMEOUT_MS;
  if (quiet && !w.seenAlerted) {
    w.seenAlerted = true;
    await notify.send({
      title: 'MacroDroid listener may be dead',
      body: 'No SEEN heartbeat from the phone for 12h. Open MacroDroid, check notification access and battery settings.',
      priority: 5,
      tags: ['warning'],
    });
  } else if (!quiet) {
    w.seenAlerted = false;
  }
}
