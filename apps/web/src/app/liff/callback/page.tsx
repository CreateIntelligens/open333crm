'use client';

/**
 * Legacy/safety route. The whole LIFF flow now lives on the single endpoint page
 * (/liff/redirect) so that every liff.* call runs on the endpoint URL. This page
 * does NOT call the LIFF SDK (calling liff.init here would warn + degrade, since
 * /liff/callback is not under the endpoint /liff/redirect). If anything still
 * lands here, just bounce to the endpoint, preserving params.
 */

import { useEffect } from 'react';
import { resolveLiffParams } from '@/lib/liff';

export default function LiffCallbackRedirect() {
  useEffect(() => {
    const { s, cid, lid } = resolveLiffParams(window.location.search);
    const url = new URL('/liff/redirect', window.location.origin);
    if (s) url.searchParams.set('s', s);
    if (cid) url.searchParams.set('cid', cid);
    if (lid) url.searchParams.set('lid', lid);
    window.location.replace(url.toString());
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
      }}
    >
      <p>導向中…</p>
    </main>
  );
}
