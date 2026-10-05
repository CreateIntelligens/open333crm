/**
 * 節流：第一次呼叫立即執行；間隔內的呼叫合併成一次，在間隔結束時補執行。
 * 只在開頭執行的 debounce 會丟掉間隔內的最後一次呼叫，畫面停在舊資料。
 */
export function createTrailingThrottle(fn: () => void, ms: number): (() => void) & { cancel: () => void } {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = () => {
    timer = null;
    last = Date.now();
    fn();
  };

  const run = () => {
    const wait = last + ms - Date.now();
    if (wait <= 0 && !timer) {
      fire();
    } else if (!timer) {
      timer = setTimeout(fire, Math.max(wait, 0));
    }
  };

  return Object.assign(run, {
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  });
}
