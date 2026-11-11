'use client';

/**
 * 嘗試關閉票券頁回到 LINE。
 *
 * 一般瀏覽器只能關閉由程式開啟的分頁；LINE／FB 內建瀏覽器或使用者自行開啟的分頁，
 * window.close() 會被忽略且不丟錯。所以呼叫後稍等一下，若頁面還在就提示顧客自行關閉，
 * 不讓按鈕看起來「沒反應」。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** 等瀏覽器處理關閉的時間；超過仍未關閉就顯示提示 */
const CLOSE_CHECK_MS = 500;

export function useTryClose() {
  const [showHint, setShowHint] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const tryClose = useCallback(() => {
    window.close();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!window.closed) setShowHint(true);
    }, CLOSE_CHECK_MS);
  }, []);

  return { tryClose, showHint };
}

/** 無法關閉時的提示文字 */
export const CLOSE_HINT = '請直接關閉此頁面';
