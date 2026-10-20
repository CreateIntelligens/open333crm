'use client';

/**
 * 顧客自助核銷（Figma 顧客端 C7、C7.1；spec「顧客自助核銷」）。
 * 以滑動確認取代按鈕；送出中鎖定元件，失敗時滑桿歸零、可再滑一次重試。
 */
import React, { useRef, useState } from 'react';
import { redeemSelf, type FanCoupon } from '@/hooks/useFanCoupons';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api-error';
import { FanShell } from '../FanShell';
import { FanCouponCard } from '../FanCouponCard';
import { SlideToRedeem } from './SlideToRedeem';
import type { RedeemAbort } from './StaffCodeRedeem';

const UNAVAILABLE_CODES = new Set(['EXPIRED', 'REVOKED', 'NOT_YET_VALID', 'NOT_CLAIMED', 'SELF_REDEEM_NOT_ALLOWED', 'NOT_FOUND']);

interface Props {
  item: FanCoupon;
  onBack: () => void;
  onRedeemed: (redeemedAt: string) => void;
  onAbort: (abort: RedeemAbort) => void;
}

export function SelfRedeem({ item, onBack, onRedeemed, onAbort }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** 失敗後換 key 讓滑桿回到起點 */
  const [attempt, setAttempt] = useState(0);
  const lock = useRef(false);

  const submit = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await redeemSelf(item.id);
      onRedeemed(result.redeemedAt);
    } catch (err) {
      const code = getApiErrorCode(err);
      if (code === 'ALREADY_REDEEMED' || code === 'CONFLICT') onAbort({ kind: 'already' });
      else if (code && UNAVAILABLE_CODES.has(code)) onAbort({ kind: 'unavailable', code });
      else {
        setError(`${getApiErrorMessage(err, '核銷沒有送出，請重試')}（這張券尚未被使用，可再滑動一次）`);
        setAttempt((n) => n + 1);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <FanShell
      title="確認核銷"
      nav="back"
      onNav={() => !busy && onBack()}
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-center text-xs font-bold leading-5 text-destructive">
              {error}
            </p>
          )}
          <SlideToRedeem key={attempt} busy={busy} onConfirm={() => void submit()} />
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <p className="text-base font-extrabold leading-5 text-foreground">滑動後此券立即失效，且無法復原</p>
          <p className="mt-1 font-mono text-xs leading-5 text-muted-foreground">請確認已在結帳畫面，再進行操作</p>
        </div>
        <FanCouponCard item={item} />
        <ul className="list-inside list-disc text-sm font-medium leading-6 text-muted-foreground">
          <li>此券由顧客自行核銷，不需店員操作</li>
          <li>由顧客自行滑動核銷，誤按亦無法復原，請確認後再滑動</li>
          <li>單筆訂單限用一張，不與其他優惠併用</li>
        </ul>
      </div>
    </FanShell>
  );
}
