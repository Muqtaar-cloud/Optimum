import { stringToHex } from 'viem';
import { describe, expect, it } from 'vitest';
import { checkFees, decide, parseSiwe, type GuardPolicy } from '../src/provider/guard.js';

const BURNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const MINT_TO = '0x3333333333333333333333333333333333333333';
const SEL = '0x1249c58b';
const DOMAIN = 'turbocards.getoptimum.xyz';

const base: GuardPolicy = { burner: BURNER, chainId: 1, siweDomain: DOMAIN };
const stage3: GuardPolicy = { ...base, mintTo: MINT_TO, mintSelector: SEL };

const siwe = (domain = DOMAIN, address = BURNER, chain = 1) =>
  `${domain} wants you to sign in with your Ethereum account:\n${address}\n\nSign in to Snag\n\nURI: https://${domain}\nVersion: 1\nChain ID: ${chain}\nNonce: abc123\nIssued At: 2026-10-22T00:00:00Z`;

const tx = (over: Record<string, string> = {}) => [{ from: BURNER, to: MINT_TO, data: `${SEL}0000`, value: '0x0', ...over }];

describe('guard: read-only and accounts', () => {
  it('passes read-only calls through', () => {
    for (const m of ['eth_call', 'eth_estimateGas', 'eth_blockNumber', 'eth_getBalance', 'eth_getTransactionReceipt', 'eth_getTransactionCount', 'eth_feeHistory', 'eth_getBlockByNumber', 'net_version']) {
      expect(decide(m, [], base).kind).toBe('passthrough');
    }
  });

  it('answers accounts and chain locally', () => {
    expect(decide('eth_requestAccounts', [], base)).toEqual({ kind: 'result', value: [BURNER] });
    expect(decide('eth_chainId', [], base)).toEqual({ kind: 'result', value: '0x1' });
  });

  it('allows switching only to mainnet', () => {
    expect(decide('wallet_switchEthereumChain', [{ chainId: '0x1' }], base).kind).toBe('result');
    expect(decide('wallet_switchEthereumChain', [{ chainId: '0x2105' }], base).kind).toBe('refuse');
  });
});

describe('guard: signing', () => {
  it('signs a SIWE message for the confirmed domain, hex or plain, either param order', () => {
    expect(decide('personal_sign', [stringToHex(siwe()), BURNER], base).kind).toBe('sign-message');
    expect(decide('personal_sign', [BURNER, siwe()], base).kind).toBe('sign-message');
  });

  it('asks for confirmation when no domain is confirmed yet', () => {
    const d = decide('personal_sign', [siwe(), BURNER], { ...base, siweDomain: undefined });
    expect(d).toMatchObject({ kind: 'confirm-siwe-domain', domain: DOMAIN });
  });

  it('refuses wrong domain, wrong address, wrong chain and non-SIWE text', () => {
    expect(decide('personal_sign', [siwe('evil.xyz'), BURNER], base).kind).toBe('refuse');
    expect(decide('personal_sign', [siwe(DOMAIN, OTHER), BURNER], base).kind).toBe('refuse');
    expect(decide('personal_sign', [siwe(), OTHER], base).kind).toBe('refuse');
    expect(decide('personal_sign', [siwe(DOMAIN, BURNER, 8453), BURNER], base).kind).toBe('refuse');
    expect(decide('personal_sign', ['Approve transfer of all tokens', BURNER], base).kind).toBe('refuse');
  });

  it('refuses every other signing method', () => {
    for (const m of ['eth_sign', 'eth_signTypedData', 'eth_signTypedData_v3', 'eth_signTypedData_v4', 'eth_signTransaction', 'wallet_addEthereumChain', 'wallet_requestPermissions']) {
      expect(decide(m, [BURNER, '0x00'], stage3).kind).toBe('refuse');
    }
  });
});

describe('guard: transactions', () => {
  it('allows only the allow-listed mint call', () => {
    expect(decide('eth_sendTransaction', tx(), stage3)).toMatchObject({ kind: 'send-tx', tx: { to: MINT_TO } });
  });

  it('refuses all transactions before stage 3', () => {
    expect(decide('eth_sendTransaction', tx(), base).kind).toBe('refuse');
  });

  it('refuses value, wrong selector on the right contract, wrong to, wrong from', () => {
    expect(decide('eth_sendTransaction', tx({ value: '0x1' }), stage3).kind).toBe('refuse');
    // setApprovalForAll(address,bool) to the allow-listed address
    expect(decide('eth_sendTransaction', tx({ data: '0xa22cb465' + '00'.repeat(64) }), stage3).kind).toBe('refuse');
    expect(decide('eth_sendTransaction', tx({ to: OTHER }), stage3).kind).toBe('refuse');
    expect(decide('eth_sendTransaction', tx({ from: OTHER }), stage3).kind).toBe('refuse');
    expect(decide('eth_sendTransaction', tx({ chainId: '0x2105' }), stage3).kind).toBe('refuse');
  });
});

describe('checkFees', () => {
  const caps = { maxFeeGwei: 30, maxGasEth: 0.005 };
  it('accepts fees within caps', () => {
    expect(checkFees(150_000n, 20n * 10n ** 9n, caps)).toBeNull();
  });
  it('refuses a max fee over the gwei cap', () => {
    expect(checkFees(150_000n, 31n * 10n ** 9n, caps)).toMatch(/gwei/);
  });
  it('refuses a total over the ETH cap', () => {
    expect(checkFees(1_000_000n, 25n * 10n ** 9n, caps)).toMatch(/ETH/);
  });
});

describe('parseSiwe', () => {
  it('reads domain, address and chain', () => {
    expect(parseSiwe(siwe())).toEqual({ domain: DOMAIN, address: BURNER, chainId: 1 });
    expect(parseSiwe('hello')).toBeNull();
  });
});
