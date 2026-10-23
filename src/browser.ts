import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { CHAIN_ID, type Config } from './config.js';
import { clearChromeLocks } from './lock.js';
import { installProvider } from './provider/inject.js';
import { createGuardedWallet, type GuardedWallet, type WalletOptions } from './provider/wallet.js';
import { Site } from './site.js';

export interface Launched {
  context: BrowserContext;
  page: Page;
  site: Site;
  wallet: GuardedWallet;
}

/**
 * Opens the bot's own Chrome profile with the guarded wallet injected.
 * Caller must already hold the single-instance lock.
 */
export async function launch(
  cfg: Config,
  hooks: Pick<WalletOptions, 'onRefuse' | 'confirmDomain' | 'onTx'>,
): Promise<Launched> {
  const wallet = createGuardedWallet({
    key: cfg.burnerKey!,
    rpcUrl: cfg.rpcUrl!,
    policy: { chainId: CHAIN_ID, siweDomain: cfg.siweDomain, mintTo: cfg.stage === 3 ? cfg.mintTo : undefined, mintSelector: cfg.stage === 3 ? cfg.mintSelector : undefined },
    caps: { maxFeeGwei: cfg.maxFeeGwei, maxGasEth: cfg.maxGasEth },
    ...hooks,
  });

  const profileDir = join(cfg.dataDir, 'profile');
  clearChromeLocks(profileDir);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    // Installed Chrome is far less likely to be challenged by X's login than bundled Chromium.
    ...(cfg.browserPath ? { executablePath: cfg.browserPath } : { channel: 'chrome' }),
    viewport: null,
  });
  await installProvider(context, wallet.request);
  const page = context.pages()[0] ?? (await context.newPage());
  const site = new Site(page, {
    mintUrl: cfg.mintUrl,
    walletOptionText: cfg.walletOptionText,
    mintCardText: cfg.mintCardText,
    shotDir: join(cfg.dataDir, 'screenshots'),
  });
  return { context, page, site, wallet };
}
