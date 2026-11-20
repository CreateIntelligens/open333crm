/**
 * 執行後台助理的導覽（規格 dashboard-guide-assistant「員工按下『帶我去』後才執行導覽」「導覽逐步顯示說明卡」）。
 *
 * 1. 目前的路徑不是導覽的 route 時，切換到 route，並等待路徑變成 route。
 * 2. 每個步驟等待 `[data-guide="<target>"]` 出現，最多 timeoutMs。
 * 3. 把元素捲到畫面內；highlight 步驟另外讓它取得焦點。
 * 4. 交給 showStep() 標示元素並顯示說明卡，等員工操作完再進行下一步。
 *
 * runner 不點擊任何元素。click 步驟由員工點擊，或由說明卡的「下一步」代員工點擊（GuideSpotlight.tsx）。
 * 導覽目錄只允許點擊以 `.open` 結尾的元素，所以不會點到儲存或送出（guide-catalog.ts）。
 */
import type { GuideDefinition, GuideStep } from '@open333crm/shared';

/** 每個步驟等待元素出現的時間 */
export const GUIDE_STEP_TIMEOUT_MS = 5000;

const POLL_MS = 50;

export interface GuideRunnerDeps {
  /** 按下「帶我去」時的路徑 */
  currentPath: string;
  /** 讀取目前的路徑。切換頁面後用來確認新頁面已經生效 */
  getPath: () => string;
  navigate: (route: string) => void;
  /**
   * 標示元素並顯示說明卡。員工完成這一步時回 'next'；按 Esc 或點擊其他地方時回 'cancel'。
   * click 步驟的 'next' 代表元素已經被點擊。
   */
  showStep: (el: HTMLElement, step: GuideStep, progress: GuideStepProgress) => Promise<'next' | 'cancel'>;
  timeoutMs?: number;
}

/** 第 index 步，共 total 步；index 從 1 開始 */
export interface GuideStepProgress {
  index: number;
  total: number;
}

export type GuideRunResult =
  | { ok: true }
  | { ok: false; reason: 'missing'; missingTarget: string }
  | { ok: false; reason: 'cancelled' };

function findTarget(target: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-guide="${target}"]`);
}

/** 每 POLL_MS 檢查一次 `check()`，回傳第一個不是 null 的結果；逾時回 null */
function waitFor<T>(check: () => T | null, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const first = check();
    if (first !== null) return resolve(first);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const value = check();
      if (value !== null || Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        resolve(value);
      }
    }, POLL_MS);
  });
}

export async function runGuide(guide: GuideDefinition, deps: GuideRunnerDeps): Promise<GuideRunResult> {
  const timeoutMs = deps.timeoutMs ?? GUIDE_STEP_TIMEOUT_MS;
  if (deps.currentPath !== guide.route) {
    deps.navigate(guide.route);
    // 舊頁面可能有同名的元素（例如行銷各分頁共用的建立按鈕）：路徑變成功能頁之前不找元素
    const arrived = await waitFor(() => (deps.getPath() === guide.route ? true : null), timeoutMs);
    if (!arrived) return { ok: false, reason: 'missing', missingTarget: guide.steps[0].target };
  }

  const total = guide.steps.length;
  for (const [i, step] of guide.steps.entries()) {
    const el = await waitFor(() => findTarget(step.target), timeoutMs);
    if (!el) return { ok: false, reason: 'missing', missingTarget: step.target };
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    if (step.action === 'highlight') el.focus({ preventScroll: true });
    const outcome = await deps.showStep(el, step, { index: i + 1, total });
    if (outcome === 'cancel') return { ok: false, reason: 'cancelled' };
  }
  return { ok: true };
}
