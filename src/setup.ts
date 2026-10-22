/**
 * One-time setup (`npm run setup`): signs the burner in through the guard,
 * asks you to confirm the SIWE domain, and waits while you do the Follow
 * Optimum quest by hand in the bot's own browser window.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { privateKeyToAccount } from 'viem/accounts';
import { launch } from './browser.js';
import { ConfigError, loadConfig, localPath } from './config.js';
import { acquireLock, releaseLock } from './lock.js';
import { ntfyNotifier } from './notify.js';

async function setup(): Promise<void> {
  const env = { ...process.env, STAGE: process.env.STAGE === '3' ? '3' : '2' };
  const cfg = loadConfig(env);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q: string) => (await rl.question(q)).trim().toLowerCase();

  const address = privateKeyToAccount(cfg.burnerKey!).address;
  console.log(`\nBurner address from BURNER_KEY: ${address}`);
  if ((await ask('Is this your FRESH, funded test wallet (not your main wallet)? Type yes: ')) !== 'yes') {
    console.log('Stopped. Fix BURNER_KEY in .env.');
    process.exit(2);
  }

  const pidPath = join(cfg.dataDir, 'bot.pid');
  if (!acquireLock(pidPath)) {
    console.error('The bot is running. Stop it (close run-bot.bat) before running setup.');
    process.exit(3);
  }
  process.on('exit', () => releaseLock(pidPath));

  const { context, site } = await launch(cfg, {
    onRefuse: (method, reason) => console.log(`[guard] refused ${method}: ${reason}`),
    confirmDomain: async (domain, message) => {
      console.log(`\nThe site asks the burner to sign in. Message starts:\n---\n${message.split('\n').slice(0, 6).join('\n')}\n---`);
      console.log(`SIWE domain: ${domain}`);
      const ok = (await ask('Is this the TurboCards/Snag sign-in you expect? Type yes to trust this domain: ')) === 'yes';
      if (ok) {
        mkdirSync(cfg.dataDir, { recursive: true });
        writeFileSync(localPath(cfg.dataDir), JSON.stringify({ siweDomain: domain }, null, 2));
        console.log(`Saved SIWE domain to ${localPath(cfg.dataDir)}`);
      }
      return ok;
    },
  });

  await site.open();
  console.log('\nConnecting the TurboBot wallet...');
  const signedIn = await site.ensureSignedIn();
  console.log(signedIn ? 'Signed in.' : 'Automatic sign-in did not finish. Connect "TurboBot" by hand in the browser window.');

  console.log('\nIn the browser window:');
  console.log('  1. If not signed in, click Connect Wallet and pick "TurboBot".');
  console.log('  2. Do the "Follow Optimum" quest and authorise X when asked.');
  console.log('  3. Do NOT enter any code here.');
  await rl.question('Press Enter when the follow quest shows as done... ');

  await site.open();
  const quest = await site.followQuestStatus();
  console.log(`Follow quest status as the bot reads it: ${quest}`);
  if (quest !== 'done') console.log(`Screenshot for checking: ${await site.screenshot('setup-quest')}`);

  await ntfyNotifier(cfg.ntfyServer, cfg.topicOut).send({
    title: 'Setup finished',
    body: `Burner ${address} signed in; follow quest: ${quest}. You should see this on your phone.`,
    priority: 3,
  });
  await context.close();
  rl.close();
  console.log('\nDone. Next: set STAGE=2 and DRY_RUN=1 in .env and start run-bot.bat for the dry run.');
}

setup().catch((e) => {
  console.error(e instanceof ConfigError ? `Config error: ${e.message}` : e);
  process.exit(e instanceof ConfigError ? 2 : 1);
});
