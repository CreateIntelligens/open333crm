'use client';

/**
 * LIFF page — the SINGLE registered endpoint. Runs the whole flow here so every
 * liff.* call happens on the endpoint URL: init → login (redirectUri = this page)
 * → getProfile → POST /s/track → replace to the target. Counting happens only on
 * the logged-in pass, so the login round-trip never double-counts.
 *
 * Any LIFF failure (no permission, hang, etc.) falls back to tracking WITHOUT a
 * lineUid so the user always reaches the target.
 */

import { useEffect, useState } from 'react';
import { initLiff, resolveLiffParams, withTimeout } from '@/lib/liff';
import { REALTIME_ORIGIN } from '@/lib/constants';

const TIMEOUT_MS = 8000;

export default function LiffEndpointPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { s, cid, lid } = resolveLiffParams(window.location.search);
      if (!s) {
        setError('連結無效');
        return;
      }

      let lineUid: string | undefined;
      try {
        if (lid) {
          const liff = await withTimeout(initLiff(lid), TIMEOUT_MS, 'liff.init');
          if (!liff.isLoggedIn()) {
            liff.login({ redirectUri: window.location.href });
            return;
          }
          try {
            const profile = await withTimeout(liff.getProfile(), TIMEOUT_MS, 'getProfile');
            lineUid = profile.userId;
          } catch {
            // No profile permission / hang → continue without lineUid.
          }
        }

        const res = await fetch(`${REALTIME_ORIGIN}/s/track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: s, cid: cid ?? undefined, lineUid }),
        });
        const json = (await res.json()) as { data?: { targetUrl?: string } };
        const target = json?.data?.targetUrl;
        if (target) {
          window.location.replace(target);
          return;
        }
        setError('連結已失效');
      } catch {
        setError('連結無法開啟');
      }
    })();
  }, []);

  return (
    <main
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        minHeight: '90vh',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#475569',
        textAlign: 'center',
        padding: 24,
      }}
    >
      <p>{error ?? '前往中…'}</p>
    </main>
  );
}
