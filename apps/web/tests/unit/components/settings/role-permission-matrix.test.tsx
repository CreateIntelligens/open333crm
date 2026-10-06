// @vitest-environment jsdom
/**
 * 角色設定頁（openspec/specs/role-settings-page）。
 * 測試渲染元件，並替換 API 與登入成員的權限。權限矩陣取自權限註冊表的真實權限碼。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { api, auth } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  auth: { canManage: true },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({
  usePermission: (code: string) => (code === 'role.manage' ? auth.canManage : true),
}));

import { RolePermissionMatrix } from '#src/components/settings/RolePermissionMatrix.js';

type Perm = { code: string; label: string; dependsOn?: string[]; implies?: string[]; adminLock?: boolean };
const group = (name: string, perms: Perm[]) => ({
  group: name,
  permissions: perms.map((p) => ({ description: '', dependsOn: [], implies: [], adminLock: false, ...p })),
});

const MATRIX = [
  group('客服作業', [
    { code: 'inbox.view', label: '檢視對話' },
    { code: 'inbox.reply', label: '回覆對話', dependsOn: ['inbox.view'] },
  ]),
  group('案件', [
    { code: 'case.view', label: '檢視案件' },
    { code: 'case.assign', label: '指派案件', dependsOn: ['case.view'], implies: ['agent.view'] },
  ]),
  group('聯絡人', [
    { code: 'contact.view', label: '檢視聯絡人' },
    { code: 'contact.update', label: '編輯聯絡人', dependsOn: ['contact.view'] },
  ]),
  group('自動化', [
    { code: 'automation.view', label: '檢視自動化' },
    { code: 'identity.review', label: '審核識別建議', dependsOn: ['contact.view'] },
  ]),
  group('稽核與合規', [{ code: 'data.erase', label: '刪除聯絡人資料', dependsOn: ['contact.view'] }]),
  group('人員與權限', [
    { code: 'agent.view', label: '檢視成員' },
    { code: 'agent.manage', label: '管理成員', dependsOn: ['agent.view'], adminLock: true },
    { code: 'agent.purge', label: '刪除成員', dependsOn: ['agent.view'] },
    { code: 'role.view', label: '檢視角色權限' },
    { code: 'role.manage', label: '管理角色權限', dependsOn: ['role.view'], adminLock: true },
  ]),
];
const ALL_CODES = MATRIX.flatMap((g) => g.permissions.map((p) => p.code));

const role = (id: string, slug: string, name: string, isSystem: boolean) => ({
  id, slug, name, isSystem, permissionCount: 0, agentCount: 0,
});
const ADMIN = role('r-admin', 'admin', '管理員', true);
const SUPERVISOR = role('r-sup', 'supervisor', '主管', true);
const CUSTOM = role('r-custom', 'custom-1', '客服組長', false);

const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } });

/** 最近一次 GET /roles/:id/permissions 的回應。loaded() 等它完成。 */
let permsResponse: Promise<unknown> | null = null;

