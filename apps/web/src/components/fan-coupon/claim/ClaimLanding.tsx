'use client';

/**
 * 公開領券頁（/coupon/claim/{代碼}；add-coupon-system design D30）。
 *
 * 顧客掃海報 QR Code 或點官網連結進來，看到券名、面額與效期，再依渠道領券：
 * - LINE：先加入好友，再點「傳送領券訊息」（LINE 開啟對話並預填含代碼的文字，顧客按送出）
 * - Facebook／Instagram：點按鈕開啟對話（連結帶代碼）
 * 系統收到訊息後直接在對話中發券。網頁本身不發券，也不需要登入。
 *
 * 不能領（停用、不在期間、券不是進行中）時只顯示說明，不顯示按鈕；代碼不存在時不顯示任何商家資料。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link2Off, Loader2, TicketX, WifiOff } from 'lucide-react';
import { fetchPublicClaim, type PublicClaimPage } from '@/lib/fan-coupon/claim';
import { conditionText, faceValue, ymd } from '@/lib/fan-coupon/labels';
import type { FanCoupon } from '@/hooks/useFanCoupons';
import { cn } from '@/lib/utils';
import { FanShell, StatusMessage } from '../FanShell';
import { FanButton } from '../entry/FanButton';

type Phase =
  | { kind: 'loading' }
  | { kind: 'ok'; page: PublicClaimPage }
  | { kind: 'not_found' }
  | { kind: 'error' };

const TITLE = '領取優惠券';

/** 效期說明：固定起訖、領取後 N 天、開啟後 N 分鐘 */
function validityLine(c: PublicClaimPage['coupon']): string {
  if (c.validityMode === 'FIXED' && c.endAt) return c.startAt ? `${ymd(c.startAt)} – ${ymd(c.endAt)}` : `有效期限至 ${ymd(c.endAt)}`;
  if (c.validityMode === 'AFTER_CLAIM' && c.afterClaimDays) return `領取後 ${c.afterClaimDays} 天內有效`;
  if (c.validityMode === 'AFTER_OPEN' && c.afterOpenMinutes) return `開啟後 ${c.afterOpenMinutes} 分鐘內使用`;
  return '';
}

/** 看起來像按鈕的連結（外部 App 連結要用 <a>，LINE／Messenger 才會接手） */
function LinkButton({ href, variant = 'primary', children }: { href: string; variant?: 'primary' | 'secondary'; children: React.ReactNode }) {
  return (
    <a
      href={href}
      rel="noopener noreferrer"
      className={cn(
        'inline-flex h-12 w-full items-center justify-center rounded-xl px-4 text-base transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        variant === 'primary'
          ? 'bg-primary font-semibold text-primary-foreground hover:bg-primary-hover'
          : 'border border-primary bg-primary-subtle font-medium text-primary',
      )}
    >
      {children}
    </a>
  );
}

function CouponSummary({ coupon }: { coupon: PublicClaimPage['coupon'] }) {
  const face = faceValue(coupon as unknown as FanCoupon['coupon']);
  const condition = conditionText(coupon as unknown as FanCoupon['coupon']);
  const validity = validityLine(coupon);
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-background">
      {coupon.imageUrl && <img src={coupon.imageUrl} alt="" className="aspect-[2/1] w-full object-cover" />}
      <div className="space-y-2 px-5 py-5">
        <h2 className="text-lg font-bold text-foreground">{coupon.name}</h2>
        {face.value && (
          <p className="text-primary">
            {face.prefix && <span className="mr-1 text-sm font-semibold">{face.prefix}</span>}
            <span className="text-3xl font-black tabular-nums">{face.value}</span>
            {face.suffix && <span className="ml-1 text-sm font-semibold">{face.suffix}</span>}
            {face.caption && <span className="ml-1 text-sm font-semibold">{face.caption}</span>}
          </p>
        )}
        {condition && <p className="text-sm text-muted-foreground">{condition}</p>}
        {validity && <p className="text-sm text-muted-foreground">{validity}</p>}
        {coupon.description && <p className="whitespace-pre-line text-sm text-foreground">{coupon.description}</p>}
      </div>
    </section>
  );
}

function ClaimSteps({ channel }: { channel: NonNullable<PublicClaimPage['channel']> }) {
  const account = channel.publicName ? `「${channel.publicName}」` : '';
  if (channel.channelType === 'LINE') {
    return (
      <section className="space-y-4">
        <ol className="space-y-4">
          <li className="space-y-2">
            <p className="text-sm font-medium text-foreground">{`1. 加入 LINE 官方帳號${account}好友`}</p>
            {channel.addFriendUrl && (
              <LinkButton href={channel.addFriendUrl} variant="secondary">
                加入好友
              </LinkButton>
            )}
          </li>
          <li className="space-y-2">
            <p className="text-sm font-medium text-foreground">2. 傳送領券訊息，優惠券會出現在聊天室</p>
            <LinkButton href={channel.sendCodeUrl}>傳送領券訊息</LinkButton>
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">開啟後請直接按送出，不要刪掉訊息中的代碼。</p>
      </section>
    );
  }
  const app = channel.channelType === 'FB' ? 'Messenger' : 'Instagram';
  return (
    <section className="space-y-3">
      <p className="text-sm font-medium text-foreground">{`開啟 ${app} 對話${account}，優惠券會出現在聊天室`}</p>
      <LinkButton href={channel.sendCodeUrl}>{`開啟 ${app} 領取`}</LinkButton>
      <p className="text-xs text-muted-foreground">開啟後若沒有收到優惠券，請在對話中傳送任一訊息。</p>
    </section>
  );
}

export function ClaimLanding({ code }: { code: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const load = useCallback(() => {
    setPhase({ kind: 'loading' });
    fetchPublicClaim(code)
      .then((page) => setPhase({ kind: 'ok', page }))
      .catch((err: unknown) => {
        const status = (err as { response?: { status?: number } }).response?.status;
        setPhase(status === 404 ? { kind: 'not_found' } : { kind: 'error' });
      });
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  if (phase.kind === 'loading') {
    return (
      <FanShell title={TITLE}>
        <div className="flex justify-center py-16" aria-busy="true" aria-label="載入中">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </FanShell>
    );
  }

  if (phase.kind === 'not_found') {
    return (
      <FanShell title={TITLE}>
        <StatusMessage icon={<Link2Off className="h-9 w-9" />} title="找不到這個領券活動" description="請確認網址或 QR Code 是否正確。" />
      </FanShell>
    );
  }

  if (phase.kind === 'error') {
    return (
      <FanShell title={TITLE}>
        <div role="alert">
          <StatusMessage icon={<WifiOff className="h-9 w-9" />} title="載入失敗" description="網路連線不穩定，請稍後再試。">
            <FanButton onClick={load}>重試</FanButton>
          </StatusMessage>
        </div>
      </FanShell>
    );
  }

  const { page } = phase;
  return (
    <FanShell title={TITLE}>
      <div className="space-y-6">
        <CouponSummary coupon={page.coupon} />
        {page.available && page.channel ? (
          <ClaimSteps channel={page.channel} />
        ) : (
          <StatusMessage icon={<TicketX className="h-9 w-9" />} title={page.message ?? '這個領券活動目前無法領取'} />
        )}
      </div>
    </FanShell>
  );
}
