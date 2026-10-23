import { describe, expect, it } from 'vitest';
import { classifyTrust, cleanField, extract } from '../src/extract.js';

const IGNORE = ['liked your', 'reposted your', 'quoted your', 'mentioned you'];
const n = (big: string, title = 'Optimum', text = big) => ({ title, text, big });

describe('extract', () => {
  it('accepts a code that is the last token', () => {
    const x = extract(n('Code: TURBO42'));
    expect(x.redeem).toEqual(['TURBO42']);
    expect(x.autoOk).toBe(true);
    expect(x.truncated).toBe(false);
  });

  it('handles "code is", arrows and quotes', () => {
    expect(extract(n('The first code is OPT-7Q2K. Go!')).redeem).toEqual(['OPT-7Q2K']);
    expect(extract(n('First code 👉 ABC123 good luck')).redeem).toEqual(['ABC123']);
    expect(extract(n('Enter "MainnetDay" in the code quest')).redeem).toEqual(['MainnetDay']);
  });

  it('finds no code in a decoy announcement', () => {
    const x = extract(n('Codes drop Friday 10/23 at 3pm ET. Stay tuned!'));
    expect(x.candidates).toEqual([]);
    expect(x.autoOk).toBe(false);
    expect(x.mentionsCode).toBe(true);
  });

  it('does not auto-claim when the post never says "code"', () => {
    const x = extract(n('Mainnet is LIVE. TURBO2026 vibes'));
    expect(x.candidates).toContain('TURBO2026');
    expect(x.autoOk).toBe(false);
  });

  it('treats an ellipsis ending as truncated', () => {
    const x = extract(n('Huge day for Optimum, here is the code: ABC1…'));
    expect(x.truncated).toBe(true);
    expect(x.autoOk).toBe(false);
  });

  it('treats a missing expanded text as truncated', () => {
    const x = extract({ title: 'Optimum', text: 'Code: ABC123', big: '[notification_big_text]' });
    expect(x.truncated).toBe(true);
    expect(x.autoOk).toBe(false);
    expect(x.candidates).toEqual(['ABC123']);
  });

  it('accepts a thread reply that starts with a mention', () => {
    const x = extract(n('@someone @get_optimum Code: XYZ789'));
    expect(x.redeem).toEqual(['XYZ789']);
    expect(x.autoOk).toBe(true);
  });

  it('caps submissions at two and refuses ambiguous loose tokens', () => {
    expect(extract(n('Codes: AAA111 and code BBB222 and code CCC333')).redeem).toHaveLength(2);
    const loose = extract(n('Use one code from AAA111 BBB222 CCC333 DDD444'));
    expect(loose.autoOk).toBe(false);
  });

  it('flags bundled summaries', () => {
    const x = extract(n('3 new posts from Optimum and others'));
    expect(x.bundled).toBe(true);
    expect(x.autoOk).toBe(false);
  });

  it('ignores urls, hashtags and cashtags', () => {
    const x = extract(n('code: QWE123 https://t.co/AbC123xyz #Mint2026 $ETH'));
    expect(x.candidates).toEqual(['QWE123']);
  });

  it('yields nothing for an empty post', () => {
    expect(extract(n('gm')).candidates).toEqual([]);
  });
});

describe('classifyTrust', () => {
  it('verifies an exact title', () => {
    expect(classifyTrust(n('x'), 'Optimum', IGNORE).trust).toBe('verified');
  });

  it('marks a changed display name as unverified, not ignored', () => {
    expect(classifyTrust(n('x', 'Optimum 🟢'), 'Optimum', IGNORE).trust).toBe('unverified');
    expect(classifyTrust(n('x', 'Optimum | TurboCards live'), 'Optimum', IGNORE).trust).toBe('unverified');
  });

  it('ignores likes and unrelated titles', () => {
    expect(classifyTrust(n('Optimum Fan liked your post', 'Optimum Fan'), 'Optimum', IGNORE).trust).toBe('ignored');
    expect(classifyTrust(n('code: ABC123', 'Random'), 'Optimum', IGNORE).trust).toBe('ignored');
  });

  it('never drops an exact-title post on an ignore phrase', () => {
    expect(classifyTrust(n('Optimum quoted your post. Code: AB12CD'), 'Optimum', IGNORE).trust).toBe('unverified');
  });
});

describe('cleanField', () => {
  it('blanks unresolved MacroDroid variables', () => {
    expect(cleanField('[notification_big_text]')).toBe('');
    expect(cleanField(' hi ')).toBe('hi');
  });
});
