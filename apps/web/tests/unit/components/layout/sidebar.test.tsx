// @vitest-environment jsdom
/**
 * 側邊選單依權限顯示項目（openspec/specs/permission-check「前端依權限顯示選單」）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// useAuth() 回傳同一個物件，如同 AuthProvider 以 useCallback 保持 hasPermission 不變。
// 每次渲染都給新的 hasPermission 會讓 Sidebar 的 effect 無限重跑。
const { nav, auth, authValue } = vi.hoisted(() => {
  const auth = { permissions: new Set<string>(), permissionsError: false };
  return {
    nav: { pathname: '/dashboard/inbox' },
    auth,
    authValue: {
      agent: { id: 'a1', name: '測試成員', email: 'a@example.com', role: 'AGENT' },
      logout: () => {},
      hasPermission: (code: string) => auth.permissions.has(code),
      get permissionsError() {
        return auth.permissionsError;
      },
      reloadPermissions: vi.fn(async () => {}),
    },
  };
});
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('#src/providers/AuthProvider.js', () => ({ useAuth: () => authValue }));

import { Sidebar, SectionNav } from '#src/components/layout/Sidebar.js';

// 圖示欄只有圖示，名稱放在 aria-label；子選單是文字連結。兩者都用 link 的可及名稱判斷。
const visible = (label: string | RegExp) => screen.queryAllByRole('link', { name: label }).length > 0;

beforeEach(() => {
  window.localStorage.clear();
  nav.pathname = '/dashboard/inbox';
  auth.permissions = new Set();
  auth.permissionsError = false;
  authValue.reloadPermissions.mockClear();
});

test('權限載入失敗時顯示提示並可重試：側邊選單', () => {
  render(<Sidebar />);
  assert.equal(screen.queryAllByRole('button', { name: /重試/ }).length, 0, '對照組：載入成功時不顯示');
  cleanup();

  auth.permissionsError = true;
  render(<Sidebar />);
  fireEvent.click(screen.getByRole('button', { name: /無法載入你的權限.*重試/ }));
  assert.equal(authValue.reloadPermissions.mock.calls.length, 1);
});

test('沒有權限時隱藏選單項目', () => {
  auth.permissions = new Set(['automation.view']);
  render(<Sidebar />);
  assert.equal(visible('自動化'), true, '對照組：有權限的項目要顯示');
  assert.equal(visible('報表'), false);
});

test('有權限時顯示選單項目', () => {
  auth.permissions = new Set(['analytics.view']);
  render(<Sidebar />);
  assert.equal(visible('報表'), true);
});

test('子選單依權限顯示項目', () => {
  nav.pathname = '/dashboard/settings/general';
  auth.permissions = new Set(['role.view']);
  render(<SectionNav />);
  assert.equal(visible('一般設定'), true, '對照組：進入「設定」時顯示子選單');
  assert.equal(visible('角色權限'), true, '有 role.view 時顯示「角色權限」');
  assert.equal(visible('A2A'), false, '沒有 settings.manage 時隱藏「A2A」');

  cleanup();
  auth.permissions = new Set(['role.view', 'settings.manage']);
  render(<SectionNav />);
  assert.equal(visible('A2A'), true, '對照組：有 settings.manage 時顯示「A2A」');
});

test('沒有子頁的區塊不顯示子選單', () => {
  nav.pathname = '/dashboard/inbox';
  const { container } = render(<SectionNav />);
  assert.equal(container.innerHTML, '');
});

test('點有子選單的圖示會直接進第一個子頁', () => {
  auth.permissions = new Set(['knowledge.view']);
  render(<Sidebar />);
  const link = screen.getByRole('link', { name: '知識庫' });
  assert.equal(link.getAttribute('href'), '/dashboard/knowledge/articles');
  assert.equal(
    screen.getByRole('link', { name: '收件匣' }).getAttribute('href'),
    '/dashboard/inbox',
    '對照組：沒有子選單的區塊維持原本網址',
  );
});

test('停在區塊首頁時，子選單第一項呈現選中', () => {
  auth.permissions = new Set(['knowledge.view']);
  nav.pathname = '/dashboard/knowledge';
  render(<SectionNav />);
  assert.equal(screen.getByRole('link', { name: '文章管理' }).getAttribute('aria-current'), 'page');
  assert.equal(screen.getByRole('link', { name: '語義搜尋' }).getAttribute('aria-current'), null);
  assert.equal(screen.queryAllByRole('link', { name: '知識庫' }).length, 0, '子選單標題不是連結');
});

test('窄螢幕：圖示欄常駐，點有子頁的圖示彈出子選單，選了就收起', () => {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  try {
    auth.permissions = new Set(['knowledge.view']);
    render(<Sidebar />);
    const trigger = screen.getByRole('button', { name: '知識庫' });
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(screen.queryAllByRole('link', { name: '文章管理' }).length, 0, '對照組：還沒點之前沒有子選單');
    fireEvent.click(trigger);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    const link = screen.getByRole('link', { name: '文章管理' });
    fireEvent.click(link);
    assert.equal(screen.queryAllByRole('link', { name: '文章管理' }).length, 0, '選了之後子選單收起');
    assert.equal(screen.getByRole('link', { name: '收件匣' }).getAttribute('href'), '/dashboard/inbox', '沒有子頁的圖示維持連結');
  } finally {
    window.matchMedia = original;
  }
});

// 以下兩個測試來自 main（G09、A06），原本測 main 的樹狀側欄（renderExpanded）；
// 本分支改為圖示欄＋子選單，改寫成測 Sidebar（圖示）與 SectionNav（子選單），測試目的不變。
test('只有個人報表權限時顯示我的績效', () => {
  nav.pathname = '/dashboard/analytics/my';
  auth.permissions = new Set(['analytics.view.self']);
  render(<><Sidebar /><SectionNav /></>);
  assert.equal(visible('報表'), true);
  assert.equal(visible('我的績效'), true);
  assert.equal(visible('總覽'), false);

  cleanup();
  auth.permissions = new Set(['analytics.view', 'analytics.view.self']);
  render(<><Sidebar /><SectionNav /></>);
  assert.equal(visible('總覽'), true, '對照組：有 analytics.view 時顯示「總覽」');
});

test('報表的子頁都沒有權限時隱藏報表圖示', () => {
  auth.permissions = new Set(['analytics.view.self']);
  render(<Sidebar />);
  assert.equal(visible('報表'), true, '對照組：有任一子頁權限時顯示');

  cleanup();
  auth.permissions = new Set(['automation.view']);
  render(<Sidebar />);
  assert.equal(visible('報表'), false);
});

test('沒有設定權限時隱藏 AI 設定', () => {
  nav.pathname = '/dashboard/knowledge/articles';
  auth.permissions = new Set(['knowledge.view']);
  render(<SectionNav />);
  assert.equal(visible('文章管理'), true, '對照組：「知識庫」子選單已顯示');
  assert.ok(screen.queryByText('AI 設定') === null);
  assert.equal(visible('Embedding'), false);
  assert.equal(visible('Chat & Prompt'), false);

  cleanup();
  auth.permissions = new Set(['knowledge.view', 'settings.manage']);
  render(<SectionNav />);
  assert.equal(visible('Embedding'), true, '對照組：有 settings.manage 時顯示');
});

test('main 新增的頁面依權限出現在子選單', () => {
  nav.pathname = '/dashboard/settings/general';
  auth.permissions = new Set(['store.view', 'settings.manage']);
  render(<SectionNav />);
  assert.equal(visible('門市與核銷帳號'), true);
  assert.equal(visible('WebTalk 協作'), true);

  cleanup();
  auth.permissions = new Set();
  render(<SectionNav />);
  assert.equal(visible('門市與核銷帳號'), false, '沒有 store.view 時隱藏');
  assert.equal(visible('WebTalk 協作'), false, '沒有 settings.manage 時隱藏');

  cleanup();
  nav.pathname = '/dashboard/marketing/campaigns';
  auth.permissions = new Set(['marketing.view', 'coupon.view']);
  render(<SectionNav />);
  assert.equal(visible('優惠券'), true);
});

test('圖示欄滑鼠移上去顯示名稱提示，按 Esc 關閉（WCAG 1.4.13）', async () => {
  auth.permissions = new Set(['analytics.view']);
  render(<Sidebar />);
  const link = screen.getByRole('link', { name: '報表' });
  assert.equal(link.getAttribute('title'), null, '不再使用瀏覽器內建 title，避免出現兩個提示');

  const wrapper = link.parentElement as HTMLElement;
  fireEvent.mouseEnter(wrapper);
  const tip = await screen.findByText('報表', { selector: 'span.relative' });
  assert.ok(tip, '移上去後顯示「報表」提示');

  fireEvent.keyDown(wrapper, { key: 'Escape' });
  assert.equal(screen.queryByText('報表', { selector: 'span.relative' }), null, '按 Esc 後提示關閉');
});

// ─── 左下角收合子選單 ───────────────────────────────────────

const mockNarrowScreen = () => {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => { window.matchMedia = original; };
};

test('寬螢幕：按左下角收合按鈕隱藏子選單，再按一次展開', () => {
  nav.pathname = '/dashboard/settings/general';
  render(<><Sidebar /><SectionNav /></>);
  assert.equal(visible('一般設定'), true, '對照組：預設展開');

  const collapse = screen.getByRole('button', { name: '收合子選單' });
  assert.equal(collapse.getAttribute('aria-expanded'), 'true');
  fireEvent.click(collapse);
  assert.equal(visible('一般設定'), false, '收合後子選單隱藏');

  const expand = screen.getByRole('button', { name: '展開子選單' });
  assert.equal(expand.getAttribute('aria-expanded'), 'false');
  fireEvent.click(expand);
  assert.equal(visible('一般設定'), true, '再按一次展開');
});

// 換頁：測試裡 usePathname 是假的，改 nav.pathname 後 rerender 模擬換到新網址
const shell = () => <><Sidebar /><SectionNav /></>;

test('收合後切到其他有子選單的頁面，維持收合', () => {
  nav.pathname = '/dashboard/settings/general';
  auth.permissions = new Set(['knowledge.view']);
  const { rerender } = render(shell());
  fireEvent.click(screen.getByRole('button', { name: '收合子選單' }));

  const icon = screen.getByRole('link', { name: '知識庫' });
  assert.equal(icon.getAttribute('href'), '/dashboard/knowledge/articles', '收合時圖示仍是連結，照常換頁');
  fireEvent.click(icon);
  nav.pathname = '/dashboard/knowledge/articles';
  rerender(shell());
  assert.equal(visible('文章管理'), false, '維持收合，不會每點一次就展開');
  assert.ok(screen.queryByRole('dialog') === null, '不彈出子選單');
  assert.ok(screen.queryByRole('button', { name: '展開子選單' }) !== null, '要展開再按左下角按鈕');
});

test('收合後到過沒有子選單的頁面，再進有子選單的頁面會展開', () => {
  nav.pathname = '/dashboard/settings/general';
  auth.permissions = new Set(['knowledge.view']);
  const { rerender } = render(shell());
  fireEvent.click(screen.getByRole('button', { name: '收合子選單' }));

  nav.pathname = '/dashboard/inbox';
  rerender(shell());
  nav.pathname = '/dashboard/knowledge/articles';
  rerender(shell());
  assert.equal(visible('文章管理'), true, '展開原本的子選單');
  assert.ok(screen.queryByRole('button', { name: '收合子選單' }) !== null);
});

test('重新整理後記住收合狀態', () => {
  nav.pathname = '/dashboard/settings/general';
  render(<><Sidebar /><SectionNav /></>);
  fireEvent.click(screen.getByRole('button', { name: '收合子選單' }));
  cleanup();

  render(<><Sidebar /><SectionNav /></>);
  assert.equal(visible('一般設定'), false);
  assert.ok(screen.queryByRole('button', { name: '展開子選單' }) !== null);
});

test('沒有子選單的頁面不顯示收合按鈕', () => {
  nav.pathname = '/dashboard/inbox';
  render(<Sidebar />);
  assert.ok(screen.queryByRole('button', { name: /收合子選單|展開子選單/ }) === null);

  cleanup();
  nav.pathname = '/dashboard/settings/general';
  render(<Sidebar />);
  assert.ok(screen.queryByRole('button', { name: '收合子選單' }) !== null, '對照組：有子選單的頁面顯示');
});

test('窄螢幕不顯示收合按鈕（子選單本來就收起）', () => {
  const restore = mockNarrowScreen();
  try {
    // 停在有子選單的頁面，才不會因為「沒有子選單」而隱藏
    nav.pathname = '/dashboard/settings/general';
    render(<Sidebar />);
    assert.ok(screen.queryByRole('button', { name: /收合子選單|展開子選單/ }) === null);
  } finally {
    restore();
  }
});

test('收合按鈕：未收合是 default，收合後是 pressed（Figma Sidebar Item Active 樣式）', () => {
  nav.pathname = '/dashboard/settings/general';
  render(<><Sidebar /><SectionNav /></>);
  const toggle = screen.getByRole('button', { name: '收合子選單' });
  // 樣式判斷：自動測試看不到畫面，只能檢查套用的 class
  assert.ok(!toggle.className.split(' ').includes('bg-primary'), '未收合：default（沒有藍底）');

  fireEvent.click(toggle);
  const pressed = screen.getByRole('button', { name: '展開子選單' });
  const cls = pressed.className.split(' ');
  assert.ok(cls.includes('bg-primary') && cls.includes('text-white'), '收合後：pressed（藍底白圖示）');

  fireEvent.click(pressed);
  assert.ok(!screen.getByRole('button', { name: '收合子選單' }).className.split(' ').includes('bg-primary'), '再展開回到 default');
});
