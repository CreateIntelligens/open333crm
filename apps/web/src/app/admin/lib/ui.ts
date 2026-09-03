/**
 * 平台後台共用視覺常數（inline style）。
 * 集中管理色票/卡片/按鈕/輸入框/badge，讓平台帳號相關頁面視覺一致，避免每頁重複貼樣式。
 */
import type { CSSProperties } from 'react';

// ── 色票 ──
export const C = {
  brand: '#0d9488',
  brandDark: '#0b7a70',
  brandSoft: '#f0fdfa',
  ink: '#1a2230',
  body: '#3d4757',
  muted: '#66707f',
  faint: '#97a0ae',
  line: '#e6ebf1',
  lineSoft: '#eef2f6',
  bg: '#f4f6f9',
  surface: '#ffffff',
  ok: '#17935b',
  okSoft: '#e4f5ec',
  danger: '#d1443e',
  dangerSoft: '#fdecea',
  warn: '#b7791f',
  warnSoft: '#fef6e7',
} as const;

// ── 卡片 ──
export const card: CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.line}`,
  borderRadius: 14,
  boxShadow: '0 1px 2px rgba(20,30,50,.04), 0 6px 20px rgba(20,30,50,.05)',
  padding: 22,
};

// ── 頁面標題區 ──
export const pageTitle: CSSProperties = { fontSize: 23, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: '-.01em' };
export const pageDesc: CSSProperties = { color: C.muted, fontSize: 13.5, margin: '6px 0 24px', lineHeight: 1.6 };
export const sectionTitle: CSSProperties = { fontSize: 15, fontWeight: 700, color: C.ink, margin: '0 0 14px' };

// ── 輸入框 ──
export const label: CSSProperties = { display: 'block', fontSize: 12.5, fontWeight: 600, color: C.body, marginBottom: 6 };
export const input: CSSProperties = {
  width: '100%',
  border: `1px solid ${C.line}`,
  borderRadius: 9,
  padding: '10px 12px',
  fontSize: 14,
  color: C.ink,
  outline: 'none',
  boxSizing: 'border-box',
  background: C.surface,
  transition: 'border-color .15s, box-shadow .15s',
};
// onFocus/onBlur 套用（inline style 沒有 :focus，用 handler）
export const focusRing = {
  onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = C.brand;
    e.currentTarget.style.boxShadow = `0 0 0 3px rgba(13,148,136,.15)`;
  },
  onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = C.line;
    e.currentTarget.style.boxShadow = 'none';
  },
};

// ── 按鈕 ──
export const btnPrimary: CSSProperties = {
  background: C.brand,
  color: '#fff',
  border: 'none',
  borderRadius: 9,
  padding: '10px 20px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 1px 2px rgba(13,148,136,.25)',
  transition: 'background .15s, box-shadow .15s, transform .05s',
};
export const btnSecondary: CSSProperties = {
  background: C.surface,
  color: C.body,
  border: `1px solid ${C.line}`,
  borderRadius: 9,
  padding: '9px 16px',
  fontSize: 13.5,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background .15s, border-color .15s',
};

// hover handlers（inline style 沒有 :hover）
export const primaryHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.disabled) e.currentTarget.style.background = C.brandDark;
  },
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = C.brand;
  },
};
export const secondaryHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.disabled) e.currentTarget.style.background = C.lineSoft;
  },
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = C.surface;
  },
};

// ── 狀態 badge ──
export type BadgeTone = 'ok' | 'danger' | 'warn' | 'neutral';
export function badge(tone: BadgeTone): CSSProperties {
  const map: Record<BadgeTone, { fg: string; bg: string }> = {
    ok: { fg: C.ok, bg: C.okSoft },
    danger: { fg: C.danger, bg: C.dangerSoft },
    warn: { fg: C.warn, bg: C.warnSoft },
    neutral: { fg: C.muted, bg: C.lineSoft },
  };
  const { fg, bg } = map[tone];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    color: fg,
    background: bg,
    lineHeight: 1.5,
    whiteSpace: 'nowrap',
  };
}

// ── 表格 ──
export const table: CSSProperties = { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13.5 };
export const th: CSSProperties = {
  padding: '11px 14px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: C.faint,
  textTransform: 'uppercase',
  letterSpacing: '.04em',
  borderBottom: `1px solid ${C.line}`,
};
export const td: CSSProperties = { padding: '13px 14px', color: C.body, borderBottom: `1px solid ${C.lineSoft}`, verticalAlign: 'middle' };

// ── 訊息條 ──
export function banner(ok: boolean): CSSProperties {
  return {
    background: ok ? C.okSoft : C.dangerSoft,
    color: ok ? C.ok : C.danger,
    padding: '11px 16px',
    borderRadius: 10,
    marginBottom: 18,
    fontSize: 13.5,
    lineHeight: 1.6,
    border: `1px solid ${ok ? 'rgba(23,147,91,.18)' : 'rgba(209,68,62,.18)'}`,
  };
}

// 小型 row-level 按鈕（表格內操作）
export const rowBtn: CSSProperties = {
  border: `1px solid ${C.line}`,
  background: C.surface,
  borderRadius: 7,
  padding: '5px 11px',
  cursor: 'pointer',
  fontSize: 12.5,
  fontWeight: 500,
  color: C.body,
  transition: 'background .15s, border-color .15s',
};
