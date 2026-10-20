'use client';

/**
 * 票券連結入口（/coupon/open/{token}）。顧客在 LINE／FB 對話中點選發券訊息的連結後進入。
 *
 * 以連結 token 換顧客憑證（POST /fan/coupons/session，design D12）：
 * - ok：存下顧客憑證，顯示這次收到的券（對話發的券已直接存入券夾，不需領取，設計稿 C2／C2.1）
 * - verification_required：顧客還沒完成 One ID 歸戶，引導到手機／email 登記頁，登記後會回到這裡
 * - unavailable：商家沒開啟任何登記方式，請顧客聯絡客服
 * - rate_limited：一小時內取得驗證連結太多次
 * - HTTP 410（或格式不符的 400）：連結失效（C2.5）
 * - 其他錯誤：顯示錯誤與重試，不能只寫 console
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Link2Off, Loader2, MessageCircle, ShieldCheck, WifiOff } from 'lucide-react';
import { openWalletSession, useFanCoupon, type FanCoupon } from '@/hooks/useFanCoupons';
import { getFanToken, setFanToken } from '@/lib/fan-api';
import { ymd } from '@/lib/fan-coupon/labels';
import { FanShell, StatusMessage } from '../FanShell';
import { FanCouponCard } from '../FanCouponCard';
import { FanButton } from './FanButton';
import { CLOSE_HINT, useTryClose } from './useTryClose';

type Phase =
  | { kind: 'loading' }
  | { kind: 'ok'; instanceId: string }
  | { kind: 'verify'; contact: 'phone' | 'email'; registrationUrl: string }
  | { kind: 'unavailable' }
  | { kind: 'rate_limited' }
  | { kind: 'expired' }
  | { kind: 'error' };

const WALLET_PATH = '/coupon/wallet';

/** 成功畫面的使用說明（設計稿 C2：門市券；C2.1：顧客自助券在線上使用） */
const HOW_TO_USE_HINT: Record<NonNullable<FanCoupon['coupon']['redeemMode']>, string> = {
  STAFF_CODE: '到門市結帳時，打開「我的優惠券」即可使用。',
  STAFF_SCAN: '到門市結帳時，打開「我的優惠券」即可使用。',
  SELF: '在線上商城結帳時，打開「我的優惠券」即可使用。',
};

/** 連結失效的回應：後端過期回 410；token 格式不符被 Zod 擋下回 400 */
function isLinkInvalid(err: unknown): boolean {
  const status = (err as { response?: { status?: number } }).response?.status;
  return status === 410 || status === 400;
}

