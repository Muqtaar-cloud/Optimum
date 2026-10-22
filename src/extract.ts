/**
 * Turns a forwarded X notification into code candidates, and decides whether
 * it is safe to act on automatically. Anything uncertain degrades to "push it
 * to the phone and let a human look", never to a silent drop.
 */

export interface XNotification {
  title: string;
  text: string;
  big: string;
}

export type Trust = 'verified' | 'unverified' | 'ignored';

export interface TrustResult {
  trust: Trust;
  reason: string;
}

export interface Extraction {
  /** Every plausible code, for display. */
  candidates: string[];
  /** The ≤2 candidates the bot may submit, in order. Empty when autoOk is false. */
  redeem: string[];
  /** True when the text is complete and the code is unambiguous enough to auto-submit. */
  autoOk: boolean;
  truncated: boolean;
  bundled: boolean;
  mentionsCode: boolean;
  reason: string;
}

const MAX_REDEEM = 2;

/** MacroDroid leaves `[variable_name]` in place when a magic-text variable is unavailable. */
export function cleanField(v: string | undefined): string {
  const s = (v ?? '').trim();
  return /^\[[a-z0-9_]+\]$/i.test(s) ? '' : s;
}

export function classifyTrust(n: XNotification, displayName: string, ignorePhrases: string[]): TrustResult {
  const title = n.title.trim();
  const body = `${n.text}\n${n.big}`.toLowerCase();
  const hit = ignorePhrases.find((p) => title.toLowerCase().includes(p) || body.includes(p));
  const exact = title === displayName.trim();
  // An exact-title notification is never dropped silently: at worst it is pushed without auto-claim.
  if (hit) return exact ? { trust: 'unverified', reason: `contains "${hit}"` } : { trust: 'ignored', reason: `contains "${hit}"` };
  if (exact) return { trust: 'verified', reason: 'title matches display name' };
  if (/optimum/i.test(title)) return { trust: 'unverified', reason: `title "${title}" is not an exact match` };
  return { trust: 'ignored', reason: 'title does not mention optimum' };
}

const BUNDLED = /\b\d+\s+new\s+(posts?|tweets?|notifications?)\b|\band\s+\d+\s+others?\b/i;
const TRUNCATED_END = /(…|\.\.\.)\s*$/;
const CODE_WORD = /\bcodes?\b/i;
const TOKEN = '[A-Za-z0-9_-]{4,32}';
const ANCHORED = new RegExp(
  `\\bcodes?\\b\\s*(?:is\\b|:|=|-|–|—|→|👉|➡️?)?\\s*[:\\-]?\\s*["“”'‘’\`*]*(${TOKEN})`,
  'giu',
);
const QUOTED = new RegExp(`["“'‘\`](${TOKEN})["”'’\`]`, 'gu');

/** Hype words that are all-caps in announcements but are not codes. */
const STOP = new Set([
  'OPTIMUM', 'TURBOCARDS', 'TURBOCARD', 'MAINNET', 'ETHEREUM', 'CLAIM', 'CLAIMS', 'CODES', 'TODAY',
  'FRIDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'SATURDAY', 'SUNDAY', 'HTTPS', 'TWEET',
  'FIRST', 'NEXT', 'DROPS', 'DROP', 'LIVE', 'MINT', 'MINTS', 'NOW', 'FREE', 'BELOW', 'SOON', 'STAY',
  'TUNED', 'HERE', 'ENTER', 'QUEST', 'QUESTS', 'GO', 'GOOD', 'LUCK', 'ALERT', 'DONE', 'READY',
]);

function strip(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(?:t\.co|x\.com|twitter\.com)\/\S+/gi, ' ')
    .replace(/[@#$][A-Za-z0-9_]+/g, ' ');
}

/** After an explicit "code:" or inside quotes: must not be a plain lowercase word. */
function looksAnchored(tok: string): boolean {
  if (STOP.has(tok.toUpperCase())) return false;
  if (/^\d+$/.test(tok)) return tok.length >= 4;
  return /\d/.test(tok) || /[A-Z]/.test(tok);
}

/** Free-standing in the text: needs letters+digits, or a long all-caps token. */
function looksLoose(tok: string): boolean {
  if (STOP.has(tok.toUpperCase())) return false;
  const hasDigit = /\d/.test(tok);
  const hasLetter = /[A-Za-z]/.test(tok);
  if (hasDigit && hasLetter) return tok.length >= 5;
  return !hasDigit && tok.length >= 5 && tok === tok.toUpperCase() && /^[A-Z_-]+$/.test(tok);
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

export function extract(n: XNotification): Extraction {
  const big = cleanField(n.big);
  const short = cleanField(n.text);
  const body = big || short;
  const truncated = !big || TRUNCATED_END.test(body);
  const bundled = BUNDLED.test(n.title) || BUNDLED.test(body);
  const clean = strip(body);
  const mentionsCode = CODE_WORD.test(clean);

  const anchored = [...clean.matchAll(ANCHORED)].map((m) => m[1]).filter(looksAnchored);
  const quoted = [...clean.matchAll(QUOTED)].map((m) => m[1]).filter(looksAnchored);
  const strong = uniq([...anchored, ...quoted]);
  const loose = uniq((clean.match(/[A-Za-z0-9_-]+/g) ?? []).filter(looksLoose)).filter((t) => !strong.includes(t));
  const candidates = [...strong, ...loose];

  const base = { candidates, truncated, bundled, mentionsCode };
  const no = (reason: string): Extraction => ({ ...base, redeem: [], autoOk: false, reason });

  if (bundled) return no('bundled notification summary; open the post');
  if (truncated) return no(big ? 'text ends in an ellipsis' : 'no expanded text; may be cut off');
  if (!mentionsCode) return no(candidates.length ? 'possible code, but the post never says "code"' : 'no code');
  if (strong.length) return { ...base, redeem: strong.slice(0, MAX_REDEEM), autoOk: true, reason: 'code after "code"/in quotes' };
  if (loose.length === 0) return no('mentions a code but none found; open the post');
  if (loose.length > MAX_REDEEM) return no(`${loose.length} possible codes; too ambiguous`);
  return { ...base, redeem: loose, autoOk: true, reason: 'code-like token in a post that mentions a code' };
}