/** 第一個角色是被選取的角色。rolePerms 是各角色載入時的權限；給 Promise 可以控制回應的時間。 */
function setup(roles: ReturnType<typeof role>[], rolePerms: Record<string, string[] | Promise<string[]>>) {
  api.get.mockImplementation((url: string) => {
    if (url === '/roles') return ok({ roles });
    if (url === '/roles/matrix') return ok({ groups: MATRIX });
    const m = url.match(/^\/roles\/([^/]+)\/permissions$/);
    if (m) {
      return (permsResponse = Promise.resolve(rolePerms[m[1]] ?? []).then((permissions) => ({
        data: { success: true, data: { permissions } },
      })));
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  render(<RolePermissionMatrix />);
}

function row(code: string): HTMLElement {
  const el = screen.getByText(code).closest('div.flex.items-start');
  assert.ok(el, `找不到 ${code} 的那一列`);
  return el as HTMLElement;
}
const box = (code: string) => row(code).querySelector('input[type=checkbox]') as HTMLInputElement;
const checked = (code: string) => box(code).checked;
const click = (code: string) => fireEvent.click(box(code));
const autoOnBadge = (code: string) => within(row(code)).queryByText(/自動開啟/);

function groupHeader(name: string): HTMLElement {
  return screen.getByText(name, { selector: 'span' }).parentElement as HTMLElement;
}
const clickGroupButton = (name: string, label: '全開' | '全關') =>
  fireEvent.click(within(groupHeader(name)).getByRole('button', { name: label }));

/**
 * 等角色的權限載入完成。唯讀時勾選格一直是停用的，無法用勾選格判斷是否載入完成，
 * 所以先等最近一次權限請求的回應。
 */
async function loaded(code = 'inbox.view') {
  await screen.findByText(code);
  await waitFor(() => assert.ok(permsResponse, '尚未請求角色的權限'));
  await act(async () => {
    await permsResponse;
  });
  await waitFor(() => assert.equal(box(code).disabled, !auth.canManage));
}

/** 斷言元素不存在。失敗時不把 DOM 節點交給 assert 序列化，以免 worker 記憶體耗盡。 */
function absent(el: Element | null, message = '元素不應存在') {
  assert.ok(el === null, `${message}：${el?.outerHTML.slice(0, 200)}`);
}

const confirmSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  permsResponse = null;
  auth.canManage = true;
  confirmSpy.mockReset();
  window.confirm = confirmSpy;
});

describe('依群組顯示角色的權限', () => {
  test('選取角色後依群組顯示權限', async () => {
    setup([CUSTOM], { 'r-custom': ['inbox.view'] });
    await loaded();
    assert.equal(checked('inbox.view'), true);
    assert.equal(checked('inbox.reply'), false);
    assert.ok(within(groupHeader('客服作業')).getByText('已開 1/2'));
  });

  test('折疊群組', async () => {
    setup([CUSTOM], { 'r-custom': [] });
    await loaded();
    fireEvent.click(screen.getByText('客服作業', { selector: 'span' }));
    absent(screen.queryByText('inbox.view'));
    absent(screen.queryByText('inbox.reply'));
    assert.ok(screen.getByText('客服作業', { selector: 'span' }));
    assert.ok(screen.getByText('case.view'), '其他群組不受影響');
  });

  test('權限載入完成前不能勾選', async () => {
    setup([CUSTOM], { 'r-custom': new Promise<string[]>(() => {}) });
    await screen.findByText('inbox.view');
    for (const code of ALL_CODES) assert.equal(box(code).disabled, true, `${code} 應停用`);
  });

  test('快速切換角色時只採用目前角色的回應', async () => {
    let resolveA!: (perms: string[]) => void;
    const slowA = new Promise<string[]>((resolve) => (resolveA = resolve));
    setup([CUSTOM, SUPERVISOR], { 'r-custom': slowA, 'r-sup': ['case.view'] });
    await screen.findByText('inbox.view');

    fireEvent.click(screen.getByText('主管'));
    await waitFor(() => assert.equal(box('case.view').disabled, false));
    assert.equal(checked('case.view'), true);

    // 角色 A 較早送出的請求現在才回應
    await act(async () => {
      resolveA(['inbox.view', 'inbox.reply']);
      await slowA;
    });
    assert.equal(checked('inbox.view'), false, '不應採用角色 A 的回應');
    assert.equal(checked('case.view'), true);

    api.put.mockReturnValue(ok({}));
    click('contact.view');
    fireEvent.click(screen.getByRole('button', { name: /儲存變更/ }));
    await screen.findByText('已儲存');
    const [url, body] = api.put.mock.calls[0];
    assert.equal(url, '/roles/r-sup/permissions');
    assert.deepEqual([...body.permissions].sort(), ['case.view', 'contact.view']);
  });

  test('角色的權限載入失敗', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/roles') return ok({ roles: [CUSTOM] });
      if (url === '/roles/matrix') return ok({ groups: MATRIX });
      return Promise.reject(new Error('network'));
    });
    render(<RolePermissionMatrix />);
    assert.ok(await screen.findByText(/無法載入此角色的權限/));
    assert.ok(screen.getByRole('button', { name: '重試' }));
    for (const code of ALL_CODES) assert.equal(box(code).disabled, true, `${code} 應停用`);
  });
});

