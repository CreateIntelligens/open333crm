// @vitest-environment jsdom
/**
 * 導覽的執行（change add-dashboard-guide-assistant，規格 dashboard-guide-assistant「員工按下『帶我去』後才執行導覽」）。
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test, vi } from 'vitest';
import type { GuideDefinition, GuideStep } from '@open333crm/shared';
import { runGuide } from '#src/lib/guide/guide-runner.js';

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

afterEach(() => {
  document.body.innerHTML = '';
});

describe('員工按下「帶我去」後才執行導覽', () => {
  test('先切換頁面', async () => {
    const router = fakeRouter('/dashboard/inbox');
    addElement('<button data-guide="keyword-reply.open"></button>');
    addElement('<input data-guide="keyword-reply.keyword" />');
    const result = await runGuide(KEYWORD_GUIDE, { ...router.deps, highlight: () => {}, timeoutMs: 200 });
    assert.deepEqual(router.navigated, ['/dashboard/line/keyword-replies']);
    assert.deepEqual(result, { ok: true });
  });

  test('已在功能頁時不切換頁面', async () => {
    const router = fakeRouter(KEYWORD_GUIDE.route);
    addElement('<button data-guide="keyword-reply.open"></button>');
    addElement('<input data-guide="keyword-reply.keyword" />');
    await runGuide(KEYWORD_GUIDE, { ...router.deps, highlight: () => {}, timeoutMs: 200 });
    assert.deepEqual(router.navigated, []);
  });

  test('點開入口並標示欄位', async () => {
    const router = fakeRouter(KEYWORD_GUIDE.route);
    const open = addElement('<button data-guide="keyword-reply.open"></button>');
    // 點擊入口後欄位才出現，同對話框的行為
    open.addEventListener('click', () => {
      setTimeout(() => addElement('<input data-guide="keyword-reply.keyword" />'), 20);
    });
    const highlighted: Array<{ el: HTMLElement; step: GuideStep }> = [];
    const result = await runGuide(KEYWORD_GUIDE, {
      ...router.deps,
      highlight: (el, step) => highlighted.push({ el, step }),
      timeoutMs: 500,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(highlighted.length, 1);
    assert.equal(highlighted[0].el.getAttribute('data-guide'), 'keyword-reply.keyword');
    assert.equal(highlighted[0].step.note, '輸入關鍵字');
    assert.equal(document.activeElement, highlighted[0].el, '標示的欄位取得焦點');
  });

  test('找不到欄位', async () => {
    const router = fakeRouter(KEYWORD_GUIDE.route);
    const open = addElement('<button data-guide="keyword-reply.open"></button>');
    const clicked = vi.fn();
    open.addEventListener('click', clicked);
    const highlight = vi.fn();
    const result = await runGuide(KEYWORD_GUIDE, { ...router.deps, highlight, timeoutMs: 50 });
    assert.deepEqual(result, { ok: false, missingTarget: 'keyword-reply.keyword' });
    assert.equal(clicked.mock.calls.length, 1);
    assert.equal(highlight.mock.calls.length, 0, '找不到欄位時不標示');
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
      highlight: () => {},
      timeoutMs: 500,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(staleClick.mock.calls.length, 0);
  });
});
