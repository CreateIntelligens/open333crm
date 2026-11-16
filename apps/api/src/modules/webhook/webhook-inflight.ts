/**
 * webhook 背景處理的進行中追蹤（change add-comment-keyword-private-reply design D3）。
 *
 * webhook 先回 200、事件在背景處理。部署重啟時 Meta 不會重送已回 200 的事件，所以關機時要等進行中的
 * 背景處理完成（最多 10 秒）再關連線；否則留言與私訊會在處理到一半時消失。
 */
import { logger } from '@open333crm/core';

export const WEBHOOK_DRAIN_TIMEOUT_MS = 10_000;

export interface InFlightTracker {
  /** 登記一個背景處理；回傳同一個 promise（錯誤由呼叫端的 catch 處理） */
  track<T>(work: Promise<T>): Promise<T>;
  /** 進行中的數量 */
  size(): number;
  /** 等所有進行中的背景處理結束，最多 timeoutMs；逾時回 false */
  drain(timeoutMs?: number): Promise<boolean>;
}

export function createInFlightTracker(): InFlightTracker {
  const pending = new Set<Promise<unknown>>();
  return {
    track(work) {
      const settled = work.then(
        () => undefined,
        () => undefined,
      );
      pending.add(settled);
      void settled.finally(() => pending.delete(settled));
      return work;
    },
    size: () => pending.size,
    async drain(timeoutMs = WEBHOOK_DRAIN_TIMEOUT_MS) {
      if (pending.size === 0) return true;
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      });
      const done = (async () => {
        // 等待期間可能又有新的處理進來（關機前最後一刻的請求），一直等到集合清空
        while (pending.size > 0) await Promise.all([...pending]);
        return true as const;
      })();
      const ok = await Promise.race([done, timeout]);
      if (timer) clearTimeout(timer);
      if (!ok) logger.warn('[Webhook] 關機時仍有背景處理未完成，已達等待上限', { pending: pending.size, timeoutMs });
      return ok;
    },
  };
}
