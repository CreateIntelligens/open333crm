'use client';

/**
 * 店員驗證碼核銷（Figma 顧客端 C5～C5.7；spec「店員驗證碼核銷須在時限內完成」）。
 *
 * 進入畫面即向後端開啟 5 分鐘核銷時段，倒數以伺服器回傳的剩餘毫秒為準（不受手機時鐘誤差影響）。
 * 驗證碼由店員在顧客手機上輸入：只收數字、遮蔽顯示，格數等於券的 staffCodeLength。
 * 錯誤時後端回剩餘次數；錯到上限時段會被關閉，須回詳情重新開始。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { redeemWithStaffCode, startStaffCodeSession, type FanCoupon } from '@/hooks/useFanCoupons';
import { getApiErrorCode, getApiErrorDetails, getApiErrorMessage } from '@/lib/api-error';
import { conditionText } from '@/lib/fan-coupon/labels';
import { FanShell, StatusMessage } from '../FanShell';
import { FanCouponCard } from '../FanCouponCard';
import { btnPrimary, btnSubtle, formatClock } from './ui';
import { useCountdown } from './useCountdown';

/** 核銷時段長度（秒），用於進度條比例；與後端 REDEEM_SESSION_MS 一致 */
const SESSION_SECONDS = 300;

/** 核銷中止、須由外層處理的情況 */
export type RedeemAbort =
  | { kind: 'restart' }
  | { kind: 'already'; redeemedAt?: string }
  | { kind: 'unavailable'; code: string };

/** 這些錯誤代表券本身已不能用，交給外層重新抓資料並顯示對應狀態 */
const UNAVAILABLE_CODES = new Set(['EXPIRED', 'REVOKED', 'NOT_YET_VALID', 'NOT_STAFF_CODE', 'NOT_CLAIMED', 'NOT_FOUND']);

interface Props {
  item: FanCoupon;
  onBack: () => void;
  onRedeemed: (redeemedAt: string) => void;
  onAbort: (abort: RedeemAbort) => void;
}

type Phase = 'starting' | 'startError' | 'input' | 'timeup';

/** 同一張券 24 小時內驗證碼錯誤太多次（後端 MAX_DAILY_CODE_ATTEMPTS）：重試也不會成功，不提供重試 */
const TOO_MANY_ATTEMPTS_TEXT = '驗證碼錯誤次數過多，這張券 24 小時內不能核銷。如需協助請聯絡客服。';

