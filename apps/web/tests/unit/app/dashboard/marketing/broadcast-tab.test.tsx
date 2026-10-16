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
  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  const [url, payload] = api.post.mock.calls[0];
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
  assert.equal(api.post.mock.calls.length, 0);
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
