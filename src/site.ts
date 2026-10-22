/**
 * Browser steps on the Snag mint page. Selectors are text/role based guesses
 * (the page could not be inspected from where this was written), so every
 * step screenshots on failure and anything unexpected stops and alerts.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from 'playwright-core';

export type RedeemOutcome = 'success' | 'invalid' | 'used' | 'ratelimited' | 'unknown' | 'dry-run' | 'no-code-field';
export type QuestStatus = 'done' | 'not-done' | 'unknown';

/** Classifies only text that appeared after submitting, so static page copy can't match. */
export function classifyRedeemResponse(newText: string): Exclude<RedeemOutcome, 'dry-run' | 'no-code-field'> {
  const t = newText.toLowerCase();
  if (/too many|rate limit|try again later|slow down/.test(t)) return 'ratelimited';
  if (/already (been )?(used|redeemed|claimed)|has been used|no longer valid|expired/.test(t)) return 'used';
  if (/invalid|incorrect|wrong code|not (a )?valid|not found|doesn'?t exist|does not exist/.test(t)) return 'invalid';
  if (/success|claimed|completed|unlocked|verified|congrat|redeemed/.test(t)) return 'success';
  return 'unknown';
}

export function newLines(before: string, after: string): string {
  const seen = new Set(before.split('\n').map((l) => l.trim()));
  return after
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !seen.has(l))
    .join('\n');
}

export interface SiteOptions {
  mintUrl: string;
  walletOptionText: string;
  mintCardText: string;
  shotDir: string;
}

const STEP_MS = 15_000;


export class Site {
  constructor(readonly page: Page, readonly o: SiteOptions) {}

