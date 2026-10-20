'use client';

/**
 * 票券詳情卡（Figma 顧客端 F.2；C4～C4.5、C8.1～C8.3）。
 * 上半部為票券摘要（綠色漸層或商家券面圖＋深色漸層），下半部為券號、使用條款與明細列。
 * 只負責顯示；主按鈕由外層依核銷方式與狀態決定。
 */
import React, { useEffect, useRef } from 'react';
import { Gift, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FanCoupon } from '@/hooks/useFanCoupons';
import { HOW_TO_USE, conditionText, faceValue, statusLabel, ymd, ymdhm, ymdhms, termsHtml } from '@/lib/fan-coupon/labels';
import { FanStatusBadge } from '../FanStatusBadge';
import { formatClock, md, mdhm } from './ui';
import { useCountdown } from './useCountdown';

/** 詳情頁券號下方的說明：依狀態說明原因，可使用時說明怎麼用 */
export function ticketNote(item: FanCoupon): string {
  switch (item.walletStatus) {
    case 'USED':
      return item.redeemedAt ? `此券已於 ${ymdhms(item.redeemedAt)} 使用，無法再次核銷。` : '此券已使用，無法再次核銷。';
    case 'EXPIRED':
      return `此券已於 ${ymd(item.expiresAt ?? item.coupon.endAt)} 到期，無法使用。`;
    case 'ENDED':
      return '商家已提前結束活動，如有疑問請聯絡客服。';
    case 'NOT_YET':
      if (item.codeHidden) return `${md(item.availableAt)} 起可使用，序號生效前不顯示`;
      break;
  }
  return item.coupon.redeemMode ? HOW_TO_USE[item.coupon.redeemMode] : '';
}

/** 有效期限列：固定期間寫起訖；領取後／開啟後計時寫到期日或規則 */
function validityText(item: FanCoupon): string {
  const c = item.coupon;
  if (c.validityMode === 'FIXED' && c.startAt && c.endAt) return `${ymd(c.startAt)} - ${ymd(c.endAt)}`;
  if (item.expiresAt) return `至 ${ymd(item.expiresAt)}`;
  if (c.validityMode === 'AFTER_OPEN' && c.afterOpenMinutes) return `開啟後 ${c.afterOpenMinutes} 分鐘內使用`;
  return '—';
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <dt className="shrink-0 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={cn('text-right text-xs font-semibold text-foreground', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}

/** 開啟後計時的券：顯示剩餘可使用時間；歸零時通知外層重新抓資料（後端會改判為已過期） */
function AfterOpenTimer({ expiresAt, onTimeUp }: { expiresAt: string; onTimeUp?: () => void }) {
  const left = useCountdown(expiresAt);
  const fired = useRef(false);
  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      onTimeUp?.();
    }
  }, [left, onTimeUp]);
  if (left === null) return null;
  const urgent = left <= 60;
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold',
        urgent ? 'bg-destructive-subtle text-destructive' : 'bg-warning-subtle text-warning',
      )}
    >
      <Timer aria-hidden className="h-4 w-4 shrink-0" />
      <span>
        已開啟，剩餘 <span className="font-mono tabular-nums">{formatClock(left)}</span> 可使用
      </span>
    </div>
  );
}

interface Props {
  item: FanCoupon;
  /** 開啟後計時的券倒數歸零時呼叫 */
  onAfterOpenTimeUp?: () => void;
}

export function TicketDetail({ item, onAfterOpenTimeUp }: Props) {
  const c = item.coupon;
  const face = faceValue(c);
  const inactive = item.walletTab !== 'available';
  const condition = conditionText(c);
  const badge =
    item.walletStatus === 'USED' && item.redeemedAt ? `${statusLabel(item)} · ${mdhm(item.redeemedAt)}` : statusLabel(item);
  const showAfterOpenTimer =
    c.validityMode === 'AFTER_OPEN' && !!item.openedAt && !!item.expiresAt && !inactive && item.walletStatus !== 'NOT_YET';

  return (
    <article aria-label={c.name} className="overflow-hidden rounded-[20px] bg-card shadow-[0_0_2px_rgba(0,0,0,0.1)]">
      {/* 上半部：票券摘要 */}
      <div
        className={cn(
          'relative flex min-h-[193px] flex-col gap-4 bg-gradient-to-br from-[#0b6b57] to-[#14876f] p-5 text-white',
          inactive && 'grayscale',
        )}
        style={
          c.imageUrl
            ? {
                backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.8) 100%), url(${c.imageUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : undefined
        }
      >
        <div>
          <FanStatusBadge status={item.walletStatus} label={badge} />
        </div>
        <div className="flex items-baseline gap-2">
          {face.prefix && <span className="text-lg font-bold">{face.prefix}</span>}
          <span className="text-[42px] font-black leading-8">{face.value}</span>
          {face.suffix && <span className="text-lg font-bold">{face.suffix}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-bold leading-5">{c.name}</h2>
          {condition && <p className="text-sm leading-5 text-white/90">{condition}</p>}
          {c.description && <p className="text-sm leading-5 text-white/90">{c.description}</p>}
        </div>
        {!c.imageUrl && <Gift aria-hidden className="absolute bottom-4 right-5 h-14 w-14 text-white/20" />}
      </div>

      {/* 撕線：左右半圓缺口＋虛線 */}
      <div aria-hidden className="relative h-0">
        <span className="absolute -left-[19px] -top-[19px] h-[38px] w-[38px] rounded-full bg-muted" />
        <span className="absolute -right-[19px] -top-[19px] h-[38px] w-[38px] rounded-full bg-muted" />
        <div className="mx-7 border-t-2 border-dashed border-[#D1C8BB] dark:border-border" />
      </div>

      {/* 下半部：票券資訊 */}
      <div className="flex flex-col gap-5 px-4 pb-5 pt-6">
        {showAfterOpenTimer && <AfterOpenTimer expiresAt={item.expiresAt!} onTimeUp={onAfterOpenTimeUp} />}

        <section aria-label="券號" className="overflow-hidden rounded-2xl border border-border">
          <div className="bg-[#F2F1EE] px-4 py-3 dark:bg-muted">
            <p className="text-xs font-semibold text-muted-foreground">券號</p>
            <p
              className={cn(
                'mt-1 break-all font-mono text-xl font-semibold leading-5 tracking-[0.05em] text-foreground',
                inactive && 'text-muted-foreground line-through',
              )}
            >
              {item.code ?? '••••-••••-••••'}
            </p>
          </div>
          <p className="bg-card p-3 font-mono text-xs font-medium leading-5 text-muted-foreground">{ticketNote(item)}</p>
        </section>

        {c.terms && (
          <section aria-labelledby="coupon-terms-title">
            <h3 id="coupon-terms-title" className="text-sm font-extrabold text-foreground">
              使用條款
            </h3>
            {/* terms 由後端 terms-sanitizer 消毒過（只留白名單標籤與屬性），可直接當 HTML 呈現 */}
            <div
              className="mt-2 text-sm font-medium leading-6 text-muted-foreground [&_a]:text-primary [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: termsHtml(c.terms) }}
            />
          </section>
        )}

        <dl>
          <MetaRow label="有效期限" value={validityText(item)} />
          {item.claimedAt && <MetaRow label="領取時間" value={ymdhm(item.claimedAt)} />}
          {item.walletStatus === 'USED' && item.redeemedAt && <MetaRow label="使用時間" value={ymdhms(item.redeemedAt)} />}
        </dl>
      </div>
    </article>
  );
}
