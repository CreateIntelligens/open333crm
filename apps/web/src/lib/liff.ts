/**
 * Minimal LIFF SDK loader. We don't ship the npm package — inject the official
 * CDN SDK on demand and resolve once `window.liff` is available.
 */

const LIFF_SDK_URL = 'https://static.line-scdn.net/liff/edge/2/sdk.js';

// Minimal shape of the bits of the LIFF SDK we use.
export interface LiffSdk {
  init(config: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(config?: { redirectUri?: string }): void;
  logout?: () => void;
  getProfile(): Promise<{ userId: string; displayName?: string; pictureUrl?: string }>;
  getVersion?: () => string;
  getContext?: () => { type?: string; [k: string]: unknown } | null;
  permission?: {
    query: (permission: string) => Promise<{ state: 'granted' | 'prompt' | 'unavailable' }>;
  };
}

declare global {
  interface Window {
    liff?: LiffSdk;
  }
}

/**
 * Read the params we put on the LIFF URL (`s`, `cid`, `lid`). When a LIFF URL
 * carries query params, LINE may forward them either appended directly to the
 * endpoint URL, OR packed into a single `liff.state` query param. Handle both
 * (decoding `liff.state` ourselves, no SDK needed) so the entry page can read
 * `lid` before `liff.init`.
 */
export function getLiffParams(search: string): URLSearchParams {
  const direct = new URLSearchParams(search);
  if (direct.has('s') || direct.has('lid')) return direct;
  const state = direct.get('liff.state');
  if (state) return new URLSearchParams(state.replace(/^\?/, ''));
  return direct;
}

/**
 * Resolve `s`/`cid`/`lid` robustly across the LINE in-app flow. LINE's webview
 * consumes `liff.state` during liff.init and can reload `/liff/redirect` with
 * NO query — unlike a desktop browser, which normalizes it to real params. So
 * we persist the params to sessionStorage on the first load that has them, and
 * restore them on any later load that lost them (init reload, login round-trip).
 */
const SS = { s: 'liff_s', cid: 'liff_cid', lid: 'liff_lid' } as const;

export function resolveLiffParams(search: string): { s: string | null; cid: string | null; lid: string | null } {
  const p = getLiffParams(search);
  let s = p.get('s');
  let cid = p.get('cid');
  let lid = p.get('lid');
  try {
    if (s) {
      // Fresh load with params → persist this flow.
      sessionStorage.setItem(SS.s, s);
      sessionStorage.setItem(SS.lid, lid ?? '');
      sessionStorage.setItem(SS.cid, cid ?? '');
    } else {
      // Params lost mid-flow → restore.
      s = sessionStorage.getItem(SS.s);
      lid = lid ?? sessionStorage.getItem(SS.lid);
      cid = cid ?? sessionStorage.getItem(SS.cid);
    }
  } catch {
    /* sessionStorage unavailable — fall back to whatever the URL gave us */
  }
  return { s: s || null, cid: cid || null, lid: lid || null };
}

let loading: Promise<LiffSdk> | null = null;

export function loadLiff(): Promise<LiffSdk> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('LIFF can only load in the browser'));
  }
  if (window.liff) return Promise.resolve(window.liff);
  if (loading) return loading;

  loading = new Promise<LiffSdk>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = LIFF_SDK_URL;
    script.async = true;
    script.onload = () => {
      if (window.liff) resolve(window.liff);
      else reject(new Error('LIFF SDK loaded but window.liff is missing'));
    };
    script.onerror = () => reject(new Error('Failed to load LIFF SDK'));
    document.head.appendChild(script);
  });
  return loading;
}

let initPromise: Promise<LiffSdk> | null = null;

/**
 * Load the SDK and call `liff.init` EXACTLY ONCE, even across React StrictMode's
 * double-invoked effects (calling liff.init twice concurrently can hang).
 */
export function initLiff(liffId: string): Promise<LiffSdk> {
  if (!initPromise) {
    initPromise = (async () => {
      const liff = await loadLiff();
      await liff.init({ liffId });
      return liff;
    })();
  }
  return initPromise;
}

/**
 * Debug switch: when true, the LIFF pages do NOT auto-navigate. Every redirect /
 * login becomes a button so the on-screen log stays readable (essential when
 * debugging inside the LINE app on a phone). Flip to false for normal flow.
 */
export const LIFF_DEBUG_PAUSE = true;

/** Format any thrown value into a readable string (Error message/name/code, or JSON). */
export function fmtErr(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as { code?: unknown }).code;
    return `${e.name}${code != null ? `[${String(code)}]` : ''}: ${e.message || '(empty message)'}`;
  }
  if (e && typeof e === 'object') {
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

/** Reject if `promise` doesn't settle within `ms` — so a stuck SDK never hangs the page. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}
