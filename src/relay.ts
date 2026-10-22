/**
 * Phone → ntfy → bot relay.
 *
 * MacroDroid posts a plain-text body (no JSON, so quotes or newlines in a post
 * cannot break it):
 *
 *   OPTBOT1
 *   token: <RELAY_TOKEN>
 *   kind: notif            (notif | ping | seen | capture)
 *   @@TITLE@@
 *   [notification_title]
 *   @@TEXT@@
 *   [notification]
 *   @@BIG@@
 *   [notification_big_text]
 */

export type RelayKind = 'notif' | 'ping' | 'seen' | 'capture';

export interface RelayMessage {
  token: string;
  kind: RelayKind;
  title: string;
  text: string;
  big: string;
}

const MARKERS = { '@@TITLE@@': 'title', '@@TEXT@@': 'text', '@@BIG@@': 'big' } as const;
const KINDS: RelayKind[] = ['notif', 'ping', 'seen', 'capture'];

export function parseRelayBody(body: string): RelayMessage | null {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.trim() !== 'OPTBOT1') return null;
  const header: Record<string, string> = {};
  const sections: Record<string, string[]> = { title: [], text: [], big: [] };
  let current: keyof typeof sections | null = null;
  for (const line of lines.slice(1)) {
    const marker = MARKERS[line.trim() as keyof typeof MARKERS];
    if (marker) {
      current = marker;
    } else if (current) {
      sections[current].push(line);
    } else {
      const m = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i.exec(line);
      if (m) header[m[1].toLowerCase()] = m[2];
    }
  }
  const kind = (header.kind ?? 'notif').toLowerCase() as RelayKind;
  if (!KINDS.includes(kind)) return null;
  return {
    token: header.token ?? '',
    kind,
    title: sections.title.join('\n').trim(),
    text: sections.text.join('\n').trim(),
    big: sections.big.join('\n').trim(),
  };
}

export interface NtfyEvent {
  id: string;
  time: number;
  event: string;
  message?: string;
}

export interface RelayOptions {
  server: string;
  topic: string;
  /** `since=` value for the next connection: last message id, or e.g. "10m" on first start. */
  since: () => string;
  onMessage: (e: NtfyEvent) => Promise<void>;
  /** Called once the stream is back after being down longer than `downAlertMs`. */
  onRecovered?: (downMs: number) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Reconnect if nothing (not even a keepalive) arrives for this long. ntfy sends keepalives every ~45s. */
  stallMs?: number;
  downAlertMs?: number;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Subscribes forever, reconnecting with backoff (1s → 60s) and replaying from `since`. */
export async function runRelay(o: RelayOptions): Promise<void> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? defaultSleep;
  const now = o.now ?? Date.now;
  const stallMs = o.stallMs ?? 120_000;
  const downAlertMs = o.downAlertMs ?? 5 * 60_000;
  let backoff = 1000;
  let downSince: number | null = null;

  while (!o.signal?.aborted) {
    const conn = new AbortController();
    const abortConn = () => conn.abort();
    o.signal?.addEventListener('abort', abortConn, { once: true });
    let stall: ReturnType<typeof setTimeout> | undefined;
    const armStall = () => {
      clearTimeout(stall);
      stall = setTimeout(() => conn.abort(), stallMs);
    };
    try {
      const url = `${o.server}/${o.topic}/json?since=${encodeURIComponent(o.since())}`;
      armStall();
      const res = await fetchImpl(url, { signal: conn.signal });
      if (!res.ok || !res.body) throw new Error(`ntfy subscribe returned ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        armStall();
        if (downSince !== null) {
          const down = now() - downSince;
          downSince = null;
          if (down >= downAlertMs) o.onRecovered?.(down);
        }
        backoff = 1000;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as NtfyEvent;
          if (ev.event === 'message') await o.onMessage(ev);
        }
      }
    } catch (e) {
      if (o.signal?.aborted) break;
      console.error('[relay] connection lost:', (e as Error).message);
    } finally {
      clearTimeout(stall);
      o.signal?.removeEventListener('abort', abortConn);
    }
    if (o.signal?.aborted) break;
    downSince ??= now();
    await sleep(backoff);
    backoff = Math.min(backoff * 2, 60_000);
  }
}
