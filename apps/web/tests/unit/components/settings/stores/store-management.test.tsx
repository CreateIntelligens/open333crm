// @vitest-environment jsdom
/**
 * 後台「門市與核銷帳號」設定頁（openspec add-coupon-system / store-redemption）
 * - 「管理者可管理門市與門市帳號」
 * - 「門市海報連到核銷台登入頁」
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { api, auth } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  auth: { perms: new Set<string>() },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({
  useAuth: () => ({ hasPermission: (code: string) => auth.perms.has(code) }),
  usePermission: (code: string) => auth.perms.has(code),
}));

import { StoreManagement } from '#src/components/settings/stores/StoreManagement.js';

const STORES = [
  {
    id: 'store-neihu',
    name: '內湖門市',
    isActive: true,
    createdAt: '2026-10-01T00:00:00Z',
    accounts: [
      {
        id: 'acc-1', storeId: 'store-neihu', username: 'dt3c-neihu', canRedeem: true, isActive: true,
        lockedUntil: null, lastLoginAt: '2026-10-19T09:30:00Z', createdAt: '2026-10-01T00:00:00Z',
      },
    ],
  },
  { id: 'store-xinyi', name: '信義門市', isActive: false, createdAt: '2026-10-02T00:00:00Z', accounts: [] },
];

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/stores') return { data: { success: true, data: STORES } };
    if (url === '/stores/store-neihu/poster') {
      return {
        data: {
          success: true,
          data: {
            storeName: '內湖門市',
            url: 'https://crm.example.test/redeem?store=store-neihu',
            shortUrl: 'https://crm.example.test/redeem',
            qrDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          },
        },
      };
    }
    throw new Error(`未預期的 GET ${url}`);
  });
  auth.perms = new Set(['store.view', 'store.manage']);
});

async function renderLoaded() {
  render(<StoreManagement />);
  await screen.findByText('內湖門市');
}

function storeCard(name: string) {
  const card = screen.getByText(name).closest('[data-testid="store-card"]');
  assert.ok(card, `找不到「${name}」的門市卡片`);
  return card as HTMLElement;
}

test('列出門市與帳號：名稱、營業狀態與帳號名稱', async () => {
  await renderLoaded();
  const neihu = storeCard('內湖門市');
  assert.ok(within(neihu).getByText('營業中'));
  assert.ok(within(neihu).getByText('dt3c-neihu'));
  const xinyi = storeCard('信義門市');
  assert.ok(within(xinyi).getByText('已停業'));
  assert.ok(within(xinyi).getByText(/尚未建立帳號/));
});

test('讀取失敗時顯示錯誤，不顯示空狀態', async () => {
  api.get.mockRejectedValueOnce({ response: { status: 500, data: { error: { code: 'X', message: '伺服器忙碌' } } } });
  render(<StoreManagement />);
  await screen.findByText(/伺服器忙碌/);
  assert.equal(screen.queryAllByText(/尚未建立門市/).length, 0);
});

async function openCreateAccount() {
  await renderLoaded();
  fireEvent.click(within(storeCard('內湖門市')).getByRole('button', { name: '新增帳號' }));
  return screen.getByRole('dialog');
}

test('帳號名稱格式錯誤時不送出，並顯示格式說明', async () => {
  const dialog = await openCreateAccount();
  const username = within(dialog).getByLabelText('帳號名稱') as HTMLInputElement;
  fireEvent.change(username, { target: { value: 'DT3C Neihu' } });
  // 自動轉小寫
  assert.equal(username.value, 'dt3c neihu');
  fireEvent.change(within(dialog).getByLabelText('密碼'), { target: { value: 'dt3c2026x' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '建立帳號' }));
  assert.ok(within(dialog).getAllByText(/只能使用英文小寫、數字與連字號/).length > 0);
  assert.equal(api.post.mock.calls.length, 0);
});

test('帳號名稱重複（409）時在欄位下方顯示後端訊息', async () => {
  const dialog = await openCreateAccount();
  fireEvent.change(within(dialog).getByLabelText('帳號名稱'), { target: { value: 'dt3c-neihu' } });
  fireEvent.change(within(dialog).getByLabelText('密碼'), { target: { value: 'dt3c2026x' } });
  api.post.mockRejectedValueOnce({
    response: { status: 409, data: { success: false, error: { code: 'CONFLICT', message: '此帳號名稱已被使用' } } },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: '建立帳號' }));
  await within(dialog).findByText('此帳號名稱已被使用');
  assert.equal(api.post.mock.calls[0][0], '/stores/store-neihu/accounts');
});

test('建立成功後顯示一次帳號密碼，請交給店長', async () => {
  const dialog = await openCreateAccount();
  fireEvent.change(within(dialog).getByLabelText('帳號名稱'), { target: { value: 'dt3c-xinyi' } });
  fireEvent.change(within(dialog).getByLabelText('密碼'), { target: { value: 'dt3c2026x' } });
  api.post.mockResolvedValueOnce({
    data: {
      success: true,
      data: {
        id: 'acc-2', storeId: 'store-neihu', username: 'dt3c-xinyi', canRedeem: true, isActive: true,
        lockedUntil: null, lastLoginAt: null, createdAt: '2026-10-20T00:00:00Z',
      },
    },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: '建立帳號' }));
  await within(dialog).findByText(/請把帳號密碼交給店長/);
  assert.ok(within(dialog).getByText('dt3c2026x'));
  assert.deepEqual(api.post.mock.calls[0][1], { username: 'dt3c-xinyi', password: 'dt3c2026x', canRedeem: true });
});

test('只有 store.view 時，新增與操作按鈕停用並提示需主管權限', async () => {
  auth.perms = new Set(['store.view']);
  await renderLoaded();
  const addStore = screen.getByRole('button', { name: '新增門市' }) as HTMLButtonElement;
  assert.equal(addStore.disabled, true);
  assert.ok(screen.getAllByText(/需主管權限/).length > 0);
  const addAccount = within(storeCard('內湖門市')).getByRole('button', { name: '新增帳號' }) as HTMLButtonElement;
  assert.equal(addAccount.disabled, true);
});

test('設為停業前顯示確認框文案，確認後送出 isActive=false', async () => {
  await renderLoaded();
  fireEvent.click(within(storeCard('內湖門市')).getByRole('button', { name: '設為停業' }));
  const dialog = screen.getByRole('dialog');
  assert.ok(within(dialog).getByText('停業後此門市的所有帳號都不能核銷，已登入的裝置下一次操作就會被擋。'));
  api.patch.mockResolvedValueOnce({ data: { success: true, data: { ...STORES[0], isActive: false } } });
  fireEvent.click(within(dialog).getByRole('button', { name: '確定停業' }));
  await waitFor(() => assert.equal(api.patch.mock.calls.length, 1));
  assert.deepEqual(api.patch.mock.calls[0], ['/stores/store-neihu', { isActive: false }]);
});

test('櫃檯海報顯示門市名稱與核銷台網址', async () => {
  await renderLoaded();
  fireEvent.click(within(storeCard('內湖門市')).getByRole('button', { name: '列印櫃檯海報' }));
  const dialog = screen.getByRole('dialog');
  const poster = await within(dialog).findByTestId('store-poster');
  assert.ok(within(poster).getByText('內湖門市'));
  assert.ok(within(poster).getByText('店員請用手機相機掃描'));
  // 網址與 QR 都用後端回傳的值（WEB_BASE_URL），不由前端自行組
  // 印給人手打的是不帶門市 id 的短網址
  assert.ok(within(poster).getByText('https://crm.example.test/redeem'));
  assert.ok(within(poster).queryByText('https://crm.example.test/redeem?store=store-neihu') === null);
  const qr = within(poster).getByRole('img') as HTMLImageElement;
  assert.equal(qr.getAttribute('src'), 'data:image/png;base64,iVBORw0KGgo=');
  assert.ok(within(poster).getByText(/此 QR Code 只會開啟登入頁/));
});
