import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError, loadConfig } from './config.js';
import { checkWatchdogs, createHandler, type WatchdogState } from './handler.js';
import { acquireLock, releaseLock } from './lock.js';
import { ntfyNotifier } from './notify.js';
import { runRelay } from './relay.js';
import { State } from './state.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const stopFile = join(cfg.dataDir, 'STOP');
  if (existsSync(stopFile)) {
    console.error(`Kill switch: ${stopFile} exists. Delete it to run the bot.`);
    process.exit(4);
  }
  const pidPath = join(cfg.dataDir, 'bot.pid');
  if (!acquireLock(pidPath)) {
    console.error(`Another bot is already running (see ${pidPath}). Exiting.`);
    process.exit(3);
  }
  const stop = new AbortController();
  const shutdown = () => {
    stop.abort();
    releaseLock(pidPath);
  };
  process.on('SIGINT', () => (shutdown(), process.exit(0)));
  process.on('SIGTERM', () => (shutdown(), process.exit(0)));
  process.on('exit', () => releaseLock(pidPath));

  const state = new State(join(cfg.dataDir, 'state.json'));
  state.save();
  const notify = ntfyNotifier(cfg.ntfyServer, cfg.topicOut);

  let autoRedeem: ((codes: string[]) => Promise<void>) | undefined;
  if (cfg.stage >= 2) {
    const { startBot } = await import('./bot.js');
    try {
      autoRedeem = await startBot(cfg, state, notify, stop.signal);
    } catch (e) {
      // Never let a browser problem take down the code alerts.
      await notify.send({
        title: 'Auto-redeem failed to start',
        body: `${(e as Error).message}\nRunning in stage 1 (alerts only). Fix and restart.`,
        priority: 5,
      });
    }
  }

  await notify.send({
    title: `TurboBot started (stage ${cfg.stage}${cfg.dryRun ? ', DRY RUN' : ''})`,
    body: `Watching ntfy topic for @get_optimum codes.\nCodes attempted so far: ${Object.keys(state.data.attempted).length}`,
    priority: 2,
  });

  const watchdog: WatchdogState = { seenAlerted: false };
  const timer = setInterval(() => void checkWatchdogs(state, notify, watchdog), 15 * 60_000);
  const killSwitch = setInterval(async () => {
    if (!existsSync(stopFile)) return;
    await notify.send({ title: 'TurboBot stopped', body: `Kill switch file ${stopFile} found.`, priority: 4 });
    shutdown();
    process.exit(4);
  }, 5_000);
  stop.signal.addEventListener('abort', () => (clearInterval(timer), clearInterval(killSwitch)));

  await runRelay({
    server: cfg.ntfyServer,
    topic: cfg.topicIn,
    since: () => state.data.lastId ?? '10m',
    onMessage: createHandler({ cfg, state, notify, autoRedeem }),
    onRecovered: (ms) =>
      void notify.send({ title: 'Relay reconnected', body: `ntfy stream was down ${Math.round(ms / 60_000)} min; missed posts were replayed.`, priority: 3 }),
    signal: stop.signal,
  });
}

main().catch((e) => {
  if (e instanceof ConfigError) {
    console.error(`Config error: ${e.message}`);
    process.exit(2);
  }
  console.error(e);
  process.exit(1);
});
