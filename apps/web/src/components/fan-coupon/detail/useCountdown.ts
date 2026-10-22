'use client';

/**
 * 倒數到指定時間（伺服器回傳的 expiresAt）。每秒重算一次「到期時間 − 現在」，
 * 不是每秒減一：分頁被切到背景時計時器會被瀏覽器延後，用減法才不會越跑越慢。
 */
import { useEffect, useState } from 'react';

function secondsLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - Date.now()) / 1000));
}

/** 回傳剩餘秒數；沒有到期時間時回 null。到 0 後停止計時。 */
export function useCountdown(expiresAt: string | null): number | null {
  const [left, setLeft] = useState<number | null>(() => secondsLeft(expiresAt));

  useEffect(() => {
    setLeft(secondsLeft(expiresAt));
    if (!expiresAt) return;
    const timer = setInterval(() => {
      const next = secondsLeft(expiresAt);
      setLeft(next);
      if (next === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  return left;
}