export function StaffCodeRedeem({ item, onBack, onRedeemed, onAbort }: Props) {
  const length = Math.min(6, Math.max(4, item.coupon.staffCodeLength ?? 6));
  const [phase, setPhase] = useState<Phase>('starting');
  const [startError, setStartError] = useState('');
  const [locked, setLocked] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** 驗證碼錯誤：剩餘次數（紅框＋提示） */
  const [mismatch, setMismatch] = useState<number | null>(null);
  /** 網路或其他錯誤：券沒有被使用，可重試 */
  const [submitError, setSubmitError] = useState('');
  const lock = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const left = useCountdown(expiresAt);

  const start = useCallback(async () => {
    setPhase('starting');
    setStartError('');
    try {
      const session = await startStaffCodeSession(item.id);
      // 以「收到回應的本機時間＋伺服器算的剩餘毫秒」當倒數終點，手機時鐘不準也不影響
      setExpiresAt(new Date(Date.now() + session.remainingMs).toISOString());
      setPhase('input');
    } catch (err) {
      const code = getApiErrorCode(err);
      if (code === 'ALREADY_REDEEMED') return onAbort({ kind: 'already' });
      if (code && UNAVAILABLE_CODES.has(code)) return onAbort({ kind: 'unavailable', code });
      const tooMany = code === 'TOO_MANY_ATTEMPTS';
      setLocked(tooMany);
      setStartError(tooMany ? TOO_MANY_ATTEMPTS_TEXT : getApiErrorMessage(err, '無法開始核銷，請稍後重試'));
      setPhase('startError');
    }
  }, [item.id, onAbort]);

  useEffect(() => {
    void start();
  }, [start]);

  // 倒數歸零：送出中的請求會自己處理結果，其餘情況切到「核銷時間已結束」
  useEffect(() => {
    if (phase === 'input' && left === 0 && !submitting) {
      inputRef.current?.blur();
      setPhase('timeup');
    }
  }, [phase, left, submitting]);

  const timeUp = left === 0;
  const urgent = left !== null && left <= 60 && left > 0;
  const full = value.length === length;
  const canSubmit = phase === 'input' && full && !submitting && !timeUp;

  const handleChange = (raw: string) => {
    if (timeUp || submitting) return;
    const next = raw.replace(/\D/g, '').slice(0, length);
    setValue(next);
    if (next.length > 0) setMismatch(null);
    setSubmitError('');
    // 輸滿自動收起鍵盤
    if (next.length === length) inputRef.current?.blur();
  };

  const submit = async () => {
    if (!canSubmit || lock.current) return;
    lock.current = true;
    setSubmitting(true);
    setSubmitError('');
    try {
      const result = await redeemWithStaffCode(item.id, value);
      onRedeemed(result.redeemedAt);
    } catch (err) {
      const code = getApiErrorCode(err);
      const details = getApiErrorDetails(err) ?? {};
      if (code === 'STAFF_CODE_MISMATCH') {
        const attemptsLeft = typeof details.attemptsLeft === 'number' ? details.attemptsLeft : null;
        if (attemptsLeft === 0) {
          onAbort({ kind: 'restart' });
        } else {
          setValue('');
          setMismatch(attemptsLeft ?? -1);
          inputRef.current?.focus();
        }
      } else if (code === 'SESSION_REQUIRED') {
        onAbort({ kind: 'restart' });
      } else if (code === 'TOO_MANY_ATTEMPTS') {
        setLocked(true);
        setStartError(TOO_MANY_ATTEMPTS_TEXT);
        setPhase('startError');
      } else if (code === 'SESSION_EXPIRED') {
        setPhase('timeup');
      } else if (code === 'ALREADY_REDEEMED' || code === 'CONFLICT') {
        onAbort({ kind: 'already', redeemedAt: typeof details.redeemedAt === 'string' ? details.redeemedAt : undefined });
      } else if (code && UNAVAILABLE_CODES.has(code)) {
        onAbort({ kind: 'unavailable', code });
      } else {
        setSubmitError(`${getApiErrorMessage(err, '核銷沒有送出，請重試')}（這張券尚未被使用）`);
      }
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  };

  const back = () => {
    if (!submitting) onBack();
  };

  if (phase === 'timeup') {
    return (
      <FanShell title="確認核銷" nav="back" onNav={back}>
        <StatusMessage
          icon={<Clock className="h-8 w-8" aria-hidden />}
          title="核銷時間已結束"
          description="券沒有被使用，可以返回後重新開始。"
        >
          <button type="button" className={btnSubtle} onClick={onBack}>
            返回票券詳情
          </button>
        </StatusMessage>
      </FanShell>
    );
  }

  if (phase !== 'input') {
    return (
      <FanShell title="確認核銷" nav="back" onNav={back}>
        {phase === 'starting' ? (
          <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            正在開始核銷…
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-10 text-center">
            <p role="alert" className="text-sm font-semibold text-destructive">
              {startError}
            </p>
            {!locked && (
              <button type="button" className={btnPrimary} onClick={() => void start()}>
                重試
              </button>
            )}
            <button type="button" className={btnSubtle} onClick={onBack}>
              返回票券詳情
            </button>
          </div>
        )}
      </FanShell>
    );
  }

  const progress = left === null ? 1 : Math.min(1, left / SESSION_SECONDS);
  const activeIndex = Math.min(value.length, length - 1);
  const condition = conditionText(item.coupon) || item.coupon.name;

  return (
    <FanShell
      title="確認核銷"
      nav="back"
      onNav={back}
      footer={
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            className={btnPrimary}
            disabled={!canSubmit}
            aria-busy={submitting}
            onClick={() => void submit()}
          >
            {submitting ? '核銷中…' : '確認核銷'}
          </button>
          <button type="button" className={btnSubtle} disabled={submitting} onClick={onBack}>
            取消，稍後使用
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <p className="text-base font-extrabold leading-5 text-foreground">請將手機交給店員輸入驗證碼</p>
          <p className="mt-1 font-mono text-xs leading-5 text-muted-foreground">核銷後此券立即失效且無法復原</p>
        </div>

        <FanCouponCard item={item} />

        <section aria-label="核銷資訊" className="overflow-hidden rounded-2xl bg-card shadow-[0_0_1px_rgba(0,0,0,0.2)]">
          {/* 倒數區 */}
          <div className="bg-warning-subtle px-4 pb-3 pt-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-bold text-warning">剩餘核銷時間</span>
              <span
                className={cn('text-2xl font-black tabular-nums leading-8', urgent ? 'text-destructive' : 'text-warning')}
                aria-live="off"
              >
                {formatClock(left ?? SESSION_SECONDS)}
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-xl bg-muted-foreground/30">
              <div
                className={cn('h-full rounded-xl transition-[width] duration-1000 ease-linear motion-reduce:transition-none', urgent ? 'bg-destructive' : 'bg-warning')}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            {urgent && (
              <p role="status" className="mt-2 font-mono text-xs font-bold leading-4 text-destructive">
                剩餘 1 分鐘，請盡快完成
              </p>
            )}
          </div>

          {/* 使用條件與驗證碼 */}
          <div className="flex flex-col gap-3 p-4">
            <p className="text-xs font-medium text-muted-foreground">使用條件(請店員確認)</p>
            <p className="text-xl font-black leading-7 text-foreground">{condition}</p>

            <div className="relative mt-1">
              <div aria-hidden className="flex gap-3">
                {Array.from({ length }, (_, i) => (
                  <div
                    key={i}
                    data-otp-cell
                    className={cn(
                      'flex h-[49px] flex-1 items-center justify-center rounded-xl border bg-card text-2xl font-extrabold text-foreground',
                      mismatch !== null
                        ? 'border-2 border-destructive'
                        : focused && i === activeIndex && !full
                          ? 'border-2 border-foreground'
                          : 'border-muted-foreground/40',
                    )}
                  >
                    {i < value.length ? '●' : ''}
                  </div>
                ))}
              </div>
              <label htmlFor="staff-code-input" className="sr-only">
                店員驗證碼（{length} 位數）
              </label>
              <input
                ref={inputRef}
                id="staff-code-input"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={length}
                value={value}
                disabled={submitting || timeUp}
                aria-invalid={mismatch !== null}
                aria-describedby="staff-code-hint"
                onChange={(e) => handleChange(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit();
                }}
                className="absolute inset-0 h-full w-full cursor-text opacity-0"
              />
            </div>

            <div className="flex flex-col gap-2">
              {mismatch !== null && (
                <p role="alert" className="text-xs font-extrabold leading-5 text-destructive">
                  <span>驗證碼錯誤，請重新輸入</span>
                  {mismatch > 0 && <span className="ml-1 font-semibold">（還可以再試 {mismatch} 次）</span>}
                </p>
              )}
              {submitError && (
                <p role="alert" className="text-xs font-bold leading-5 text-destructive">
                  {submitError}
                </p>
              )}
              <p id="staff-code-hint" className="text-xs font-medium leading-5 text-muted-foreground">
                請店員輸入 {length} 位數核銷碼，此碼會記錄於核銷紀錄中
              </p>
            </div>
          </div>
        </section>
      </div>
    </FanShell>
  );
}
