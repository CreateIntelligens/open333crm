'use client';

/**
 * 店員核銷台（/redeem）共用的 hook 與小工具。
 */
import { useEffect, useState } from 'react';

/**
 * 倒數到 until（毫秒時間戳）剩下的毫秒數，每 250ms 更新一次；until 為 null 時回傳 0。
 * 用於帳號鎖定的「請於 m:ss 後再試」。
 */
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until == null) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 250);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [until]);
  return until == null ? 0 : Math.max(0, until - now);
}

/** 震動回饋：瀏覽器支援才呼叫（iOS Safari 沒有 navigator.vibrate） */
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {
    // 部分瀏覽器在沒有使用者手勢時會丟例外，震動只是輔助回饋，忽略即可
  }
}

/** 每次按「確認核銷」產生新的重試鍵；網路錯誤重試時沿用同一個 */
export function newRedeemKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // 非安全來源（http）沒有 randomUUID，改用下面的備援
  }
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
