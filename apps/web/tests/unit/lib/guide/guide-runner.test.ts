// @vitest-environment jsdom
/**
 * 導覽的執行（change add-dashboard-guide-assistant，規格 dashboard-guide-assistant「員工按下『帶我去』後才執行導覽」「導覽逐步顯示說明卡」）。
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test, vi } from 'vitest';
import type { GuideDefinition, GuideStep } from '@open333crm/shared';
import { runGuide, type GuideStepProgress } from '#src/lib/guide/guide-runner.js';

const KEYWORD_GUIDE: GuideDefinition = {
  id: 'keyword-reply.create',
  title: '新增關鍵字自動回覆',
  route: '/dashboard/line/keyword-replies',
  requiredPermission: 'automation.manage',
  steps: [
    { target: 'keyword-reply.open', action: 'click', note: '點新增' },
    { target: 'keyword-reply.keyword', action: 'highlight', note: '輸入關鍵字' },
  ],
};

function addElement(html: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  const el = wrapper.firstElementChild as HTMLElement;
  document.body.appendChild(el);
  return el;
}

/** 目前路徑固定、切換頁面時路徑跟著改的假路由 */
function fakeRouter(start: string) {
  let path = start;
  const navigated: string[] = [];
  return {
    navigated,
    deps: {
      currentPath: start,
      getPath: () => path,
      navigate: (route: string) => {
        navigated.push(route);
        path = route;
      },
    },
  };
}

/** 每一步都立刻按「下一步」 */
const next = async () => 'next' as const;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('員工按下「帶我去」後才執行導覽', () => {
  test('先切換頁面', async () => {
    const router = fakeRouter('/dashboard/inbox');
    addElement('<button data-guide="keyword-reply.open"></button>');
    addElement('<input data-guide="keyword-reply.keyword" />');
    const result = await runGuide(KEYWORD_GUIDE, { ...router.deps, showStep: next, timeoutMs: 200 });
    assert.deepEqual(router.navigated, ['/dashboard/line/keyword-replies']);
    assert.deepEqual(result, { ok: true });
  });

  test('已在功能頁時不切換頁面', async () => {
    const router = fakeRouter(KEYWORD_GUIDE.route);
    addElement('<button data-guide="keyword-reply.open"></button>');
    addElement('<input data-guide="keyword-reply.keyword" />');
    await runGuide(KEYWORD_GUIDE, { ...router.deps, showStep: next, timeoutMs: 200 });
    assert.deepEqual(router.navigated, []);
  });

  test('找不到欄位', async () => {
    const router = fakeRouter(KEYWORD_GUIDE.route);
    addElement('<button data-guide="keyword-reply.open"></button>');
    const showStep = vi.fn(next);
    const result = await runGuide(KEYWORD_GUIDE, { ...router.deps, showStep, timeoutMs: 50 });
    assert.deepEqual(result, { ok: false, reason: 'missing', missingTarget: 'keyword-reply.keyword' });
    assert.equal(showStep.mock.calls.length, 1, '找不到第 2 步的欄位時不標示它');
  });

  test('切換頁面後才找元素', async () => {
    // 舊頁面上同名的元素不能被點到：路徑變成功能頁之前不找元素
    let path = '/dashboard/marketing/segments';
    const navigated: string[] = [];
    const stale = addElement('<button data-guide="keyword-reply.open"></button>');
    const staleClick = vi.fn();
    stale.addEventListener('click', staleClick);
    const result = await runGuide(KEYWORD_GUIDE, {
      currentPath: path,
      getPath: () => path,
      navigate: (route) => {
        navigated.push(route);
        setTimeout(() => {
          stale.remove();
          path = route;
          addElement('<button data-guide="keyword-reply.open"></button>');
          addElement('<input data-guide="keyword-reply.keyword" />');
        }, 30);
      },
      showStep: next,
      timeoutMs: 500,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(staleClick.mock.calls.length, 0);
  });
});

describe('導覽逐步顯示說明卡', () => {
  test('點擊步驟等員工操作', async () => {
    const router = fakeRouter(KEYWORD_GUIDE.route);
    const open = addElement('<button data-guide="keyword-reply.open"></button>');
    addElement('<input data-guide="keyword-reply.keyword" />');
    const clicked = vi.fn();
    open.addEventListener('click', clicked);
    const calls: Array<{ el: HTMLElement; step: GuideStep; progress: GuideStepProgress }> = [];
    let answer: (value: 'next' | 'cancel') => void = () => {};
    const running = runGuide(KEYWORD_GUIDE, {
      ...router.deps,
      showStep: (el, step, progress) => {
        calls.push({ el, step, progress });
        return new Promise((resolve) => (answer = resolve));
      },
      timeoutMs: 200,
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(calls.length, 1, '員工操作之前不標示第 2 步');
    assert.equal(calls[0].el, open);
    assert.deepEqual(calls[0].progress, { index: 1, total: 2 });
    assert.equal(clicked.mock.calls.length, 0, '不自動點擊');
    answer('next');
    await new Promise((r) => setTimeout(r, 30));
    answer('next');
    assert.deepEqual(await running, { ok: true });
    assert.equal(clicked.mock.calls.length, 0, '員工按下一步時由說明卡點擊，runner 不點擊');
  });

  test('員工點擊元素後進行下一步', async () => {
    const router = fakeRouter(KEYWORD_GUIDE.route);
    const open = addElement('<button data-guide="keyword-reply.open"></button>');
    // 點擊入口後欄位才出現，同對話框的行為
    open.addEventListener('click', () => {
      setTimeout(() => addElement('<input data-guide="keyword-reply.keyword" />'), 20);
    });
    const calls: Array<{ el: HTMLElement; step: GuideStep; progress: GuideStepProgress; focused: Element | null }> = [];
    const result = await runGuide(KEYWORD_GUIDE, {
      ...router.deps,
      showStep: async (el, step, progress) => {
        calls.push({ el, step, progress, focused: document.activeElement });
        if (step.action === 'click') el.click(); // 員工點擊被標示的元素
        return 'next';
      },
      timeoutMs: 500,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].el.getAttribute('data-guide'), 'keyword-reply.keyword');
    assert.deepEqual(calls[1].progress, { index: 2, total: 2 });
    assert.equal(calls[1].step.note, '輸入關鍵字');
    assert.equal(calls[1].focused, calls[1].el, '標示前讓欄位取得焦點');
  });

  test('員工中途結束導覽', async () => {
    const router = fakeRouter(KEYWORD_GUIDE.route);
    addElement('<button data-guide="keyword-reply.open"></button>');
    addElement('<input data-guide="keyword-reply.keyword" />');
    const showStep = vi.fn(async () => 'cancel' as const);
    const result = await runGuide(KEYWORD_GUIDE, { ...router.deps, showStep, timeoutMs: 200 });
    assert.deepEqual(result, { ok: false, reason: 'cancelled' });
    assert.equal(showStep.mock.calls.length, 1, '結束後不進行第 2 步');
  });
});