export function CouponEntry({ token }: { token: string }) {
  const router = useRouter();
  const { tryClose, showHint } = useTryClose();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // 開發模式的 StrictMode 會讓 effect 跑兩次；同一個 token 同一次嘗試只換一次憑證
  const requested = useRef<string | null>(null);

  useEffect(() => {
    const key = `${token}#${attempt}`;
    if (requested.current === key) return;
    requested.current = key;
    setPhase({ kind: 'loading' });
    openWalletSession(token)
      .then((session) => {
        switch (session.status) {
          case 'ok':
            setFanToken(session.fanToken);
            setPhase({ kind: 'ok', instanceId: session.instanceId });
            break;
          case 'verification_required':
            setPhase({ kind: 'verify', contact: session.kind, registrationUrl: session.registrationUrl });
            break;
          case 'unavailable':
            setPhase({ kind: 'unavailable' });
            break;
          case 'rate_limited':
            setPhase({ kind: 'rate_limited' });
            break;
          default:
            setPhase({ kind: 'error' });
        }
      })
      .catch((err: unknown) => setPhase({ kind: isLinkInvalid(err) ? 'expired' : 'error' }));
  }, [token, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const goWallet = useCallback(() => router.push(WALLET_PATH), [router]);

  const backToLine = (
    <>
      <FanButton variant="subtle" onClick={tryClose}>
        回到 LINE
      </FanButton>
      {showHint && (
        <p role="status" className="text-center text-sm font-medium text-muted-foreground">
          {CLOSE_HINT}
        </p>
      )}
    </>
  );

  let body: React.ReactNode;
  let footer: React.ReactNode = null;

  switch (phase.kind) {
    case 'loading':
      body = (
        <div role="status" aria-label="載入中" className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
          <p className="text-sm font-medium">正在開啟優惠券…</p>
        </div>
      );
      break;
    case 'ok':
      return <OkScreen instanceId={phase.instanceId} onWallet={goWallet} onClose={tryClose} backToLine={backToLine} />;
    case 'verify':
      body = (
        <StatusMessage
          icon={<ShieldCheck className="h-9 w-9" aria-hidden />}
          title="請先完成身分驗證"
          description={`為了保護你的優惠券，第一次開啟前請先登記${phase.contact === 'email' ? ' email' : '手機號碼'}，登記後會自動回到這張券。`}
        />
      );
      footer = (
        <>
          <FanButton
            onClick={() => {
              // registrationUrl 是後端產生的同網域相對路徑（/bind/...），整頁導向
              window.location.href = phase.registrationUrl;
            }}
          >
            前往驗證
          </FanButton>
          {backToLine}
        </>
      );
      break;
    case 'unavailable':
      body = (
        <StatusMessage
          icon={<MessageCircle className="h-9 w-9" aria-hidden />}
          title="目前無法開啟優惠券"
          description="商家尚未開啟身分驗證，請在對話中聯絡客服。"
        />
      );
      footer = backToLine;
      break;
    case 'rate_limited':
      body = (
        <StatusMessage
          icon={<Clock className="h-9 w-9" aria-hidden />}
          title="操作次數過多"
          description="請稍候一小時後再試，或在對話中聯絡客服。"
        />
      );
      footer = backToLine;
      break;
    case 'expired':
      body = (
        <StatusMessage
          icon={<Link2Off className="h-9 w-9" aria-hidden />}
          title="連結已失效"
          description={'連結可能已過期或不完整\n請回到 LINE 重新點選\n或到券夾查看已領取的券'}
        />
      );
      footer = (
        <>
          {/* 沒有顧客憑證時打開券夾也看不到內容，所以只在已有憑證時提供 */}
          {getFanToken() && <FanButton onClick={goWallet}>查看票券匣</FanButton>}
          {backToLine}
        </>
      );
      break;
    case 'error':
      body = (
        <StatusMessage
          icon={<WifiOff className="h-9 w-9" aria-hidden />}
          title="無法連線，請稍後再試"
          description="優惠券沒有任何變動，請確認網路後重試。"
        />
      );
      footer = (
        <>
          <FanButton onClick={retry}>重試</FanButton>
          {backToLine}
        </>
      );
      break;
  }

  return (
    <FanShell title="優惠券" nav="close" onNav={tryClose} footer={footer && <div className="flex flex-col gap-3">{footer}</div>}>
      {body}
    </FanShell>
  );
}

/** C2／C2.1：券已存入券夾 */
function OkScreen({
  instanceId,
  onWallet,
  onClose,
  backToLine,
}: {
  instanceId: string;
  onWallet: () => void;
  onClose: () => void;
  backToLine: React.ReactNode;
}) {
  const router = useRouter();
  const { coupon, error, isLoading, mutate } = useFanCoupon(instanceId);
  const goDetail = () => router.push(`/coupon/wallet/${instanceId}`);
  const text = coupon ? okText(coupon) : null;

  return (
    <FanShell
      title="優惠券"
      nav="close"
      onNav={onClose}
      footer={
        <div className="flex flex-col gap-3">
          <FanButton onClick={goDetail}>查看此票券</FanButton>
          <FanButton variant="secondary" onClick={onWallet}>
            查看票券匣
          </FanButton>
          {backToLine}
        </div>
      }
    >
      <div className="pt-7">
        <h2 className="text-2xl font-black leading-8 text-foreground">{text?.title ?? '已存入我的優惠券'}</h2>
        {text ? (
          <p className="mt-2 text-sm font-medium text-muted-foreground">{text.description}</p>
        ) : (
          <div aria-hidden className="mt-3 h-4 w-60 animate-pulse rounded bg-card" />
        )}
        <div className="mt-6">
          {coupon ? (
            <FanCouponCard item={coupon} onClick={goDetail} />
          ) : error && !isLoading ? (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-4">
              <p className="text-sm font-medium text-muted-foreground">無法載入券的內容</p>
              <button
                type="button"
                onClick={() => void mutate()}
                className="shrink-0 rounded-md px-2 py-1 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                重試
              </button>
            </div>
          ) : (
            <div role="status" aria-label="載入中" className="h-[108px] animate-pulse rounded-2xl bg-card" />
          )}
        </div>
      </div>
    </FanShell>
  );
}

/** 成功畫面的標題與說明：依券目前的狀態與核銷方式 */
function okText(c: FanCoupon): { title: string; description: string } {
  if (c.walletTab === 'used') {
    return { title: '這張券已使用', description: `此券已於 ${ymd(c.redeemedAt)} 使用，無法再次使用。` };
  }
  if (c.walletTab === 'invalid') {
    return {
      title: '這張券已無法使用',
      description:
        c.walletStatus === 'ENDED' ? '商家已提前結束活動，如有疑問請在對話中聯絡客服。' : '此券已過期，無法使用。',
    };
  }
  return { title: '已存入我的優惠券', description: HOW_TO_USE_HINT[c.coupon.redeemMode ?? 'STAFF_CODE'] };
}
