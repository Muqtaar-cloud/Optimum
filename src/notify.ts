export interface Alert {
  title: string;
  body: string;
  /** ntfy priority 1–5. 5 makes the phone ring through most quiet modes. */
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  /** URL opened when the notification is tapped. */
  click?: string;
}

export interface Notifier {
  send(alert: Alert): Promise<void>;
}

type FetchLike = typeof fetch;

/** HTTP headers must be ASCII; keep titles readable without emoji. */
function ascii(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, '').trim() || 'TurboBot';
}

export function ntfyNotifier(server: string, topic: string, fetchImpl: FetchLike = fetch): Notifier {
  return {
    async send(a) {
      const headers: Record<string, string> = { Title: ascii(a.title), Priority: String(a.priority ?? 3) };
      if (a.tags?.length) headers.Tags = a.tags.join(',');
      if (a.click) headers.Click = a.click;
      try {
        const res = await fetchImpl(`${server}/${topic}`, { method: 'POST', headers, body: a.body });
        if (!res.ok) console.error(`[notify] ntfy returned ${res.status}`);
      } catch (e) {
        // Nothing else can carry an alert; the missing heartbeat replies are the signal.
        console.error('[notify] failed to send:', (e as Error).message);
      }
      console.log(`[alert] ${a.title}: ${a.body.replace(/\n/g, ' | ')}`);
    },
  };
}