describe('勾選時處理前置權限', () => {
  test('勾選權限時一併勾選前置權限', async () => {
    setup([CUSTOM], { 'r-custom': [] });
    await loaded();
    click('inbox.reply');
    assert.equal(checked('inbox.reply'), true);
    assert.equal(checked('inbox.view'), true);
    const badge = autoOnBadge('inbox.view');
    assert.ok(badge, '前置權限應顯示「自動開啟」');
    assert.match(badge.getAttribute('title') ?? badge.textContent ?? '', /回覆對話/);
    absent(autoOnBadge('inbox.reply'), '被勾選的權限本身不是自動開啟');
  });

  test('前置權限原本已勾選時不顯示自動開啟', async () => {
    setup([CUSTOM], { 'r-custom': ['inbox.view'] });
    await loaded();
    click('inbox.reply');
    assert.equal(checked('inbox.reply'), true);
    absent(autoOnBadge('inbox.view'));
    absent(autoOnBadge('inbox.reply'));
  });

  test('取消勾選需要它的權限後不再顯示自動開啟', async () => {
    setup([CUSTOM], { 'r-custom': [] });
    await loaded();
    click('inbox.reply');
    assert.ok(autoOnBadge('inbox.view'), '前提：inbox.view 自動開啟');
    click('inbox.reply');
    assert.equal(checked('inbox.reply'), false);
    assert.equal(checked('inbox.view'), true);
    absent(autoOnBadge('inbox.view'), '需要它的權限已取消，不應再顯示自動開啟');
  });

  test('取消勾選前置權限時確認相依的權限', async () => {
    setup([CUSTOM], { 'r-custom': ['inbox.view', 'inbox.reply'] });
    await loaded();
    confirmSpy.mockReturnValue(true);
    click('inbox.view');
    assert.equal(confirmSpy.mock.calls.length, 1);
    assert.match(confirmSpy.mock.calls[0][0], /回覆對話/);
    assert.equal(checked('inbox.view'), false);
    assert.equal(checked('inbox.reply'), false);
  });

  test('不確認時不變更', async () => {
    setup([CUSTOM], { 'r-custom': ['inbox.view', 'inbox.reply'] });
    await loaded();
    confirmSpy.mockReturnValue(false);
    click('inbox.view');
    assert.equal(confirmSpy.mock.calls.length, 1);
    assert.equal(checked('inbox.view'), true);
    assert.equal(checked('inbox.reply'), true);
  });

  test('群組全關時一併取消其他群組的相依權限', async () => {
    setup([CUSTOM], { 'r-custom': ['contact.view', 'contact.update', 'identity.review', 'data.erase'] });
    await loaded('contact.view');
    confirmSpy.mockReturnValue(true);
    clickGroupButton('聯絡人', '全關');
    assert.equal(confirmSpy.mock.calls.length, 1, '應先確認');
    const message: string = confirmSpy.mock.calls[0][0];
    assert.match(message, /審核識別建議/);
    assert.match(message, /刪除聯絡人資料/);
    for (const code of ['contact.view', 'contact.update', 'identity.review', 'data.erase']) {
      assert.equal(checked(code), false, `${code} 應取消勾選`);
    }
  });

  test('群組全開時一併勾選其他群組的前置權限', async () => {
    setup([CUSTOM], { 'r-custom': [] });
    await loaded();
    clickGroupButton('自動化', '全開');
    assert.equal(checked('automation.view'), true);
    assert.equal(checked('identity.review'), true);
    assert.equal(checked('contact.view'), true);
    assert.ok(autoOnBadge('contact.view'), '群組外的前置權限應顯示「自動開啟」');
  });
});

describe('隱含權限只顯示說明', () => {
  test('指派案件顯示隱含權限的說明', async () => {
    setup([CUSTOM], { 'r-custom': [] });
    await loaded();
    const hint = row('case.assign').querySelector('[title]');
    assert.equal(hint?.getAttribute('title'), '啟用時一併需要「檢視成員」，系統自動處理');
  });

  test('勾選時不勾選隱含權限', async () => {
    setup([CUSTOM], { 'r-custom': [] });
    await loaded();
    click('case.assign');
    assert.equal(checked('case.assign'), true);
    assert.equal(checked('case.view'), true);
    assert.equal(checked('agent.view'), false);
  });
});

