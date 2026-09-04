'use client';

import type { ReactNode } from 'react';
import { C } from './ui';

/** 平台後台未登入頁（登入/忘記密碼/重設密碼）共用的全螢幕置中外殼。 */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // 品牌漸層背景，比純色更有質感
        background: `linear-gradient(150deg, ${C.brand} 0%, ${C.brandDark} 60%, #085a53 100%)`,
        fontFamily: 'system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif',
        padding: 20,
      }}
    >
      <div
        style={{
          background: C.surface,
          padding: 34,
          borderRadius: 18,
          width: 380,
          maxWidth: '100%',
          boxShadow: '0 10px 40px rgba(8,60,53,.28), 0 2px 8px rgba(8,60,53,.16)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, color: C.ink, letterSpacing: '-.01em' }}>{title}</h1>
        {subtitle && <p style={{ margin: '0 0 22px', fontSize: 13.5, color: C.muted, lineHeight: 1.6 }}>{subtitle}</p>}
        {!subtitle && <div style={{ height: 20 }} />}
        {children}
      </div>
    </div>
  );
}
