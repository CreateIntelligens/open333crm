// @vitest-environment jsdom
/**
 * core-inbox「收件匣對話列表可以載入更多」與「Inbox socket updates reorder locally」
 * （change fix-inbox-conversation-pagination，issue #422、AUDIT CONV-04）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';

type Handler = (payload: unknown) => void;
const h = vi.hoisted(() => {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const socket = {
    on: (event: string, fn: (payload: unknown) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    },
    off: (event: string, fn: (payload: unknown) => void) => {
      handlers.get(event)?.delete(fn);
    },
  };
  return { get: vi.fn(), post: vi.fn(), socket, handlers };
});
vi.mock('#src/lib/api.js', () => ({ default: { get: h.get, post: h.post } }));
vi.mock('#src/providers/SocketProvider.js', () => ({ useSocket: () => ({ socket: h.socket }) }));

import { useConversations } from '#src/hooks/useConversations.js';

const BASE = Date.parse('2026-11-01T00:00:00Z');
const row = (n: number) => ({
  id: `c${n}`,
  channelType: 'WEBCHAT',
  status: 'ACTIVE',
  unreadCount: 0,
  // n 越大越舊
  updatedAt: new Date(BASE - n * 60_000).toISOString(),
  contact: { id: `k${n}`, displayName: `客人${n}` },
});
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => row(from + i));
const page = (rows: unknown[], p: number, totalPages: number, total = 56) => ({
  data: { success: true, data: rows, meta: { total, page: p, limit: 50, totalPages } },
});

function pageOf(url: string) {
  return Number(new URLSearchParams(url.split('?')[1]).get('page'));
}

function List({ selectedId = null }: { selectedId?: string | null }) {
  const { conversations, hasMore, loadMore, total } = useConversations({ status: '!CLOSED' }, { selectedId });
  return (
    <div>
      <ul>
        {conversations.map((c) => (
          <li key={c.id} data-testid="row" data-unread={String(c.unreadCount ?? 0)}>
            {c.id}
          </li>
        ))}
      </ul>
      <span data-testid="total">{String(total)}</span>
      {hasMore && <button onClick={() => loadMore()}>more</button>}
    </div>
  );
}

const ids = () => screen.queryAllByTestId('row').map((el) => el.textContent);
const flush = () => act(async () => {});
const emit = (event: string, payload: unknown) =>
  act(async () => {
    for (const fn of h.handlers.get(event) ?? []) (fn as Handler)(payload);
  });

beforeEach(() => {
  h.get.mockReset();
  h.post.mockReset().mockResolvedValue({ data: {} });
  h.handlers.clear();
});

function renderList(selectedId: string | null = null) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
      <List selectedId={selectedId} />
    </SWRConfig>,
  );
}

function twoPages(page2 = range(51, 56)) {
  h.get.mockImplementation(async (url: string) =>
    pageOf(url) === 1 ? page(range(1, 50), 1, 2) : page(page2, 2, 2),
  );
}

test('還有下一頁：按載入更多請求 page=2，列表顯示兩頁合起來的對話', async () => {
  twoPages();
  renderList();
  await flush();
  assert.equal(ids().length, 50);

  fireEvent.click(screen.getByText('more'));
  await flush();
  assert.ok(h.get.mock.calls.some(([url]) => pageOf(url) === 2), '要請求第 2 頁');
  assert.equal(ids().length, 56);
  assert.equal(ids()[55], 'c56');
});

test('已是最後一頁：不顯示載入更多', async () => {
  twoPages();
  renderList();
  await flush();
  fireEvent.click(screen.getByText('more'));
  await flush();
  assert.ok(screen.queryByText('more') === null);
});

test('結果數量：回傳後端的 meta.total', async () => {
  twoPages();
  renderList();
  await flush();
  assert.equal(screen.getByTestId('total').textContent, '56');
});

test('下一頁有重複的對話：同一段對話只出現一次', async () => {
  twoPages([row(50), ...range(51, 55)]);
  renderList();
  await flush();
  fireEvent.click(screen.getByText('more'));
  await flush();
  assert.equal(ids().filter((id) => id === 'c50').length, 1);
  assert.equal(ids().length, 55);
});

test('Conversation on a later loaded page receives new message：移到最上面、只出現一次、不重新請求', async () => {
  twoPages();
  renderList();
  await flush();
  fireEvent.click(screen.getByText('more'));
  await flush();
  const calls = h.get.mock.calls.length;

  await emit('message.new', {
    conversationId: 'c55',
    message: { id: 'm1', direction: 'INBOUND', senderType: 'CONTACT', contentType: 'text', content: { text: 'hi' }, createdAt: new Date(BASE + 60_000).toISOString() },
  });
  assert.equal(ids()[0], 'c55');
  assert.equal(ids().filter((id) => id === 'c55').length, 1);
  assert.equal(h.get.mock.calls.length, calls, '不重新請求 /conversations');
});

test('Existing conversation receives new message：第 1 頁的對話移到最上面', async () => {
  twoPages();
  renderList();
  await flush();
  const calls = h.get.mock.calls.length;
  await emit('message.new', {
    conversationId: 'c30',
    message: { id: 'm2', direction: 'INBOUND', senderType: 'CONTACT', contentType: 'text', content: { text: 'hi' }, createdAt: new Date(BASE + 60_000).toISOString() },
  });
  assert.equal(ids()[0], 'c30');
  assert.equal(h.get.mock.calls.length, calls);
});

test('Existing conversation receives update：合併 updatedAt 並重排', async () => {
  twoPages();
  renderList();
  await flush();
  fireEvent.click(screen.getByText('more'));
  await flush();
  await emit('conversation.updated', { id: 'c52', status: 'AGENT_HANDLED', updatedAt: new Date(BASE + 120_000).toISOString() });
  assert.equal(ids()[0], 'c52');
});

test('Missing conversation cannot be built from socket payload：重新載入已載入的頁', async () => {
  twoPages();
  renderList();
  await flush();
  const calls = h.get.mock.calls.length;
  await emit('message.new', {
    conversationId: 'c999',
    message: { id: 'm3', direction: 'INBOUND', senderType: 'CONTACT', contentType: 'text', content: { text: 'hi' }, createdAt: new Date().toISOString() },
  });
  await flush();
  assert.ok(h.get.mock.calls.length > calls, '要重新請求 /conversations');
});

test('Selected conversation receives inbound message：選取中的對話未讀維持 0 並標已讀', async () => {
  twoPages();
  renderList('c3');
  await flush();
  const inbound = (id: string) => ({
    conversationId: id,
    message: { id: `m-${id}`, direction: 'INBOUND', senderType: 'CONTACT', contentType: 'text', content: { text: 'hi' }, createdAt: new Date(BASE + 60_000).toISOString() },
  });
  await emit('message.new', inbound('c3'));
  await emit('message.new', inbound('c4'));
  const unreadOf = (id: string) =>
    screen.queryAllByTestId('row').find((el) => el.textContent === id)?.getAttribute('data-unread');
  assert.equal(unreadOf('c3'), '0');
  assert.equal(unreadOf('c4'), '1');
  assert.ok(h.post.mock.calls.some(([url]) => url === '/conversations/c3/read'));
});

// PR #449 審查：篩選改由後端執行後，socket 更新讓對話不再符合目前篩選時，列表要移除它
function FilteredList({ filters, selectedId = null }: { filters: Parameters<typeof useConversations>[0]; selectedId?: string | null }) {
  const { conversations } = useConversations(filters, { selectedId });
  return (
    <ul>
      {conversations.map((c) => (
        <li key={c.id} data-testid="row">
          {c.id}
        </li>
      ))}
    </ul>
  );
}

function renderFiltered(filters: Parameters<typeof useConversations>[0], rows: unknown[], selectedId: string | null = null) {
  h.get.mockImplementation(async () => page(rows, 1, 1, rows.length));
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
      <FilteredList filters={filters} selectedId={selectedId} />
    </SWRConfig>,
  );
}

test('未讀篩選：對話被讀過（unreadCount 變 0）後從列表移除', async () => {
  renderFiltered({ status: '!CLOSED', unread: true }, [
    { ...row(1), unreadCount: 2 },
    { ...row(2), unreadCount: 1 },
  ]);
  await flush();
  assert.deepEqual(ids(), ['c1', 'c2']);
  await emit('conversation.updated', { id: 'c2', unreadCount: 0 });
  assert.deepEqual(ids(), ['c1']);
});

test('我的篩選：對話改派給別人後從列表移除', async () => {
  renderFiltered({ status: '!CLOSED', assigneeId: 'me' }, [
    { ...row(1), assignedToId: 'me' },
    { ...row(2), assignedToId: 'me' },
  ]);
  await flush();
  await emit('conversation.updated', { id: 'c1', assignedToId: 'someone-else' });
  assert.deepEqual(ids(), ['c2']);
});

test('進行中篩選：對話結案後從列表移除', async () => {
  renderFiltered({ status: '!CLOSED' }, [row(1), row(2)]);
  await flush();
  await emit('conversation.updated', { id: 'c1', status: 'CLOSED' });
  assert.deepEqual(ids(), ['c2']);
});

test('選取中的對話：不再符合篩選時仍留在列表，避免正在看的對話消失', async () => {
  renderFiltered({ status: '!CLOSED', unread: true }, [{ ...row(1), unreadCount: 2 }, { ...row(2), unreadCount: 1 }], 'c2');
  await flush();
  await emit('conversation.updated', { id: 'c2', unreadCount: 0 });
  assert.deepEqual(ids(), ['c1', 'c2']);
});

test('下一頁的重複對話比較新：保留較新的那一筆（PR #449 審查）', async () => {
  // 第 1 頁載入後對話被往後擠：第 2 頁的同一段對話帶著較新的 updatedAt 與未讀數
  twoPages([{ ...row(50), unreadCount: 3, updatedAt: new Date(BASE + 60_000).toISOString() }, ...range(51, 55)]);
  renderList();
  await flush();
  fireEvent.click(screen.getByText('more'));
  await flush();
  const rows = screen.queryAllByTestId('row').filter((el) => el.textContent === 'c50');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].getAttribute('data-unread'), '3');
  assert.equal(ids()[0], 'c50', '較新的那筆排在最上面');
});
