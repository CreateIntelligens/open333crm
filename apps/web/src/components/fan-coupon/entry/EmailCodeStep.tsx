'use client';

/**
 * 票券連結在新裝置開啟（或被轉傳）時，以聯絡人原本的 email 驗證碼確認是本人（add-coupon-system design D24）。
 *
 * 只顯示遮蔽後的 email，不提供輸入其他 email 的欄位：驗證碼只寄到這位顧客既有的 email。
 * 流程：寄送驗證碼 → 輸入 6 位數 → 確認。成功後由呼叫端存下顧客憑證與裝置憑證、顯示這張券。
 * 每種失敗都顯示在畫面上（驗證碼錯誤與剩餘次數、錯太多次、過期、寄送太多次、寄信失敗、連結失效）。
 */
import React, { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { requestWalletEmailCode, verifyWalletEmailCode, type WalletSessionOk } from '@/hooks/useFanCoupons';
import { FanShell, StatusMessage } from '../FanShell';
import { FanButton } from './FanButton';

/** 寄出後多久才能重寄（伺服器另有同一個連結 10 分鐘內最多 3 封的上限） */
export const RESEND_COOLDOWN_SECONDS = 60;
const CODE_LENGTH = 6;
const FORM_ID = 'wallet-email-code-form';

interface ApiErrorShape {
  response?: { status?: number; data?: { error?: { code?: string; details?: { remainingAttempts?: number } } } };
}

/** 依後端錯誤代碼決定畫面上的說明；'link_expired' 表示票券連結本身失效，改顯示連結已失效頁 */
function describeError(err: unknown, fallback: string): { message: string } | 'link_expired' {
  const res = (err as ApiErrorShape).response;
  const code = res?.data?.error?.code;
  switch (code) {
    case 'LINK_EXPIRED':
      return 'link_expired';
    case 'INVALID_VERIFICATION_CODE': {
      const left = res?.data?.error?.details?.remainingAttempts ?? 0;
      return { message: left > 0 ? `驗證碼錯誤，還可以再試 ${left} 次` : '驗證碼錯誤次數過多，請重新寄送驗證碼' };
    }
    case 'VERIFICATION_CODE_LOCKED':
      return { message: '驗證碼錯誤次數過多，請重新寄送驗證碼' };
    case 'VERIFICATION_CODE_EXPIRED':
      return { message: '驗證碼已過期，請重新寄送' };
    case 'TOO_MANY_VERIFICATION_EMAILS':
      return { message: '寄送次數過多，請 10 分鐘後再試' };
    case 'VERIFICATION_EMAIL_IN_PROGRESS':
      return { message: '驗證信寄送中，請稍候查看信箱' };
    case 'VERIFICATION_EMAIL_FAILED':
      return { message: '驗證信寄送失敗，請稍後再試' };
    case 'EMAIL_CODE_UNAVAILABLE':
      return { message: '無法寄送驗證碼，請回到對話重新點選優惠券連結' };
    default:
      // 沒有代碼的 410 也是連結失效（例如格式不符）
      if (res?.status === 410) return 'link_expired';
      return { message: fallback };
  }
}

export function EmailCodeStep({
  token,
  maskedEmail,
  onVerified,
  onLinkExpired,
  onClose,
  backToLine,
}: {
  token: string;
  maskedEmail: string;
  onVerified: (session: WalletSessionOk) => void;
  onLinkExpired: () => void;
  onClose: () => void;
  backToLine: React.ReactNode;
}) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const handleError = (err: unknown, fallback: string) => {
    const described = describeError(err, fallback);
    if (described === 'link_expired') onLinkExpired();
    else setError(described.message);
  };

  const send = async () => {
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      await requestWalletEmailCode(token);
      setNotice(sent ? '已重新寄出驗證碼' : null);
      setSent(true);
      setCode('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      handleError(err, '無法寄送驗證碼，請確認網路後再試');
    } finally {
      setSending(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== CODE_LENGTH || verifying) return;
    setVerifying(true);
    setError(null);
    setNotice(null);
    try {
      onVerified(await verifyWalletEmailCode(token, code));
    } catch (err) {
      const errorCode = (err as ApiErrorShape).response?.data?.error?.code;
      // 這組驗證碼已不能用：清空輸入、可以馬上重寄（伺服器仍限制寄送次數）
      if (errorCode === 'VERIFICATION_CODE_LOCKED' || errorCode === 'VERIFICATION_CODE_EXPIRED') {
        setCode('');
        setCooldown(0);
      }
      handleError(err, '無法確認驗證碼，請確認網路後再試');
    } finally {
      setVerifying(false);
    }
  };

  const footer = sent ? (
    <>
      <FanButton type="submit" form={FORM_ID} disabled={code.length !== CODE_LENGTH || verifying}>
        {verifying ? '確認中…' : '確認'}
      </FanButton>
      <FanButton variant="secondary" onClick={() => void send()} disabled={sending || cooldown > 0}>
        {cooldown > 0 ? `重新寄送（${cooldown} 秒）` : sending ? '寄送中…' : '重新寄送'}
      </FanButton>
      {backToLine}
    </>
  ) : (
    <>
      <FanButton onClick={() => void send()} disabled={sending}>
        {sending ? '寄送中…' : '寄送驗證碼'}
      </FanButton>
      {backToLine}
    </>
  );

  return (
    <FanShell title="優惠券" nav="close" onNav={onClose} footer={<div className="flex flex-col gap-3">{footer}</div>}>
      <StatusMessage
        icon={<Mail className="h-9 w-9" aria-hidden />}
        title="確認是你本人"
        description={
          sent
            ? `已寄出 6 位數驗證碼到 ${maskedEmail}，10 分鐘內有效。\n沒收到的話，請檢查垃圾郵件匣。`
            : `為了確認是你本人，我們會寄 6 位數驗證碼到 ${maskedEmail}`
        }
      >
        {sent && (
          <form id={FORM_ID} onSubmit={verify} noValidate className="flex flex-col gap-2 text-left">
            <label htmlFor="wallet-email-code" className="text-sm font-semibold text-foreground">
              驗證碼
            </label>
            <input
              id="wallet-email-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
              className="h-12 w-full rounded-xl border border-border bg-background px-4 text-center text-xl font-semibold tracking-[0.4em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm font-medium text-muted-foreground">
            {notice}
          </p>
        )}
      </StatusMessage>
    </FanShell>
  );
}
