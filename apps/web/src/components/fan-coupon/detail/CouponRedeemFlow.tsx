'use client';

/**
 * 顧客券詳情與三種核銷的單頁狀態機（Figma 顧客端 C4～C8.3；原型規格 1.2）。
 *
 *   detail ──立即使用──▶ staffCode（店員驗證碼）──成功──▶ result
 *          ──出示 QR───▶ qr（每 3 秒輪詢，偵測已使用）──▶ result
 *          ──立即使用──▶ self（滑動確認）──成功──▶ result
 *
 * 網址不變；進入核銷畫面時推一筆 history，讓手機的返回鍵回到詳情而不是離開頁面。
 * 顧客憑證放在 sessionStorage（由 fan-api 自動帶上）；沒有憑證或 401 時請顧客回到對話重新點連結，
 * 不導向後台登入。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link2Off, Loader2, SearchX, WifiOff } from 'lucide-react';
import { openCoupon, useFanCoupon, type FanCoupon, type WalletStatus } from '@/hooks/useFanCoupons';
import { getFanToken } from '@/lib/fan-api';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api-error';
import { ymd } from '@/lib/fan-coupon/labels';
import { FanShell, StatusMessage } from '../FanShell';
import { TicketDetail } from './TicketDetail';
import { StaffCodeRedeem, type RedeemAbort } from './StaffCodeRedeem';
import { QrRedeem } from './QrRedeem';
import { SelfRedeem } from './SelfRedeem';
import { RedeemResult } from './RedeemResult';
import { btnPrimary, btnSecondary, btnSubtle } from './ui';

type Screen = 'detail' | 'staffCode' | 'qr' | 'self' | 'result';

const WALLET_PATH = '/coupon/wallet';

/** 核銷途中後端回報券已不能用時，先在畫面上套用的狀態（重新抓到資料前也不會顯示錯的按鈕） */
const UNAVAILABLE_STATUS: Record<string, WalletStatus> = {
  EXPIRED: 'EXPIRED',
  REVOKED: 'ENDED',
  NOT_YET_VALID: 'NOT_YET',
};

function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | null)?.response?.status;
}