describe('admin 角色的內建鎖定', () => {
  const LOCKED = ['agent.manage', 'role.manage', 'agent.view', 'role.view'];

  test('admin 角色的內建鎖定權限不能取消勾選', async () => {
    setup([ADMIN], { 'r-admin': ALL_CODES });
    await loaded();
    for (const code of LOCKED) {
      assert.equal(checked(code), true, `${code} 應已勾選`);
      assert.equal(box(code).disabled, true, `${code} 應停用`);
      assert.ok(within(row(code)).queryByText(/內建鎖定/), `${code} 應標示內建鎖定`);
    }
    assert.equal(box('agent.purge').disabled, false);
  });

  test('全關略過內建鎖定的權限', async () => {
    setup([ADMIN], { 'r-admin': ALL_CODES });
    await loaded();
    confirmSpy.mockReturnValue(true);
    clickGroupButton('人員與權限', '全關');
    for (const code of LOCKED) assert.equal(checked(code), true, `${code} 應維持勾選`);
    assert.equal(checked('agent.purge'), false);
  });

  test('admin 角色缺少內建鎖定的權限時可以補回：勾選', async () => {
    setup([ADMIN], { 'r-admin': ALL_CODES.filter((c) => c !== 'role.manage') });
    await loaded();
    assert.equal(checked('role.manage'), false);
    assert.equal(box('role.manage').disabled, false, '缺少時要能勾選');
    click('role.manage');
    assert.equal(checked('role.manage'), true);
    assert.equal(box('role.manage').disabled, true, '勾選後鎖定');
  });

  test('admin 角色缺少內建鎖定的權限時可以補回：全開', async () => {
    setup([ADMIN], { 'r-admin': ALL_CODES.filter((c) => c !== 'role.manage') });
    await loaded();
    clickGroupButton('人員與權限', '全開');
    assert.equal(checked('role.manage'), true);
  });

  test('admin 以外的角色沒有內建鎖定', async () => {
    setup([SUPERVISOR], { 'r-sup': ALL_CODES });
    await loaded();
    assert.equal(box('role.manage').disabled, false);
    absent(within(row('role.manage')).queryByText(/內建鎖定/));
  });
});

describe('變更暫存到按下儲存', () => {
  test('勾選不送出請求', async () => {
    setup([CUSTOM], { 'r-custom': [] });
    await loaded();
    click('inbox.view');
    click('case.view');
    assert.equal(api.put.mock.calls.length, 0);
    assert.ok(screen.getByText('未儲存 2 項變更'));
  });

  test('放棄變更', async () => {
    setup([CUSTOM], { 'r-custom': ['inbox.view'] });
    await loaded();
    click('case.view');
    fireEvent.click(screen.getByRole('button', { name: '放棄' }));
    assert.equal(checked('case.view'), false);
    assert.equal(checked('inbox.view'), true);
    absent(screen.queryByText(/未儲存/));
  });

  test('儲存成功', async () => {
    setup([CUSTOM], { 'r-custom': ['inbox.view'] });
    await loaded();
    api.put.mockReturnValue(ok({}));
    click('inbox.reply');
    fireEvent.click(screen.getByRole('button', { name: /儲存變更/ }));
    assert.ok(await screen.findByText('已儲存'));
    assert.equal(api.put.mock.calls.length, 1);
    const [url, body] = api.put.mock.calls[0];
    assert.equal(url, '/roles/r-custom/permissions');
    assert.deepEqual([...body.permissions].sort(), ['inbox.reply', 'inbox.view']);
    absent(screen.queryByText(/未儲存/));
  });

  test('儲存失敗時保留草稿', async () => {
    setup([CUSTOM], { 'r-custom': [] });
    await loaded();
    api.put.mockRejectedValue({
      response: {
        status: 403,
        data: { success: false, error: { code: 'PRIVILEGE_ESCALATION', message: '不可授予你自己沒有的權限' } },
      },
    });
    click('inbox.view');
    fireEvent.click(screen.getByRole('button', { name: /儲存變更/ }));
    assert.ok(await screen.findByText('不可授予你自己沒有的權限'));
    assert.equal(checked('inbox.view'), true);
    assert.ok(screen.getByText('未儲存 1 項變更'));
  });

  test('有未儲存的變更時切換角色', async () => {
    setup([CUSTOM, SUPERVISOR], { 'r-custom': [], 'r-sup': ['inbox.view'] });
    await loaded();
    click('case.view');
    confirmSpy.mockReturnValue(false);
    fireEvent.click(screen.getByText('主管'));
    assert.equal(confirmSpy.mock.calls.length, 1);
    assert.ok(screen.getByRole('heading', { name: '客服組長' }));
    assert.equal(api.get.mock.calls.some(([url]) => url === '/roles/r-sup/permissions'), false);
    assert.equal(checked('case.view'), true);
  });
});

describe('沒有 role.manage 時唯讀', () => {
  test('只有 role.view 時唯讀', async () => {
    auth.canManage = false;
    setup([CUSTOM], { 'r-custom': ['inbox.view'] });
    await loaded();
    for (const code of ALL_CODES) assert.equal(box(code).disabled, true, `${code} 應停用`);
    absent(screen.queryByRole('button', { name: '全開' }));
    absent(screen.queryByRole('button', { name: '全關' }));
    absent(screen.queryByText(/新增角色/));
    assert.ok(screen.getByText(/此頁為唯讀/));
  });
});
