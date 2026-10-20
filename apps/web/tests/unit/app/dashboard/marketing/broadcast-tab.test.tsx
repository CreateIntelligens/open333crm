// @vitest-environment jsdom
/**
 * 建立廣播的受眾欄位、立即發送防重複、分群條件值（change fix-broadcast-audience-fail-closed，
 * spec broadcast-audience）。
 *
 * 修正前：「依標籤篩選」「手動選擇」沒有挑標籤／挑人的欄位，送出空名單等於全發；
 * 「受眾分群」沒選分群也能建立；「立即發送」按下後不會停用；
 * 素材下拉用小寫 line／fb 比對 API 回的 LINE／FB，永遠不過濾；分群條件值空白也能建立。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { api, nav, materialCalls, data } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  nav: { pathname: '/dashboard/marketing/broadcasts' },
  materialCalls: [] as Array<Record<string, unknown>>,
  data: {
    broadcasts: [] as Array<Record<string, unknown>>,
    segments: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => null,
  useRouter: () => ({ push: vi.fn() }),
}));
const mutate = vi.fn();
vi.mock('#src/hooks/useChannels.js', () => ({
  useChannels: () => ({
    channels: [
      { id: 'ch-line', displayName: '官方 LINE', channelType: 'LINE', isActive: true },
      { id: 'ch-fb', displayName: '粉專', channelType: 'FB', isActive: true },
    ],
  }),
}));
vi.mock('#src/hooks/useMarketing.js', () => ({
  useCampaigns: () => ({ campaigns: [], isLoading: false, mutate }),
  useSegments: () => ({ segments: data.segments, isLoading: false, mutate }),
  useBroadcasts: () => ({ broadcasts: data.broadcasts, isLoading: false, mutate }),
}));
vi.mock('#src/hooks/useMaterials.js', () => ({
  useMaterials: (filters: Record<string, unknown>) => {
    materialCalls.push(filters);
    return {
      materials: filters.channelType === 'line'
        ? [{ id: 'mat-line', name: 'LINE 文字', channelType: 'line', contentType: 'line_text', body: {} }]
        : [],
    };
  },
}));
vi.mock('#src/components/materials/MaterialPreview.js', () => ({ MaterialPreview: () => null }));
vi.mock('#src/components/layout/Topbar.js', () => ({ Topbar: () => null }));

import MarketingPage from '#src/app/dashboard/marketing/page.js';

const TAGS = [
  { id: 'tag-vip', name: 'VIP' },
  { id: 'tag-new', name: '新客' },
];

beforeEach(() => {
  nav.pathname = '/dashboard/marketing/broadcasts';
  materialCalls.length = 0;
  data.broadcasts = [];
  data.segments = [];
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockResolvedValue({ data: { data: TAGS } });
  api.post.mockResolvedValue({ data: { data: {} } });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function openCreateDialog() {
  render(<MarketingPage />);
  fireEvent.click(screen.getByRole('button', { name: /建立廣播/ }));
  const dialog = screen.getByRole('dialog');
  const [channel, material, , target] = within(dialog).getAllByRole('combobox') as HTMLSelectElement[];
  fireEvent.change(within(dialog).getByPlaceholderText('廣播名稱'), { target: { value: '週年慶' } });
  fireEvent.change(channel, { target: { value: 'ch-line' } });
  fireEvent.change(material, { target: { value: 'mat-line' } });
  return { dialog, target };
}

function createButton(dialog: HTMLElement) {
  return within(dialog).getByRole('button', { name: '建立' }) as HTMLButtonElement;
}

test('Material list follows the channel：選 LINE 渠道時素材只查 line', () => {
  openCreateDialog();
  assert.equal(materialCalls.at(-1)?.channelType, 'line');
});

test('受眾選項沒有「手動選擇」（尚無挑人的介面，避免空名單）', () => {
  const { target } = openCreateDialog();
  const labels = Array.from(target.options).map((o) => o.textContent);
  assert.ok(!labels.includes('手動選擇'), `選項不應有手動選擇：${labels.join(',')}`);
  assert.ok(labels.includes('依標籤篩選'));
});

test('依標籤篩選：出現標籤多選，未選標籤不能建立，選了才送出 tagIds', async () => {
  const { dialog, target } = openCreateDialog();
  fireEvent.change(target, { target: { value: 'tags' } });
  const vip = await within(dialog).findByRole('checkbox', { name: 'VIP' });
  assert.equal(createButton(dialog).disabled, true);

  fireEvent.click(vip);
  assert.equal(createButton(dialog).disabled, false);
  fireEvent.click(createButton(dialog));
  // 表單另外會呼叫 audience-preview 預估人數（change broadcast-messaging-window），只看建立的請求
  const creates = () => api.post.mock.calls.filter(([u]) => u === '/marketing/broadcasts');
  await waitFor(() => assert.equal(creates().length, 1));
  const [url, payload] = creates()[0];
  assert.equal(url, '/marketing/broadcasts');
  assert.equal(payload.targetType, 'tags');
  assert.deepEqual(payload.targetConfig, { tagIds: ['tag-vip'] });
});

test('受眾分群：沒選分群不能建立', () => {
  data.segments = [{ id: 'seg-1', name: 'LINE 會員', contactCount: 3 }];
  const { dialog, target } = openCreateDialog();
  fireEvent.change(target, { target: { value: 'segment' } });
  assert.equal(createButton(dialog).disabled, true);
  fireEvent.click(createButton(dialog));
  // 選「全部」時表單會預估人數（audience-preview），只檢查沒有送出建立
  assert.equal(api.post.mock.calls.filter(([u]) => u === '/marketing/broadcasts').length, 0);
});

test('Send button while sending：立即發送請求進行中時按鈕停用，重按不會再送', async () => {
  data.broadcasts = [{ id: 'b-1', name: '草稿', status: 'draft', targetType: 'all', totalCount: 0, successCount: 0, failedCount: 0 }];
  let resolveSend: (v: unknown) => void = () => {};
  api.post.mockImplementation(() => new Promise((r) => { resolveSend = r; }));
  render(<MarketingPage />);
  const send = screen.getByTitle('立即發送') as HTMLButtonElement;
  fireEvent.click(send);
  await waitFor(() => assert.equal((screen.getByTitle('立即發送') as HTMLButtonElement).disabled, true));
  fireEvent.click(screen.getByTitle('立即發送'));
  assert.equal(api.post.mock.calls.length, 1);
  resolveSend({ data: { data: {} } });
  await waitFor(() => assert.equal((screen.getByTitle('立即發送') as HTMLButtonElement).disabled, false));
});

test('分群條件值空白時不能建立', () => {
  nav.pathname = '/dashboard/marketing/segments';
  render(<MarketingPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增分群/ }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByPlaceholderText('分群名稱'), { target: { value: 'LINE 會員' } });
  assert.equal(createButton(dialog).disabled, true);

  const valueSelect = within(dialog).getAllByRole('combobox')[2] as HTMLSelectElement;
  fireEvent.change(valueSelect, { target: { value: 'LINE' } });
  assert.equal(createButton(dialog).disabled, false);
});

// ─── 失敗原因與重新發送（change broadcast-failure-reason，issue #287） ─────────

test('Failed broadcast in the list：失敗的廣播顯示原因，並有「重新發送」', async () => {
  data.broadcasts = [{
    id: 'b-f', name: '週年慶', status: 'failed', targetType: 'tags', totalCount: 0, successCount: 0, failedCount: 0,
    failureReason: '所選標籤下沒有可在此渠道發送的對象。',
  }];
  api.post.mockResolvedValue({ data: { data: {} } });
  render(<MarketingPage />);
  assert.ok(screen.queryByText('所選標籤下沒有可在此渠道發送的對象。') !== null, '應顯示失敗原因');
  fireEvent.click(screen.getByTitle('重新發送'));
  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.equal(api.post.mock.calls[0][0], '/marketing/broadcasts/b-f/send');
});

test('Old failed broadcast without a reason：沒有原因的舊失敗廣播說明沒有記錄', () => {
  data.broadcasts = [{ id: 'b-o', name: '舊廣播', status: 'failed', targetType: 'all', totalCount: 0, successCount: 0, failedCount: 0, failureReason: null }];
  render(<MarketingPage />);
  assert.ok(screen.queryByText(/沒有記錄失敗原因/) !== null);
});

test('成功的廣播不顯示失敗原因、也沒有重新發送', () => {
  data.broadcasts = [{ id: 'b-ok', name: '已完成', status: 'completed', targetType: 'all', totalCount: 2, successCount: 2, failedCount: 0, failureReason: null }];
  render(<MarketingPage />);
  assert.ok(screen.queryByText(/沒有記錄失敗原因/) === null);
  assert.ok(screen.queryByTitle('重新發送') === null);
});

test('Cancel a failed broadcast：失敗的廣播可以取消', async () => {
  data.broadcasts = [{
    id: 'b-f', name: '週年慶', status: 'failed', targetType: 'all', totalCount: 0, successCount: 0, failedCount: 0,
    failureReason: '此渠道的憑證無法解密',
  }];
  api.post.mockResolvedValue({ data: { data: {} } });
  render(<MarketingPage />);
  fireEvent.click(screen.getByTitle('取消'));
  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  assert.equal(api.post.mock.calls[0][0], '/marketing/broadcasts/b-f/cancel');
});

test('Cancel a failed broadcast：確認視窗按取消就不送出', () => {
  data.broadcasts = [{ id: 'b-f', name: '週年慶', status: 'failed', targetType: 'all', totalCount: 0, successCount: 0, failedCount: 0, failureReason: 'x' }];
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<MarketingPage />);
  fireEvent.click(screen.getByRole('button', { name: '取消廣播' }));
  assert.equal(api.post.mock.calls.length, 0);
});

test('Cancel a failed broadcast：請求進行中按鈕停用，重按不會再送；完成後重新載入列表', async () => {
  data.broadcasts = [{ id: 'b-f', name: '週年慶', status: 'failed', targetType: 'all', totalCount: 0, successCount: 0, failedCount: 0, failureReason: 'x' }];
  let resolveCancel: (v: unknown) => void = () => {};
  api.post.mockImplementation(() => new Promise((r) => { resolveCancel = r; }));
  mutate.mockClear();
  render(<MarketingPage />);
  const button = () => screen.getByRole('button', { name: '取消廣播' }) as HTMLButtonElement;
  fireEvent.click(button());
  await waitFor(() => assert.equal(button().disabled, true));
  assert.equal((screen.getByRole('button', { name: '重新發送廣播' }) as HTMLButtonElement).disabled, true, '取消中也不能重新發送');
  fireEvent.click(button());
  assert.equal(api.post.mock.calls.length, 1);
  resolveCancel({ data: { data: {} } });
  await waitFor(() => assert.equal(button().disabled, false));
  assert.ok(mutate.mock.calls.length > 0, '取消後應重新載入列表');
});

// ─── 可送達人數（change broadcast-messaging-window，spec broadcast-audience「建立群發前可以看到可送達人數」）───

test('表單顯示可送達人數', async () => {
  api.post.mockImplementation(async (url: string) =>
    url === '/marketing/broadcasts/audience-preview'
      ? { data: { data: { matched: 3, reachable: 1, messagingWindowHours: 24 } } }
      : { data: { data: {} } });
  render(<MarketingPage />);
  fireEvent.click(screen.getByRole('button', { name: /建立廣播/ }));
  const dialog = screen.getByRole('dialog');
  const [channel] = within(dialog).getAllByRole('combobox') as HTMLSelectElement[];
  fireEvent.change(channel, { target: { value: 'ch-fb' } });
  await within(dialog).findByText('符合條件 3 人，可送達 1 人');
  assert.ok(within(dialog).getByText(/只能發給 24 小時內傳過訊息的人/));
  const preview = api.post.mock.calls.find(([u]) => u === '/marketing/broadcasts/audience-preview');
  assert.deepEqual(preview?.[1], { channelId: 'ch-fb', targetType: 'all' });
});

test('沒有訊息視窗的渠道只顯示符合條件人數', async () => {
  api.post.mockImplementation(async (url: string) =>
    url === '/marketing/broadcasts/audience-preview'
      ? { data: { data: { matched: 2, reachable: 2, messagingWindowHours: null } } }
      : { data: { data: {} } });
  const { dialog } = openCreateDialog();
  await within(dialog).findByText('符合條件 2 人');
  assert.ok(within(dialog).queryByText(/小時內傳過訊息/) === null);
});

test('列表顯示略過人數', () => {
  data.broadcasts = [{ id: 'b-s', name: 'FB 活動', status: 'completed', targetType: 'all', totalCount: 3, successCount: 1, failedCount: 0, skippedCount: 2 }];
  render(<MarketingPage />);
  assert.ok(screen.getByText('略過 2'));
});
