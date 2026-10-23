/**
 * One page, one actor. Every browser action goes through here. A task marked
 * `cancellable` (the periodic session check) is aborted when an urgent task
 * (a redeem) arrives, so a code never waits behind housekeeping.
 */
export class PageQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private current: { ctrl: AbortController; cancellable: boolean } | null = null;

  run<T>(task: (signal: AbortSignal) => Promise<T>, opts: { cancellable?: boolean } = {}): Promise<T> {
    if (!opts.cancellable && this.current?.cancellable) this.current.ctrl.abort(new Error('preempted by redeem'));
    const next = this.tail.then(async () => {
      const ctrl = new AbortController();
      this.current = { ctrl, cancellable: !!opts.cancellable };
      try {
        return await task(ctrl.signal);
      } finally {
        this.current = null;
      }
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
}
