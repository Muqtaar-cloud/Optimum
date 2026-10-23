import type { Hash } from 'viem';
import { launch } from './browser.js';
import type { Config } from './config.js';
import type { Notifier } from './notify.js';
import { PageQueue } from './queue.js';
import type { QuestStatus } from './site.js';
import type { State } from './state.js';

const SESSION_CHECK_MS = 2 * 3_600_000;
const REFUSAL_ALERT_EVERY_MS = 10 * 60_000;
const TX_HASH_TIMEOUT_MS = 35 * 60_000;

/** Stage 2+: starts the browser and returns the function the relay handler calls with codes. */
export async function startBot(cfg: Config, state: State, notify: Notifier, signal: AbortSignal): Promise<(codes: string[]) => Promise<void>> {
  const lastRefusal = new Map<string, number>();
  let txWaiter: ((h: Hash) => void) | null = null;

  const { context, site, wallet } = await launch(cfg, {
    onRefuse: (method, reason) => {
      const key = `${method}:${reason.slice(0, 60)}`;
      if (Date.now() - (lastRefusal.get(key) ?? 0) < REFUSAL_ALERT_EVERY_MS) return;
      lastRefusal.set(key, Date.now());
      void notify.send({ title: 'Wallet guard refused a request', body: `${method}: ${reason}`, priority: 4, tags: ['no_entry'] });
    },
    onTx: (h) => txWaiter?.(h),
  });
  signal.addEventListener('abort', () => void context.close().catch(() => undefined));
  const who = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`;
  const queue = new PageQueue();

  // --- periodic session check: signed in + follow quest still done ---
  let last: { signedIn: boolean; quest: QuestStatus } | null = null;
  const sessionCheck = () =>
    queue
      .run(
        async (s) => {
          await site.open(s);
          const signedIn = await site.ensureSignedIn(s);
          const quest = signedIn ? await site.followQuestStatus() : 'unknown';
          const changed = !last || last.signedIn !== signedIn || last.quest !== quest;
          last = { signedIn, quest };
          if (!changed) return;
          if (!signedIn) {
            await notify.send({ title: 'Needs you: sign-in failed', body: `The bot could not sign in as ${who}. Screenshot: ${await site.screenshot('signin-failed')}`, priority: 5 });
          } else if (quest === 'not-done') {
            await notify.send({ title: 'Needs you: redo follow quest', body: 'The Follow Optimum quest no longer shows as done. Run npm run setup.', priority: 5 });
          } else if (quest === 'unknown') {
            await notify.send({ title: 'Session check: quest state unclear', body: `Signed in as ${who}, but could not read the follow quest. Screenshot: ${await site.screenshot('quest-unknown')}`, priority: 3 });
          } else {
            await notify.send({ title: 'Session OK', body: `Signed in as ${who}; follow quest done.`, priority: 2 });
          }
        },
        { cancellable: true },
      )
      .catch((e) => console.log('[session] check stopped:', (e as Error).message));
  void sessionCheck();
  const timer = setInterval(sessionCheck, SESSION_CHECK_MS);
  signal.addEventListener('abort', () => clearInterval(timer));

  // --- stage 3: mint one card on the scoped TurboCards element ---
  async function mint(): Promise<void> {
    const hash = await queue.run(async (s) => {
      await site.open(s);
      const got = new Promise<Hash>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('no mint transaction was sent')), TX_HASH_TIMEOUT_MS);
        txWaiter = (h) => (clearTimeout(t), resolve(h));
      });
      if (!(await site.clickMint(s))) throw new Error(`no enabled Mint Now button on a card containing "${cfg.mintCardText}"`);
      try {
        return await got;
      } finally {
        txWaiter = null;
      }
    });
    await notify.send({ title: 'Mint sent', body: `${hash}\nhttps://etherscan.io/tx/${hash}`, priority: 4, click: `https://etherscan.io/tx/${hash}` });
    const receipt = await wallet.publicClient.waitForTransactionReceipt({ hash, timeout: 30 * 60_000 });
    await notify.send({
      title: receipt.status === 'success' ? 'MINTED' : 'Mint transaction failed',
      body: `${who}\nhttps://etherscan.io/tx/${hash}`,
      priority: 5,
      click: `https://etherscan.io/tx/${hash}`,
    });
  }

  // --- the redeem path called by the relay handler ---
  return async (codes: string[]) => {
    for (const code of codes) {
      if (state.wasAttempted(code)) {
        console.log(`[redeem] ${code} already attempted, skipping`);
        continue;
      }
      let result;
      try {
        result = await queue.run(async (s) => {
          await site.open(s);
          if (!(await site.ensureSignedIn(s))) return null;
          // Recorded before submitting: a crash after this point can never resubmit the code.
          if (!cfg.dryRun) state.recordAttempt(code, 'submitting');
          return site.redeem(code, cfg.dryRun, s);
        });
      } catch (e) {
        await notify.send({ title: `Redeem error: ${code}`, body: `${(e as Error).message}\nEnter it by hand.`, priority: 5, click: cfg.walletDeeplink });
        return;
      }
      if (!result) {
        await notify.send({ title: `Needs you: not signed in (${code})`, body: `Sign-in failed, code NOT submitted. Enter ${code} by hand as ${who}.`, priority: 5, click: cfg.walletDeeplink });
        return;
      }
      if (!cfg.dryRun) state.recordAttempt(code, result.outcome);
      const shot = result.shot ? `\nScreenshot: ${result.shot}` : '';

      switch (result.outcome) {
        case 'dry-run':
          await notify.send({ title: 'dry run OK', body: `Typed ${code} into the code field as ${who}; not submitted.${shot}`, priority: 3 });
          return;
        case 'success':
          await notify.send({ title: `Code accepted: ${code}`, body: `Redeemed for ${wallet.address}.\nMint from THIS address.${shot}`, priority: 5, click: cfg.walletDeeplink });
          if (cfg.stage === 3) {
            await mint().catch((e) =>
              notify.send({ title: 'Mint failed: do it by hand', body: `${(e as Error).message}\nMint as ${who}.`, priority: 5, click: cfg.walletDeeplink }),
            );
          }
          return;
        case 'invalid':
          await notify.send({ title: `Code rejected: ${code}`, body: `Site said invalid: ${result.detail}${shot}`, priority: 4 });
          continue; // only an explicit "invalid" allows trying the next candidate
        default:
          await notify.send({
            title: `Needs you: ${result.outcome} (${code})`,
            body: `${result.detail}\nNo further attempts. Check the site as ${who}.${shot}`,
            priority: 5,
            click: cfg.walletDeeplink,
          });
          return;
      }
    }
  };
}
