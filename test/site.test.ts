import { describe, expect, it } from 'vitest';
import { classifyRedeemResponse, newLines } from '../src/site.js';

describe('classifyRedeemResponse', () => {
  it('maps site responses', () => {
    expect(classifyRedeemResponse('Invalid code')).toBe('invalid');
    expect(classifyRedeemResponse('This code has already been used')).toBe('used');
    expect(classifyRedeemResponse('Too many attempts, try again later')).toBe('ratelimited');
    expect(classifyRedeemResponse('Code redeemed successfully!')).toBe('success');
    expect(classifyRedeemResponse('Quest completed')).toBe('success');
    expect(classifyRedeemResponse('Something happened')).toBe('unknown');
    expect(classifyRedeemResponse('')).toBe('unknown');
  });
});

describe('newLines', () => {
  it('ignores text that was already on the page', () => {
    const before = 'Follow Optimum\nCompleted\nEnter a Code';
    expect(newLines(before, `${before}\nInvalid code`)).toBe('Invalid code');
    expect(classifyRedeemResponse(newLines(before, before))).toBe('unknown');
  });
});
