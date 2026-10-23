import { createPublicClient, createWalletClient, http, type Hash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { checkFees, decide, type FeeCaps, type GuardPolicy } from './guard.js';

export class ProviderError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

export interface WalletOptions {
  key: `0x${string}`;
  rpcUrl: string;
  policy: Omit<GuardPolicy, 'burner'>;
  caps: FeeCaps;
  /** Called for every refusal so it can reach the phone (rate-limited by the caller). */
  onRefuse: (method: string, reason: string) => void;
  /** Setup only: ask the human to confirm a SIWE domain seen for the first time. */
  confirmDomain?: (domain: string, message: string) => Promise<boolean>;
  onTx?: (hash: Hash) => void;
  sleep?: (ms: number) => Promise<void>;
}

const FEE_RETRY_MS = 60_000;
const FEE_RETRY_LIMIT = 30;

export function createGuardedWallet(o: WalletOptions) {
  const account = privateKeyToAccount(o.key);
  const transport = http(o.rpcUrl);
  const pub = createPublicClient({ chain: mainnet, transport });
  const wallet = createWalletClient({ chain: mainnet, transport, account });
  const policy: GuardPolicy = { ...o.policy, burner: account.address };
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const fail = (method: string, code: number, reason: string): never => {
    o.onRefuse(method, reason);
    throw new ProviderError(code, `TurboBot guard: ${reason}`);
  };

  async function request(method: string, params?: unknown[]): Promise<unknown> {
    const d = decide(method, params, policy);
    switch (d.kind) {
      case 'passthrough':
        return pub.request({ method, params } as never);
      case 'result':
        return d.value;
      case 'sign-message':
        return account.signMessage({ message: d.message });
      case 'confirm-siwe-domain': {
        if (!o.confirmDomain || !(await o.confirmDomain(d.domain, d.message))) {
          return fail(method, 4001, `SIWE domain "${d.domain}" not confirmed (run npm run setup)`);
        }
        policy.siweDomain = d.domain;
        return account.signMessage({ message: d.message });
      }
      case 'send-tx': {
        const gas = d.tx.gas ?? (await pub.estimateGas({ account, to: d.tx.to, data: d.tx.data, value: 0n }));
        for (let i = 0; ; i++) {
          const fees = await pub.estimateFeesPerGas();
          const why = checkFees(gas, fees.maxFeePerGas, o.caps);
          if (!why) {
            const hash = await wallet.sendTransaction({
              to: d.tx.to,
              data: d.tx.data,
              value: 0n,
              gas,
              maxFeePerGas: fees.maxFeePerGas,
              maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
            });
            o.onTx?.(hash);
            return hash;
          }
          if (i >= FEE_RETRY_LIMIT) return fail(method, 4001, `gas stayed above cap for 30 min (${why})`);
          if (i === 0) o.onRefuse(method, `waiting: ${why}; retrying every minute for 30 min`);
          await sleep(FEE_RETRY_MS);
        }
      }
      case 'refuse':
        return fail(method, d.code, d.reason);
    }
  }

  return { address: account.address, policy, request, publicClient: pub };
}

export type GuardedWallet = ReturnType<typeof createGuardedWallet>;