export function CouponRedeemFlow({ id }: { id: string }) {
  const router = useRouter();
  // 憑證只存在瀏覽器；掛載後才讀，避免伺服器端渲染與瀏覽器不一致
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => setToken(getFanToken()), []);

  const [screen, setScreen] = useState<Screen>('detail');
  const [redeemedAt, setRedeemedAt] = useState<string | null>(null);
  const [override, setOverride] = useState<{ walletStatus: WalletStatus; redeemedAt?: string | null } | null>(null);
  const [notice, setNotice] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');

  const { coupon, error, isLoading, mutate } = useFanCoupon(token ? id : null, screen === 'qr' ? 3000 : 0);

  // ── history：核銷畫面對應一筆 history，手機返回鍵回到詳情 ──
  const screenRef = useRef<Screen>('detail');
  const pushed = useRef(false);
  const ignoreNextPop = useRef(false);
  screenRef.current = screen;

  const enter = useCallback((next: Exclude<Screen, 'detail'>) => {
    if (screenRef.current === 'detail' && !pushed.current) {
      try {
        window.history.pushState({ couponScreen: next }, '');
        pushed.current = true;
      } catch {
        // 某些內嵌瀏覽器不允許改 history：只是返回鍵會離開頁面，不影響核銷
      }
    }
    setScreen(next);
  }, []);

  const goDetail = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      ignoreNextPop.current = true;
      window.history.back();
    }
    setScreen('detail');
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (ignoreNextPop.current) {
        ignoreNextPop.current = false;
        return;
      }
      pushed.current = false;
      if (screenRef.current !== 'detail') setScreen('detail');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const toWallet = useCallback(() => router.push(WALLET_PATH), [router]);

  // 店員掃碼：輪詢到已使用就切到核銷結果；被結束或過期則回詳情顯示原因
  useEffect(() => {
    if (screen !== 'qr' || !coupon) return;
    if (coupon.walletStatus === 'USED') {
      setRedeemedAt(coupon.redeemedAt ?? new Date().toISOString());
      setScreen('result');
    } else if (coupon.walletTab !== 'available') {
      goDetail();
    }
  }, [screen, coupon, goDetail]);

  const onRedeemed = useCallback(
    (at: string) => {
      setRedeemedAt(at);
      setOverride({ walletStatus: 'USED', redeemedAt: at });
      setScreen('result');
      void mutate();
    },
    [mutate],
  );

  const onAbort = useCallback(
    (abort: RedeemAbort) => {
      if (abort.kind === 'restart') {
        setNotice('錯誤次數過多，請重新開始');
      } else if (abort.kind === 'already') {
        setOverride({ walletStatus: 'USED', redeemedAt: abort.redeemedAt ?? null });
      } else {
        const status = UNAVAILABLE_STATUS[abort.code];
        if (status) setOverride({ walletStatus: status });
        else setNotice('此券目前無法使用，請重新整理後再試');
      }
      void mutate();
      goDetail();
    },
    [mutate, goDetail],
  );

  // ── 載入、未授權與錯誤 ──
  if (token === null || httpStatus(error) === 401) {
    return (
      <FanShell title="優惠券詳情">
        <StatusMessage
          icon={<Link2Off className="h-8 w-8" aria-hidden />}
          title="請回到對話，點選優惠券連結開啟"
          description="為保護你的優惠券，需從官方帳號對話中的連結開啟。"
        />
      </FanShell>
    );
  }

  if (!coupon) {
    if (error) {
      const notFound = httpStatus(error) === 404;
      return (
        <FanShell title="優惠券詳情" nav="back" onNav={toWallet}>
          <StatusMessage
            icon={notFound ? <SearchX className="h-8 w-8" aria-hidden /> : <WifiOff className="h-8 w-8" aria-hidden />}
            title={notFound ? '找不到這張優惠券' : '無法載入優惠券'}
            description={notFound ? '連結可能已失效，或這張券已被移除。' : getApiErrorMessage(error, '請稍後重試')}
          >
            {!notFound && (
              <button type="button" className={btnPrimary} onClick={() => void mutate()}>
                重試
              </button>
            )}
            <button type="button" className={btnSubtle} onClick={toWallet}>
              回到我的優惠券
            </button>
          </StatusMessage>
        </FanShell>
      );
    }
    return (
      <FanShell title="優惠券詳情" nav="back" onNav={toWallet}>
        <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          {(token === undefined || isLoading || !error) && <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
          載入中…
        </div>
      </FanShell>
    );
  }

  // 後端回報的狀態（例如另一裝置已核銷）在重新抓到資料前先套用；資料本身已是失效狀態就以資料為準
  const view: FanCoupon =
    override && coupon.walletTab === 'available'
      ? {
          ...coupon,
          walletStatus: override.walletStatus,
          walletTab: override.walletStatus === 'USED' ? 'used' : override.walletStatus === 'NOT_YET' ? 'available' : 'invalid',
          redeemedAt: override.redeemedAt ?? coupon.redeemedAt,
        }
      : coupon;

  // ── 各畫面 ──
  if (screen === 'result' && redeemedAt) {
    return <RedeemResult item={view} redeemedAt={redeemedAt} onClose={toWallet} />;
  }
  if (screen === 'staffCode') {
    return <StaffCodeRedeem item={view} onBack={goDetail} onRedeemed={onRedeemed} onAbort={onAbort} onUncertain={() => void mutate()} />;
  }
  if (screen === 'qr') {
    return <QrRedeem item={view} onBack={goDetail} onAbort={onAbort} />;
  }
  if (screen === 'self') {
    return <SelfRedeem item={view} onBack={goDetail} onRedeemed={onRedeemed} onAbort={onAbort} onUncertain={() => void mutate()} />;
  }

  const mode = view.coupon.redeemMode;
  const usable = view.walletStatus === 'AVAILABLE' || view.walletStatus === 'EXPIRING';
  const needsOpen = view.coupon.validityMode === 'AFTER_OPEN' && !view.openedAt;

  const enterMode = () => {
    setNotice('');
    if (mode === 'STAFF_CODE') enter('staffCode');
    else if (mode === 'STAFF_SCAN') enter('qr');
    else if (mode === 'SELF') enter('self');
  };

  const onUse = () => {
    if (needsOpen) {
      setOpenError('');
      setConfirmOpen(true);
    } else enterMode();
  };

  const confirmOpenCoupon = async () => {
    if (opening) return;
    setOpening(true);
    setOpenError('');
    try {
      await openCoupon(view.id);
      setConfirmOpen(false);
      void mutate();
      enterMode();
    } catch (err) {
      if (getApiErrorCode(err) === 'CANNOT_OPEN') {
        setConfirmOpen(false);
        setNotice('此券目前無法開啟，請重新整理後再試');
        void mutate();
      } else {
        setOpenError(getApiErrorMessage(err, '開啟失敗，請稍後重試'));
      }
    } finally {
      setOpening(false);
    }
  };

  let footer: React.ReactNode;
  if (usable) {
    footer = (
      <button type="button" className={btnPrimary} disabled={!mode} onClick={onUse}>
        {mode === 'STAFF_SCAN' ? '出示 QR Code 給店員' : '立即使用'}
      </button>
    );
  } else if (view.walletStatus === 'NOT_YET') {
    footer = (
      <button type="button" className={btnPrimary} disabled>
        {view.availableAt ? `${ymd(view.availableAt)} 起可使用` : '尚未生效'}
      </button>
    );
  } else {
    footer = (
      <button type="button" className={btnSecondary} onClick={toWallet}>
        關閉
      </button>
    );
  }

  return (
    <FanShell title="優惠券詳情" nav="back" onNav={toWallet} footer={footer}>
      {notice && (
        <p role="alert" className="mb-4 rounded-xl bg-destructive-subtle px-4 py-3 text-sm font-semibold text-destructive">
          {notice}
        </p>
      )}
      <TicketDetail item={view} onAfterOpenTimeUp={() => void mutate()} />

      {confirmOpen && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="open-confirm-title"
            className="w-full max-w-[480px] rounded-t-2xl bg-card p-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:rounded-2xl"
          >
            <h2 id="open-confirm-title" className="text-base font-extrabold leading-6 text-foreground">
              開啟後須在 {view.coupon.afterOpenMinutes ?? 0} 分鐘內使用，確定開啟？
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">開啟後開始計時，時間到未使用此券即失效。</p>
            {openError && (
              <p role="alert" className="mt-3 text-sm font-semibold text-destructive">
                {openError}
              </p>
            )}
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                className={btnPrimary}
                disabled={opening}
                aria-busy={opening}
                autoFocus
                onClick={() => void confirmOpenCoupon()}
              >
                {opening ? '開啟中…' : '確定開啟'}
              </button>
              <button type="button" className={btnSubtle} disabled={opening} onClick={() => setConfirmOpen(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </FanShell>
  );
}
