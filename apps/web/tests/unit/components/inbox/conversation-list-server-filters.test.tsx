// @vitest-environment jsdom
/**
 * core-inbox「收件匣的未讀與我的篩選由後端執行」「對話列表依關鍵字搜尋」「收件匣對話列表可以載入更多」
 * 的畫面情境（change fix-inbox-conversation-pagination，issue #422、AUDIT CONV-04）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('#src/lib/api.js', () => ({ default: { get: h.get, post: h.post } }));
vi.mock('#src/providers/SocketProvider.js', () => ({ useSocket: () => ({ socket: null }) }));
vi.mock('#src/providers/AuthProvider.js', () => {
  const agent = { id: 'agent-a' };
  return { useAuth: () => ({ agent }), usePermission: () => true };
});
vi.mock('#src/hooks/useChannels.js', () => {
  const channels: unknown[] = [];
  return { useChannels: () => ({ channels, isLoading: false }) };
});

import { ConversationList } from '#src/components/inbox/ConversationList.js';

const row = (n: number) => ({
  id: `c${n}`,
  channelType: 'WEBCHAT',
  status: 'ACTIVE',
  unreadCount: 0,
  updatedAt: new Date(Date.parse('2026-11-01T00:00:00Z') - n * 60_000).toISOString(),
  contact: { id: `k${n}`, displayName: `客人${n}` },
});
const reply = (rows: unknown[], page: number, totalPages: number, total: number) => ({
  data: { success: true, data: rows, meta: { total, page, limit: 50, totalPages } },
});

const query = (url: string) => new URLSearchParams(url.split('?')[1]);
const lastQuery = () => query(h.get.mock.calls[h.get.mock.calls.length - 1][0]);
const flush = () => act(async () => {});
const onSelect = () => {};

beforeEach(() => {
  h.get.mockReset();
  h.post.mockReset().mockResolvedValue({ data: {} });
  h.get.mockImplementation(async (url: string) => {
    const page = Number(query(url).get('page'));
    if (page === 1) return reply(Array.from({ length: 50 }, (_, i) => row(i + 1)), 1, 2, 56);
    return reply(Array.from({ length: 6 }, (_, i) => row(i + 51)), 2, 2, 56);
  });
});

function renderList() {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
      <ConversationList selectedId={null} onSelect={onSelect} />
    </SWRConfig>,
  );
}

test('切到未讀：以 unread=true&page=1 請求', async () => {
  renderList();
  await flush();
  fireEvent.click(screen.getByText('未讀'));
  await flush();
  const q = lastQuery();
  assert.equal(q.get('unread'), 'true');
  assert.equal(q.get('page'), '1');
});

test('切到我的：以 assigneeId=<自己的 id>&page=1 請求', async () => {
  renderList();
  await flush();
  fireEvent.click(screen.getByText('我的'));
  await flush();
  const q = lastQuery();
  assert.equal(q.get('assigneeId'), 'agent-a');
  assert.equal(q.get('page'), '1');
});

test('收件匣搜尋框：以 search=退貨&page=1 請求，列表只顯示後端回應的對話', async () => {
  renderList();
  await flush();
  h.get.mockImplementation(async (url: string) =>
    query(url).get('search') === '退貨' ? reply([row(99)], 1, 1, 1) : reply([row(1)], 1, 1, 1),
  );
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fireEvent.change(screen.getByPlaceholderText('搜尋對話...'), { target: { value: '退貨' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  vi.useRealTimers();
  await flush();
  const q = lastQuery();
  assert.equal(q.get('search'), '退貨');
  assert.equal(q.get('page'), '1');
  assert.ok(screen.getByText('客人99'));
  assert.ok(screen.queryByText('客人1') === null);
});

test('還有下一頁：列表底部「載入更多對話」載入第 2 頁，到最後一頁後消失', async () => {
  renderList();
  await flush();
  assert.ok(screen.queryByText('客人51') === null);
  fireEvent.click(screen.getByText('載入更多對話'));
  await flush();
  assert.ok(screen.getByText('客人51'));
  assert.ok(screen.queryByText('載入更多對話') === null);
});

test('載入失敗：顯示錯誤與重試，不顯示沒有對話', async () => {
  h.get.mockReset().mockRejectedValue(new Error('boom'));
  renderList();
  await flush();
  await flush();
  assert.ok(screen.getByText('對話列表載入失敗'));
  assert.ok(screen.getByText('重試'));
  assert.ok(screen.queryByText('沒有對話') === null);
});

test('載入失敗：下一頁失敗時顯示錯誤，按重試再請求同一頁', async () => {
  let failPage2 = true;
  h.get.mockImplementation(async (url: string) => {
    const page = Number(query(url).get('page'));
    if (page === 1) return reply(Array.from({ length: 50 }, (_, i) => row(i + 1)), 1, 2, 56);
    if (failPage2) throw new Error('boom');
    return reply(Array.from({ length: 6 }, (_, i) => row(i + 51)), 2, 2, 56);
  });
  renderList();
  await flush();
  fireEvent.click(screen.getByText('載入更多對話'));
  await flush();
  await flush();
  assert.ok(screen.getByText('對話列表載入失敗'));
  assert.ok(screen.getByText('客人1'), '已載入的對話留在畫面上');

  failPage2 = false;
  fireEvent.click(screen.getByText('重試'));
  await flush();
  await flush();
  assert.ok(screen.getByText('客人51'));
  assert.ok(screen.queryByText('對話列表載入失敗') === null);
  assert.ok(!h.get.mock.calls.some(([url]) => query(url).get('page') === '3'), '不跳到第 3 頁');
});

test('結果數量：有篩選時篩選列顯示後端的 meta.total', async () => {
  renderList();
  await flush();
  // 進階篩選選「未指派」後套用
  fireEvent.click(screen.getByLabelText('進階篩選'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'unassigned' } });
  fireEvent.click(screen.getByText('套用篩選'));
  await flush();
  assert.ok(screen.getByText('篩選結果：56 個對話'));
});
