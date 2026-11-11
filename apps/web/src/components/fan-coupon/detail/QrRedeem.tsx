'use client';

/**
 * 店員掃碼核銷：出示 QR Code（Figma 顧客端 C6；spec「店員掃碼後顧客端得知核銷完成」）。
 * QR 內容為券號；店員核銷後由外層輪詢券狀態（每 3 秒）切到核銷結果。
 * 進入時嘗試保持螢幕常亮（Wake Lock），不支援的瀏覽器略過。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getCouponQrCode, type FanCoupon } from '@/hooks/useFanCoupons';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api-error';
import { conditionText } from '@/lib/fan-coupon/labels';
import { FanShell } from '../FanShell';
import { btnPrimary, btnSubtle } from './ui';
import type { RedeemAbort } from './StaffCodeRedeem';

interface Props {
  item: FanCoupon;
  onBack: () => void;
  onAbort: (abort: RedeemAbort) => void;
}

type WakeLockSentinelLike = { release: () => Promise<void> };

export function QrRedeem({ item, onBack, onAbort }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setDataUrl(await getCouponQrCode(item.id));
    } catch (err) {
      // 409 NOT_AVAILABLE：券在這期間被使用或失效，交給外層重新抓資料
      if (getApiErrorCode(err) === 'NOT_AVAILABLE') {
        onAbort({ kind: 'unavailable', code: 'NOT_AVAILABLE' });
        return;
      }
      setError(getApiErrorMessage(err, '無法產生 QR Code，請重試'));
    } finally {
      setLoading(false);
    }
  }, [item.id, onAbort]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let sentinel: WakeLockSentinelLike | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } };
    nav.wakeLock
      ?.request('screen')
      .then((s) => {
        sentinel = s;
      })
      .catch(() => {
        // 使用者拒絕或瀏覽器不允許：只靠畫面提示調高亮度
      });
    return () => {
      void sentinel?.release().catch(() => {});
    };
  }, []);

  const summary = [item.coupon.name, conditionText(item.coupon)].filter(Boolean).join(' · ');

  return (
    <FanShell
      title="出示QR Code"
      nav="back"
      onNav={onBack}
      footer={
        <button type="button" className={btnSubtle} onClick={onBack}>
          取消使用
        </button>
      }
    >
      <div className="flex flex-col items-center gap-8 pt-4 text-center">
        <div className="flex flex-col gap-1">
          <p className="text-base font-extrabold leading-6 text-foreground">請將畫面出示給店員掃描</p>
          <p className="text-sm leading-5 text-muted-foreground">掃描時請調高螢幕亮度</p>
        </div>

        <div className="flex w-[252px] flex-col items-center gap-2">
          <p className="text-sm font-semibold leading-5 text-foreground">{summary}</p>
          {/* QR 框固定白底：深色模式也要讓掃描器讀得到 */}
          <div className="flex h-[255px] w-[252px] items-center justify-center rounded-xl border border-muted-foreground/40 bg-white p-1">
            {dataUrl && !error ? (
              // data URL，不經 next/image 最佳化
              <img src={dataUrl} alt="優惠券 QR Code" className="h-[240px] w-[243px] object-contain" />
            ) : loading ? (
              <Loader2 aria-label="QR Code 產生中" className="h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none" />
            ) : (
              <div className="flex flex-col items-center gap-3 px-4">
                <p role="alert" className="text-sm font-semibold text-destructive">
                  {error}
                </p>
                <button type="button" className={`${btnPrimary} h-10`} onClick={() => void load()}>
                  重試
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm leading-5 text-muted-foreground">無法掃描請輸入券號</p>
          <p className="break-all font-mono text-xl font-semibold tracking-[0.05em] text-foreground">{item.scanCode ?? item.code}</p>
        </div>

        <p role="status" className="sr-only">
          店員核銷後，畫面會自動切換到核銷結果
        </p>
      </div>
    </FanShell>
  );
}
