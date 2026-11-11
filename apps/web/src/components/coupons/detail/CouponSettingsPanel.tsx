'use client';

/**
 * 設定分頁（UX 規則第 4 節「設定分頁」）：兩欄 key/value，列出全部設定。
 * 不適用的設定寫明原因；核銷方式為店員驗證碼時多一列「驗證碼」，預設遮蔽、可顯示與複製、不提供更換。
 */
import React, { useState } from 'react';
import type { Coupon } from '@/hooks/useCoupons';
import { useContactTags } from '@/hooks/useContactTags';
import { Button } from '@/components/ui/button';
import {
  CODE_MODE_LABEL,
  PURPOSE_LABEL,
  REDEEM_MODE_LABEL,
  TYPE_LABEL,
  VALIDITY_LABEL,
  faceValueText,
  formatNumber,
  validityText,
} from '@/lib/coupon/labels';
import { copyText } from './detail-helpers';

interface Props {
  coupon: Coupon;
  showOk: (message: string) => void;
  showError: (message: string) => void;
}

const nt = (n: number) => `NT$${n.toLocaleString('zh-TW')}`;

function minSpendText(c: Coupon): string {
  if (c.couponType === 'DISCOUNT_AMOUNT' || c.couponType === 'DISCOUNT_PERCENT') {
    return c.minSpend ? nt(c.minSpend) : '無門檻';
  }
  if (!c.couponType) return '—';
  return c.minSpend ? nt(c.minSpend) : `不適用（${TYPE_LABEL[c.couponType]}券不設消費門檻）`;
}

function validityRowText(c: Coupon): string {
  const text = validityText(c);
  if (c.validityMode === 'FIXED' && text !== '—') return `${VALIDITY_LABEL.FIXED} · ${text}`;
  return text;
}

function codeModeText(c: Coupon): string {
  switch (c.codeMode) {
    case 'UNIQUE_CODE':
      return c.codePrefix ? `一人一碼（前綴 ${c.codePrefix}）` : CODE_MODE_LABEL.UNIQUE_CODE;
    case 'SHARED_CODE':
      return c.sharedCode ? `共用碼（${c.sharedCode}）` : CODE_MODE_LABEL.SHARED_CODE;
    case 'IMPORTED_CODES':
      return CODE_MODE_LABEL.IMPORTED_CODES;
    default:
      return '—';
  }
}

function maskBeforeStartText(c: Coupon): string {
  // 只有固定起訖有「生效日」；相對效期領取或開啟當下就生效
  if (c.validityMode && c.validityMode !== 'FIXED') {
    const v = validityText(c);
    return `不適用（效期為${v === '—' ? VALIDITY_LABEL[c.validityMode] : v}）`;
  }
  return c.maskCodeBeforeStart ? '開啟（生效前只顯示使用規則）' : '關閉';
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-t border-border px-4 py-3 first:border-t-0 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

function StaffCodeValue({ code, showOk, showError }: { code: string; showOk: Props['showOk']; showError: Props['showError'] }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span aria-live="polite" className="min-w-[6ch] font-mono text-base tracking-widest">
        {shown ? code : '●'.repeat(code.length)}
      </span>
      {!shown && <span className="sr-only">驗證碼已遮蔽</span>}
      <Button variant="outline" size="xs" aria-pressed={shown} onClick={() => setShown((v) => !v)}>
        {shown ? '隱藏' : '顯示'}
      </Button>
      <Button
        variant="outline"
        size="xs"
        onClick={async () => {
          if (await copyText(code)) showOk('已複製驗證碼');
          else showError('複製失敗，請先按「顯示」再手動複製');
        }}
      >
        複製
      </Button>
    </div>
  );
}

export function CouponSettingsPanel({ coupon: c, showOk, showError }: Props) {
  const { tags, isLoading: tagsLoading } = useContactTags();

  let autoTag: React.ReactNode = '關閉';
  if (c.claimTagId) {
    const tag = tags.find((t) => t.id === c.claimTagId);
    const name = tag ? `標籤「${tag.name}」` : tagsLoading ? null : '標籤已刪除';
    const ttl = c.claimTagTtlDays ? `${c.claimTagTtlDays} 天後自動移除` : '不自動移除';
    autoTag =
      name === null ? (
        <span className="inline-block h-4 w-48 animate-pulse rounded bg-muted align-middle" aria-label="標籤載入中" />
      ) : (
        `開啟 · ${name} · ${ttl}`
      );
  }

  return (
    <section aria-label="設定" className="max-w-[760px]">
      <dl className="overflow-hidden rounded-[10px] border border-border bg-card">
        <Row label="券型">{c.couponType ? TYPE_LABEL[c.couponType] : '—'}</Row>
        <Row label="折抵內容">{faceValueText(c)}</Row>
        <Row label="最低消費門檻">{minSpendText(c)}</Row>
        <Row label="用途">{c.purpose ? PURPOSE_LABEL[c.purpose] : '—'}</Row>
        <Row label="效期">{validityRowText(c)}</Row>
        <Row label="序號模式">{codeModeText(c)}</Row>
        <Row label="發行總量">{c.totalLimit == null ? '不限' : `${formatNumber(c.totalLimit)} 張`}</Row>
        <Row label="每人上限">{`每人 ${formatNumber(c.perContactLimit)} 張`}</Row>
        <Row label="使用條款">
          {c.terms?.trim() ? <span className="whitespace-pre-line">{c.terms}</span> : '未設定'}
        </Row>
        <Row label="未到生效日不顯示序號">{maskBeforeStartText(c)}</Row>
        <Row label="領券自動貼標">{autoTag}</Row>
        <Row label="券面圖">
          {c.imageUrl ? (
            <div className="flex items-center gap-3">
              {/* 券面圖來自 MinIO 外部網址，不經 next/image 的網域白名單 */}
              <img src={c.imageUrl} alt={`${c.name} 券面圖`} className="h-14 w-28 rounded-md border border-border object-cover" />
              <span className="text-muted-foreground">自訂券面</span>
            </div>
          ) : (
            '預設券面（純色底＋券名稱）'
          )}
        </Row>
        <Row label="核銷方式">{c.redeemMode ? REDEEM_MODE_LABEL[c.redeemMode] : '—'}</Row>
        {c.redeemMode === 'STAFF_CODE' && (
          <Row label="驗證碼">
            {c.staffCode ? <StaffCodeValue code={c.staffCode} showOk={showOk} showError={showError} /> : '未設定'}
          </Row>
        )}
      </dl>
    </section>
  );
}
