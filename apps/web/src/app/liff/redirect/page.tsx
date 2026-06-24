'use client';

/**
 * LIFF page — the SINGLE registered endpoint. Does the whole flow here so every
 * liff.* call runs on the endpoint URL (LIFF rejects/degrades SDK calls made on
 * a page that is not under the endpoint): init → login (redirectUri = this page)
 * → getProfile → POST /s/track → redirect to target.
 *
 * Counting happens only on the logged-in pass, so the login round-trip can't
 * double-count (the pre-login load never reaches /s/track).
 *
 * LIFF_DEBUG_PAUSE keeps the on-screen log readable by gating each navigation
 * behind a button.
 */

import { useEffect, useState } from 'react';
import { initLiff, resolveLiffParams, withTimeout, fmtErr, LIFF_DEBUG_PAUSE } from '@/lib/liff';
import { useScreenLog } from '@/lib/useScreenLog';
import { REALTIME_ORIGIN } from '@/lib/constants';

const TIMEOUT_MS = 8000;

export default function LiffEndpointPage() {
  const { logs, log } = useScreenLog();
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<{ label: string; run: () => void } | null>(null);

  useEffect(() => {
    const { s, cid, lid } = resolveLiffParams(window.location.search);
    log('params', { s, cid, lid });
    log('raw search', window.location.search);

    if (!s) {
      setError('連結參數錯誤（缺 s）');
      log('abort: missing s');
      return;
    }

    const stage = (label: string, run: () => void) => {
      log('next →', label);
      if (LIFF_DEBUG_PAUSE) setAction({ label, run });
      else run();
    };

    (async () => {
      try {
        let lineUid: string | undefined;

        if (lid) {
          log('init start', lid);
          const liff = await withTimeout(initLiff(lid), TIMEOUT_MS, 'liff.init');
          const loggedIn = liff.isLoggedIn();
          log('init ok; isLoggedIn =', loggedIn, '| ver', liff.getVersion?.() ?? '?');

          if (!loggedIn) {
            // redirectUri = THIS endpoint page (must be the endpoint URL). After
            // login we come back here logged in and continue → track once.
            stage('執行 liff.login()', () => {
              log('login redirectUri =', window.location.href);
              liff.login({ redirectUri: window.location.href });
            });
            return;
          }

          // Logged in → verify the profile permission is actually GRANTED for
          // this token. A stale session minted before `profile` was granted
          // reports 'prompt'/'unavailable' and getProfile would 403 — so force a
          // fresh login (logout+login) to re-mint a token WITH profile.
          let scopeState: string | undefined;
          try {
            scopeState = (await liff.permission?.query('profile'))?.state;
          } catch (e) {
            log('permission.query err:', fmtErr(e));
          }
          log('scope profile =', scopeState ?? '(n/a)');

          if (scopeState && scopeState !== 'granted') {
            log('profile 未授權 (', scopeState, ') → 需要重新登入以重發 token');
            stage('🔄 重新登入（logout + login）', () => {
              try {
                liff.logout?.();
              } catch (e) {
                log('logout err:', fmtErr(e));
              }
              liff.login({ redirectUri: window.location.href });
            });
            return;
          }

          try {
            log('getProfile start');
            const profile = await withTimeout(liff.getProfile(), TIMEOUT_MS, 'getProfile');
            lineUid = profile.userId;
            log('lineUid =', lineUid);
          } catch (e) {
            log('❌ profile failed (track without lineUid):', fmtErr(e));
          }
        } else {
          log('no lid → track without LIFF');
        }

        log('POST /s/track →', REALTIME_ORIGIN);
        const res = await fetch(`${REALTIME_ORIGIN}/s/track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: s, cid: cid ?? undefined, lineUid }),
        });
        const json = (await res.json()) as { data?: { targetUrl?: string } };
        const target = json?.data?.targetUrl;
        log('track status', res.status, '; target =', target ?? '(none)');

        if (target) {
          stage('前往目標頁', () => window.location.replace(target));
          return;
        }
        setError('連結已失效');
      } catch (e) {
        log('❌ failed:', fmtErr(e));
        setError('失敗：' + fmtErr(e));
      }
    })();
  }, [log]);

  return (
    <main style={{ fontFamily: 'system-ui, -apple-system, sans-serif', minHeight: '100vh', color: '#475569', padding: 16 }}>
      <div style={{ textAlign: 'center', padding: '12px 0' }}>
        {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : <p>處理中…</p>}
        {action && (
          <button
            onClick={action.run}
            style={{ marginTop: 8, padding: '10px 20px', fontSize: 16, background: '#06c755', color: '#fff', border: 0, borderRadius: 8 }}
          >
            ▶ {action.label}
          </button>
        )}
      </div>

      <pre style={{ background: '#0f172a', color: '#e2e8f0', fontSize: 11, lineHeight: 1.5, padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '60vh', overflow: 'auto' }}>
        {logs.join('\n') || 'debug log…'}
      </pre>
    </main>
  );
}
