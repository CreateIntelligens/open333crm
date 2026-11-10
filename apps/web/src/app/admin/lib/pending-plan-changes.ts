'use client';

import { useCallback, useEffect, useState } from 'react';
import { platformApi } from './platform-api';

/** 升級申請頁核准或駁回後送出，側欄收到後重新載入待審數量（change add-plan-change-platform-notify） */
export const PLAN_CHANGES_UPDATED_EVENT = 'platform:plan-changes-updated';

const REFRESH_MS = 60_000;

export function notifyPlanChangesUpdated(): void {
  window.dispatchEvent(new Event(PLAN_CHANGES_UPDATED_EVENT));
}

/**
 * 待審申請數量：以既有的待審列表筆數計算（一個租戶最多一筆待審，列表很小）。
 * 換頁、每 60 秒、收到審核事件時重新載入。載入失敗時回傳 null，側欄不顯示數量。
 */
export function usePendingPlanChangeCount(pathname: string | null, enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await platformApi.get('/plan-change-requests');
      const rows = res.data?.data;
      setCount(Array.isArray(rows) ? rows.length : null);
    } catch {
      // 數量只是提示：載入失敗時不顯示，升級申請頁本身仍列出所有待審申請
      setCount(null);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load, pathname]);

  useEffect(() => {
    if (!enabled) return;
    const onUpdated = () => void load();
    window.addEventListener(PLAN_CHANGES_UPDATED_EVENT, onUpdated);
    const timer = window.setInterval(onUpdated, REFRESH_MS);
    return () => {
      window.removeEventListener(PLAN_CHANGES_UPDATED_EVENT, onUpdated);
      window.clearInterval(timer);
    };
  }, [enabled, load]);

  return count;
}