  async screenshot(tag: string): Promise<string> {
    mkdirSync(this.o.shotDir, { recursive: true });
    const file = join(this.o.shotDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${tag}.png`);
    await this.page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
    return file;
  }

  async open(signal?: AbortSignal): Promise<void> {
    if (!this.page.url().startsWith(this.o.mintUrl)) {
      await this.page.goto(this.o.mintUrl, { waitUntil: 'domcontentloaded' });
    } else {
      await this.page.reload({ waitUntil: 'domcontentloaded' });
    }
    signal?.throwIfAborted();
    await this.page.waitForLoadState('networkidle', { timeout: STEP_MS }).catch(() => undefined);
  }

  private async visible(l: Locator, timeout = 3000): Promise<boolean> {
    return l.first().isVisible({ timeout }).catch(() => false);
  }

  /** Connects the injected TurboBot wallet and completes sign-in. SIWE signing goes through the guard. */
  async ensureSignedIn(signal?: AbortSignal): Promise<boolean> {
    // Exact names only, so this can never hit a "Connect X"/"Connect Discord" quest button.
    const connect = this.page.getByRole('button', { name: /^\s*(connect( wallet)?|sign in|log in)\s*$/i });
    if (!(await this.visible(connect))) return true;
    await connect.first().click();
    signal?.throwIfAborted();
    const option = this.page.getByText(new RegExp(this.o.walletOptionText, 'i'));
    if (await this.visible(option, 5000)) await option.first().click();
    signal?.throwIfAborted();
    // Some flows need an explicit "Sign"/"Verify" step after connecting.
    const sign = this.page.getByRole('button', { name: /^(sign( in| message)?|verify|continue)$/i });
    if (await this.visible(sign, 5000)) await sign.first().click();
    for (let i = 0; i < 20; i++) {
      signal?.throwIfAborted();
      if (!(await this.visible(connect, 500))) return true;
      await this.page.waitForTimeout(1000);
    }
    return false;
  }

  /** Reads whether the follow-Optimum quest shows as done. */
  async followQuestStatus(): Promise<QuestStatus> {
    const label = this.page.getByText(/follow\s+(@?get_)?optimum/i).first();
    if (!(await this.visible(label))) return 'unknown';
    const card = label.locator('xpath=ancestor::*[.//button or .//*[contains(@class,"check")] or .//svg][1]');
    const text = ((await card.first().innerText().catch(() => '')) || '').toLowerCase();
    if (/completed|claimed|done|✓|✔/.test(text)) return 'done';
    if (/claim|follow|start|go/.test(text)) return 'not-done';
    return 'unknown';
  }

  private async codeField(): Promise<Locator | null> {
    const scopes = [this.page.getByRole('dialog'), this.page.locator('body')];
    for (const s of scopes) {
      const byPlaceholder = s.getByPlaceholder(/code/i);
      if (await this.visible(byPlaceholder, 1500)) return byPlaceholder.first();
      const box = s.getByRole('textbox');
      if (await this.visible(box, 1500)) return box.first();
    }
    return null;
  }

  async redeem(code: string, dryRun: boolean, signal?: AbortSignal): Promise<{ outcome: RedeemOutcome; detail: string; shot?: string }> {
    let field = await this.codeField();
    if (!field) {
      const quest = this.page.getByText(/enter (a |the )?code/i).first();
      if (await this.visible(quest)) {
        await quest.click();
        await this.page.waitForTimeout(1000);
        field = await this.codeField();
        if (!field) {
          // The label itself may not be clickable; use the button in the same quest card.
          const button = quest.locator('xpath=ancestor::*[.//button][1]').getByRole('button').first();
          if (await this.visible(button, 1000)) await button.click();
          await this.page.waitForTimeout(1000);
          field = await this.codeField();
        }
      }
      signal?.throwIfAborted();
    }
    if (!field) return { outcome: 'no-code-field', detail: 'could not find the code input', shot: await this.screenshot('no-code-field') };

    await field.fill(code);
    signal?.throwIfAborted();
    if (dryRun) return { outcome: 'dry-run', detail: 'code typed, not submitted', shot: await this.screenshot('dry-run') };

    const before = await this.page.locator('body').innerText();
    const dialog = this.page.getByRole('dialog');
    const scope = (await this.visible(dialog, 500)) ? dialog : this.page.locator('body');
    const submit = scope.getByRole('button', { name: /submit|claim|verify|redeem|enter|confirm|apply/i });
    if (await this.visible(submit, 2000)) await submit.first().click();
    else await field.press('Enter');

    const deadline = Date.now() + STEP_MS;
    let added = '';
    while (Date.now() < deadline) {
      await this.page.waitForTimeout(500);
      added = newLines(before, await this.page.locator('body').innerText().catch(() => before));
      const outcome = classifyRedeemResponse(added);
      if (outcome !== 'unknown') return { outcome, detail: added.slice(0, 300), shot: await this.screenshot(`redeem-${outcome}`) };
    }
    return { outcome: 'unknown', detail: added.slice(0, 300) || 'no visible response', shot: await this.screenshot('redeem-unknown') };
  }

  /**
   * Clicks "Mint Now" on one enabled TurboCards card only. A card is the
   * largest ancestor of the button that contains exactly one Mint Now button.
   */
  async clickMint(signal?: AbortSignal): Promise<boolean> {
    const buttons = this.page.getByRole('button', { name: /mint now/i });
    const n = await buttons.count();
    for (let i = 0; i < n; i++) {
      signal?.throwIfAborted();
      const b = buttons.nth(i);
      if (!(await b.isEnabled().catch(() => false)) || !(await b.isVisible().catch(() => false))) continue;
      // No named helpers inside: tsx/esbuild would wrap them in a __name() that doesn't exist in the page.
      const cardText = await b.evaluate((el) => {
        let card: Element = el;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (Array.from(p.querySelectorAll('button')).filter((x) => /mint now/i.test(x.textContent || '')).length > 1) break;
          card = p;
        }
        return card.textContent || '';
      });
      if (!cardText.toLowerCase().includes(this.o.mintCardText.toLowerCase())) continue;
      await b.click();
      return true;
    }
    return false;
  }
}
