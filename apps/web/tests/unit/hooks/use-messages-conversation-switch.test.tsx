// @vitest-environment jsdom
/**
 * 切換對話時，上一段對話已載入的更早訊息與還沒回來的 loadOlder 請求不混進新對話
 * （change fix-chat-window-load-older-468 的 PR #491 審查）。
 *
 * 只把 HTTP 換成 mock；記錄每一次 render 回傳的訊息，連切換後第一次 render 也檢查。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { SWRConfig } from 'swr';

const h = vi.hoisted(() => ({ get: vi.fn(), socket: { on: () => {}, off: () => {} } }));
vi.mock('#src/lib/api.js', () => ({ default: { get: h.get, post: vi.fn() } }));
// 每次 render 回傳同一個物件，與真的 provider 相同
const socketState = { socket: h.socket };
vi.mock('#src/providers/SocketProvider.js', () => ({ useSocket: () => socketState }));

import { useMessages } from '#src/hooks/useMessages.js';

vi.setConfig({ testTimeout: 20_000 });

const BASE = Date.parse('2026-11-01T00:00:00.000Z');
const msg = (conv: string, n: number) => ({
  id: `${conv}-${String(n).padStart(3, '0')}`,
  createdAt: new Date(BASE + n * 1000).toISOString(),
  content: { text: `${conv} ${n}` },
});
const range = (conv: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => msg(conv, to - i));
const page = (data: unknown[], nextCursor: string | null) => ({
  data: { success: true, data, meta: { total: 0, limit: 50, hasMore: nextCursor !== null, nextCursor } },
});

type Result = ReturnType<typeof useMessages>;
interface RenderRecord {
  conversationId: string;
  ids: string[];
  hasMore: boolean;
}

let renders: RenderRecord[] = [];
let latest: Result | null = null;

function Probe({ conversationId }: { conversationId: string }) {
  const result = useMessages(conversationId);
  latest = result;
  renders.push({
    conversationId,
    ids: (result.messages as Array<{ id: string }>).map((m) => m.id),
    hasMore: result.hasMore,
  });
  return null;
}

function renderProbe(conversationId: string) {
  // 每個測試用新的 SWR 快取，避免互相影響
  const ui = (id: string) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Probe conversationId={id} />
    </SWRConfig>
  );
  const view = render(ui(conversationId));
  return { switchTo: (id: string) => view.rerender(ui(id)) };
}

beforeEach(() => {
  h.get.mockReset();
  renders = [];
  latest = null;
});

const rendersOf = (conv: string) => renders.filter((r) => r.conversationId === conv);
const leaked = (conv: string, other: string) =>
  rendersOf(conv).flatMap((r) => r.ids).filter((id) => id.startsWith(`${other}-`));

test('A 對話載入更早訊息後切到 B：切換後的每一次 render 都不含 A 的訊息', async () => {
  h.get.mockImplementation((url: string) => {
    if (url.includes('/conversations/A/')) {
      return Promise.resolve(url.includes('before=') ? page(range('A', 1, 10), null) : page(range('A', 11, 60), 'cA'));
    }
    return Promise.resolve(page(range('B', 1, 3), null));
  });
  const { switchTo } = renderProbe('A');
  await vi.waitFor(() => assert.equal(latest?.messages.length, 50));
  await act(async () => {
    await latest?.loadOlder();
  });
  assert.equal(latest?.messages.length, 60, '前提：A 已載入更早的訊息');

  switchTo('B');
  await vi.waitFor(() => assert.equal(latest?.messages.length, 3));

  assert.ok(rendersOf('B').length > 0);
  assert.deepEqual(leaked('B', 'A'), [], 'B 的 render 不應出現 A 的訊息');
  assert.equal(rendersOf('B')[0]?.hasMore, false, '切換後第一次 render 不應沿用 A 的游標');
});

test('A 的 loadOlder 在切到 B 之後才回來：不寫入 B', async () => {
  let resolveOlder: (value: unknown) => void = () => {};
  h.get.mockImplementation((url: string) => {
    if (url.includes('/conversations/A/')) {
      if (url.includes('before=')) return new Promise((resolve) => (resolveOlder = resolve));
      return Promise.resolve(page(range('A', 11, 60), 'cA'));
    }
    return Promise.resolve(page(range('B', 1, 3), null));
  });
  const { switchTo } = renderProbe('A');
  await vi.waitFor(() => assert.equal(latest?.messages.length, 50));

  let pending: Promise<boolean> | undefined;
  act(() => {
    pending = latest?.loadOlder();
  });
  switchTo('B');
  await vi.waitFor(() => assert.equal(latest?.messages.length, 3));

  let loaded: boolean | undefined;
  await act(async () => {
    resolveOlder(page(range('A', 1, 10), null));
    loaded = await pending;
  });

  assert.equal(loaded, false, '切換後回來的結果應丟棄');
  assert.equal(latest?.messages.length, 3);
  assert.deepEqual(leaked('B', 'A'), [], 'B 的 render 不應出現 A 的訊息');
  assert.equal(latest?.hasMore, false, 'B 的游標不受 A 的回應影響');
  assert.equal(latest?.loadingOlder, false);
});
