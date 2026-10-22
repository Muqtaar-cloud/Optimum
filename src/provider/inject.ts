import type { BrowserContext } from 'playwright-core';

type RequestFn = (method: string, params?: unknown[]) => Promise<unknown>;

/**
 * Runs in the page. Defines window.ethereum and announces it via EIP-6963.
 * The page never sees the key: every request goes to Node through
 * `__turbobotRequest`, where the guard decides.
 */
const PAGE_SCRIPT = `(() => {
  if (window.__turbobotInstalled) return;
  window.__turbobotInstalled = true;
  const listeners = {};
  const emit = (e, v) => (listeners[e] || []).forEach((f) => { try { f(v); } catch {} });
  const provider = {
    isTurboBot: true,
    async request({ method, params }) {
      const r = await window.__turbobotRequest(method, params || []);
      if (!r.ok) { const err = new Error(r.message); err.code = r.code; throw err; }
      if (method === 'eth_requestAccounts') emit('accountsChanged', r.result);
      return r.result;
    },
    enable() { return provider.request({ method: 'eth_requestAccounts' }); },
    on(e, f) { (listeners[e] = listeners[e] || []).push(f); return provider; },
    removeListener(e, f) { listeners[e] = (listeners[e] || []).filter((x) => x !== f); return provider; },
  };
  try { Object.defineProperty(window, 'ethereum', { value: provider, configurable: false }); } catch {}
  const icon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#222"/><text x="16" y="22" font-size="16" text-anchor="middle" fill="#fff">T</text></svg>');
  const info = { uuid: '6f2c1e8a-4b7d-4c1e-9a3f-1b2c3d4e5f60', name: 'TurboBot', icon, rdns: 'local.turbobot' };
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
})();`;

export async function installProvider(context: BrowserContext, request: RequestFn): Promise<void> {
  await context.exposeFunction('__turbobotRequest', async (method: string, params: unknown[]) => {
    try {
      return { ok: true, result: await request(method, params) };
    } catch (e) {
      const err = e as { code?: number; message?: string };
      return { ok: false, code: err.code ?? 4001, message: err.message ?? 'refused' };
    }
  });
  await context.addInitScript(PAGE_SCRIPT);
}
