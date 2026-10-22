import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Stage = 1 | 2 | 3;

export const MINT_URL = 'https://turbocards.getoptimum.xyz/optimum';
export const NFT_CONTRACT = '0xb7d55b938ccf4be5e51c8a4c7cf975b744055d6e';
export const CHAIN_ID = 1;

export interface Config {
  stage: Stage;
  dryRun: boolean;
  dataDir: string;
  ntfyServer: string;
  topicIn: string;
  topicOut: string;
  relayToken: string;
  xDisplayName: string;
  ignorePhrases: string[];
  walletDeeplink: string;
  mintUrl: string;
  // Stage 2+
  burnerKey?: `0x${string}`;
  rpcUrl?: string;
  siweDomain?: string;
  maxFeeGwei: number;
  maxGasEth: number;
  browserPath?: string;
  walletOptionText: string;
  // Stage 3
  mintTo?: `0x${string}`;
  mintSelector?: `0x${string}`;
  mintCardText: string;
}

export class ConfigError extends Error {}

const DEFAULT_IGNORE = ['liked your', 'reposted your', 'quoted your', 'mentioned you'];

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key]?.trim();
  if (!v) throw new ConfigError(`${key} is not set in .env`);
  return v;
}

function hex(env: NodeJS.ProcessEnv, key: string, len?: number): `0x${string}` | undefined {
  const v = env[key]?.trim();
  if (!v) return undefined;
  const re = len ? new RegExp(`^0x[0-9a-fA-F]{${len}}$`) : /^0x[0-9a-fA-F]+$/;
  if (!re.test(v)) throw new ConfigError(`${key} must be 0x-prefixed hex${len ? ` (${len} hex chars)` : ''}`);
  return v.toLowerCase() as `0x${string}`;
}

function num(env: NodeJS.ProcessEnv, key: string, def: number): number {
  const v = env[key]?.trim();
  if (!v) return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new ConfigError(`${key} must be a positive number`);
  return n;
}

/** Values written by `npm run setup` (e.g. the confirmed SIWE domain). */
export function localPath(dataDir: string): string {
  return join(dataDir, 'local.json');
}

function readLocal(dataDir: string): { siweDomain?: string } {
  const p = localPath(dataDir);
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const stageRaw = env.STAGE?.trim() || '1';
  if (!['1', '2', '3'].includes(stageRaw)) throw new ConfigError('STAGE must be 1, 2 or 3');
  const stage = Number(stageRaw) as Stage;
  const dataDir = env.DATA_DIR?.trim() || 'data';

  const relayToken = required(env, 'RELAY_TOKEN');
  if (relayToken.length < 16) throw new ConfigError('RELAY_TOKEN must be at least 16 characters');
  const topicIn = required(env, 'NTFY_TOPIC_IN');
  const topicOut = required(env, 'NTFY_TOPIC_OUT');
  if (topicIn.length < 20 || topicOut.length < 20) {
    throw new ConfigError('NTFY topics must be long random names (20+ characters); anyone who knows one can read or post to it');
  }

  const cfg: Config = {
    stage,
    dryRun: env.DRY_RUN === '1' || env.DRY_RUN === 'true',
    dataDir,
    ntfyServer: (env.NTFY_SERVER?.trim() || 'https://ntfy.sh').replace(/\/+$/, ''),
    topicIn,
    topicOut,
    relayToken,
    xDisplayName: required(env, 'X_DISPLAY_NAME'),
    ignorePhrases: env.IGNORE_PHRASES
      ? env.IGNORE_PHRASES.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      : DEFAULT_IGNORE,
    walletDeeplink: env.WALLET_DEEPLINK?.trim() || MINT_URL,
    mintUrl: MINT_URL,
    burnerKey: hex(env, 'BURNER_KEY', 64),
    rpcUrl: env.RPC_URL?.trim() || undefined,
    siweDomain: env.SIWE_DOMAIN?.trim() || readLocal(dataDir).siweDomain,
    maxFeeGwei: num(env, 'MAX_FEE_GWEI', 30),
    maxGasEth: num(env, 'MAX_GAS_ETH', 0.005),
    browserPath: env.BROWSER_PATH?.trim() || undefined,
    walletOptionText: env.WALLET_OPTION_TEXT?.trim() || 'TurboBot|Browser Wallet|Injected',
    mintTo: hex(env, 'MINT_TO', 40),
    mintSelector: hex(env, 'MINT_SELECTOR', 8),
    mintCardText: env.MINT_CARD_TEXT?.trim() || 'Turbo',
  };

  if (stage >= 2) {
    if (!cfg.burnerKey) throw new ConfigError('STAGE>=2 needs BURNER_KEY (the funded test wallet, never your main wallet)');
    if (!cfg.rpcUrl) throw new ConfigError('STAGE>=2 needs RPC_URL (an Ethereum mainnet RPC endpoint)');
  }
  if (stage === 3 && (!cfg.mintTo || !cfg.mintSelector)) {
    throw new ConfigError('STAGE=3 needs MINT_TO and MINT_SELECTOR, copied from your own first mint tx on Etherscan');
  }
  return cfg;
}
