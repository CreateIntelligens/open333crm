'use client';

/**
 * 中途離開提醒（Jira CM-196 #11–14；UX 規則第 3 節「中途離開」）。
 *
 * Next.js App Router 沒有內建的路由攔截，因此這裡自己接三個入口：
 * - 站內連結（側欄、麵包屑、其他 <a>）：在 document 的 capture 階段攔下點擊，
 *   比 next/link 掛在 React root 上的 handler 先執行，所以 stopPropagation 後 Link 不會導頁。
 * - 瀏覽器上一頁：有修改時先 push 一筆同網址的「守衛」紀錄；按上一頁會先退到原紀錄，
 *   觸發 popstate，這時再補回守衛紀錄並詢問。確認離開才真的往回走兩步。
 * - 重新整理、關閉分頁：beforeunload，交給瀏覽器的原生提醒（無法自訂文案）。
 * 程式內的離開（取消按鈕）呼叫 attempt() / navigate()，走同一個確認框。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface LeaveGuard {
  /** 確認框是否開啟 */
  open: boolean;
  /** 想離開：沒有修改時直接執行 proceed，有修改時先開確認框 */
  attempt: (proceed: () => void) => void;
  /** 想前往站內網址（取消按鈕、麵包屑） */
  navigate: (href: string) => void;
  /** 繼續編輯：關閉確認框 */
  stay: () => void;
  /** 放棄修改並離開 */
  leave: () => void;
  /** 儲存成功後離開：之後的導頁不再攔截 */
  release: () => void;
}

const GUARD_KEY = '__couponLeaveGuard';

export function useLeaveGuard(dirty: boolean): LeaveGuard {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const pendingRef = useRef<(() => void) | null>(null);
  const dirtyRef = useRef(dirty);
  const releasedRef = useRef(false);
  const guardPushedRef = useRef(false);
  const goingBackRef = useRef(false);

  dirtyRef.current = dirty;
  const shouldBlock = () => dirtyRef.current && !releasedRef.current;

  const ask = useCallback((proceed: () => void) => {
    pendingRef.current = proceed;
    setOpen(true);
  }, []);

  const attempt = useCallback(
    (proceed: () => void) => {
      if (!dirtyRef.current || releasedRef.current) {
        proceed();
        return;
      }
      ask(proceed);
    },
    [ask],
  );

  const navigate = useCallback(
    (href: string) =>
      attempt(() => {
        releasedRef.current = true;
        router.push(href);
      }),
    [attempt, router],
  );

  const stay = useCallback(() => {
    pendingRef.current = null;
    setOpen(false);
  }, []);

  const leave = useCallback(() => {
    releasedRef.current = true;
    const proceed = pendingRef.current;
    pendingRef.current = null;
    setOpen(false);
    proceed?.();
  }, []);

  const release = useCallback(() => {
    releasedRef.current = true;
    pendingRef.current = null;
    setOpen(false);
  }, []);

  // 重新整理、關閉分頁
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!shouldBlock()) return;
      e.preventDefault();
      // 舊版 Chrome 需要設定 returnValue 才會顯示提醒
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // 站內連結
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!shouldBlock() || e.defaultPrevented || e.button !== 0) return;
      // 新分頁開啟不會離開本頁
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as Element | null;
      const a = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href') ?? '';
      if (!href || href.startsWith('#')) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      // 站外連結交給 beforeunload
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      e.stopPropagation();
      const to = url.pathname + url.search + url.hash;
      ask(() => {
        releasedRef.current = true;
        router.push(to);
      });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [router, ask]);

  // 上一頁：第一次有修改時才放守衛紀錄，避免沒改動也多一筆歷史
  useEffect(() => {
    if (!dirty || guardPushedRef.current) return;
    guardPushedRef.current = true;
    try {
      window.history.pushState({ ...(window.history.state ?? {}), [GUARD_KEY]: true }, '');
    } catch {
      guardPushedRef.current = false;
    }
  }, [dirty]);

  useEffect(() => {
    const onPopState = () => {
      if (!guardPushedRef.current || goingBackRef.current) return;
      if (shouldBlock()) {
        // 補回守衛紀錄，讓網址與頁面維持在編輯頁
        try {
          window.history.pushState({ ...(window.history.state ?? {}), [GUARD_KEY]: true }, '');
        } catch {
          /* 無法補回時仍顯示確認框 */
        }
        ask(() => {
          releasedRef.current = true;
          goingBackRef.current = true;
          window.history.go(-2);
        });
        return;
      }
      // 沒有修改（例如已儲存）：守衛紀錄已退掉，再退一步才是真正的上一頁
      goingBackRef.current = true;
      window.history.back();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [ask]);

  return { open, attempt, navigate, stay, leave, release };
}
