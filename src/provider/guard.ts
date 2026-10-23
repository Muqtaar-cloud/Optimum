/**
 * The only path from the web page to the burner key. Pure decision logic:
 * given an EIP-1193 request, say whether it is read-only (forward to the RPC),
 * answered locally, an allowed signature/transaction, or refused.
 *
 * Allow-list only. Anything not explicitly permitted below is refused.
 */
import { hexToString, isHex } from 'viem';

export interface GuardPolicy {
  burner: `0x${string}`;
  chainId: number;
  /** Exact SIWE domain confirmed during setup. Unset → setup must confirm it. */
  siweDomain?: string;
  /** Stage 3 only: the mint transaction's `to` and 4-byte selector, from your own first mint. */
  mintTo?: `0x${string}`;
  mintSelector?: `0x${string}`;
}

export interface TxRequest {
  to: `0x${string}`;
  data: `0x${string}`;
  gas?: bigint;
}

export type Decision =
  | { kind: 'passthrough' }
  | { kind: 'result'; value: unknown }
  | { kind: 'sign-message'; message: string }
  | { kind: 'confirm-siwe-domain'; domain: string; message: string }
  | { kind: 'send-tx'; tx: TxRequest }
  | { kind: 'refuse'; code: number; reason: string };

/** Read-only JSON-RPC methods forwarded unchanged to the RPC endpoint. */
export const PASSTHROUGH = new Set([
  'eth_call',
  'eth_estimateGas',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_getTransactionReceipt',
  'eth_getTransactionCount',
  'eth_gasPrice',
  'eth_feeHistory',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getCode',
  'eth_getTransactionByHash',
  'eth_maxPriorityFeePerGas',
  'net_version',
]);

// EIP-1193 error codes
const USER_REJECTED = 4001;
const UNSUPPORTED = 4200;
const UNRECOGNISED_CHAIN = 4902;

const refuse = (reason: string, code = USER_REJECTED): Decision => ({ kind: 'refuse', code, reason });
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export interface Siwe {
  domain: string;
  address: string;
  chainId: number;
}

/** Parses the EIP-4361 header fields. Returns null if the message is not SIWE. */
export function parseSiwe(message: string): Siwe | null {
  const lines = message.replace(/\r\n/g, '\n').split('\n');
  const head = /^(\S+) wants you to sign in with your Ethereum account:$/.exec(lines[0] ?? '');
  const address = (lines[1] ?? '').trim();
  const chain = /^Chain ID: (\d+)$/m.exec(message);
  if (!head || !/^0x[0-9a-fA-F]{40}$/.test(address) || !chain) return null;
  return { domain: head[1], address, chainId: Number(chain[1]) };
}

function decodeMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (isHex(raw) && raw.length % 2 === 0) {
    try {
      return hexToString(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function personalSign(params: unknown[], p: GuardPolicy): Decision {
  // Spec order is [message, address]; some dapps send [address, message].
  const [a, b] = params as [unknown, unknown];
  const raw = same(String(b), p.burner) ? a : same(String(a), p.burner) ? b : undefined;
  if (raw === undefined) return refuse('personal_sign for an address that is not the burner');
  const message = decodeMessage(raw);
  if (message === null) return refuse('personal_sign payload could not be decoded');
  const siwe = parseSiwe(message);
  if (!siwe) return refuse(`personal_sign of a non-SIWE message: ${message.slice(0, 120)}`);
  if (!same(siwe.address, p.burner)) return refuse(`SIWE message is for ${siwe.address}, not the burner`);
  if (siwe.chainId !== p.chainId) return refuse(`SIWE message is for chain ${siwe.chainId}`);
  if (!p.siweDomain) return { kind: 'confirm-siwe-domain', domain: siwe.domain, message };
  if (siwe.domain !== p.siweDomain) return refuse(`SIWE domain "${siwe.domain}" is not the confirmed "${p.siweDomain}"`);
  return { kind: 'sign-message', message };
}

function sendTransaction(params: unknown[], p: GuardPolicy): Decision {
  const tx = (params[0] ?? {}) as Record<string, string | undefined>;
  const desc = `to=${tx.to} selector=${(tx.data ?? tx.input ?? '').slice(0, 10)} value=${tx.value ?? '0x0'}`;
  if (!p.mintTo || !p.mintSelector) return refuse(`auto-mint is off (stage < 3); page asked for ${desc}`);
  if (!same(tx.from, p.burner)) return refuse(`transaction from ${tx.from}, not the burner`);
  if (!same(tx.to, p.mintTo)) return refuse(`transaction is not to the allow-listed mint address: ${desc}`);
  const data = (tx.data ?? tx.input ?? '0x').toLowerCase() as `0x${string}`;
  if (!data.startsWith(p.mintSelector.toLowerCase())) return refuse(`transaction is not the allow-listed mint function: ${desc}`);
  let value: bigint;
  try {
    value = BigInt(tx.value ?? '0x0');
  } catch {
    return refuse(`unparseable value: ${desc}`);
  }
  if (value !== 0n) return refuse(`transaction sends ETH (value ${value}); the mint is free`);
  if (tx.chainId !== undefined && Number(tx.chainId) !== p.chainId) return refuse(`transaction for chain ${tx.chainId}`);
  return { kind: 'send-tx', tx: { to: p.mintTo, data, gas: tx.gas ? BigInt(tx.gas) : undefined } };
}

export function decide(method: string, params: unknown[] | undefined, p: GuardPolicy): Decision {
  const ps = Array.isArray(params) ? params : [];
  if (PASSTHROUGH.has(method)) return { kind: 'passthrough' };
  switch (method) {
    case 'eth_chainId':
      return { kind: 'result', value: `0x${p.chainId.toString(16)}` };
    case 'eth_accounts':
    case 'eth_requestAccounts':
      return { kind: 'result', value: [p.burner] };
    case 'wallet_switchEthereumChain': {
      const id = (ps[0] as { chainId?: string } | undefined)?.chainId;
      return id !== undefined && Number(id) === p.chainId
        ? { kind: 'result', value: null }
        : refuse(`switch to chain ${id} refused`, UNRECOGNISED_CHAIN);
    }
    case 'personal_sign':
      return personalSign(ps, p);
    case 'eth_sendTransaction':
      return sendTransaction(ps, p);
    default:
      // eth_sign, eth_signTypedData*, eth_signTransaction, wallet_addEthereumChain, permissions, ...
      return refuse(`method ${method} is not allowed`, UNSUPPORTED);
  }
}

export interface FeeCaps {
  maxFeeGwei: number;
  maxGasEth: number;
}

/** Returns null when the fee is within caps, otherwise why not. */
export function checkFees(gas: bigint, maxFeePerGas: bigint, caps: FeeCaps): string | null {
  const capWei = BigInt(Math.round(caps.maxFeeGwei * 1e9));
  if (maxFeePerGas > capWei) return `max fee ${Number(maxFeePerGas) / 1e9} gwei > cap ${caps.maxFeeGwei} gwei`;
  const total = gas * maxFeePerGas;
  const capTotal = BigInt(Math.round(caps.maxGasEth * 1e18));
  if (total > capTotal) return `worst-case gas ${Number(total) / 1e18} ETH > cap ${caps.maxGasEth} ETH`;
  return null;
}
