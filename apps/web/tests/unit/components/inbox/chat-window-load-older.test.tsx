// @vitest-environment jsdom
/**
 * core-inbox「聊天視窗可以載入更早的訊息」「聊天視窗顯示訊息載入失敗」「Inbox Refetches After A Message Burst」
 * （change fix-chat-window-load-older-468，issue #468、HC-INBOX-07）。
 *
 * 只把 HTTP 換成 mock（#src/lib/api.js），useMessages 與 ChatWindow 都是真的程式。
 * jsdom 沒有版面：scrollHeight 依畫面上的訊息數計算（每則 100），scrollTop 存在元素上。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const { api, socket } = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
    socket: {
      handlers,
      on: (event: string, fn: (payload: unknown) => void) => handlers.set(event, fn),
      off: (event: string) => handlers.delete(event),
      emit: () => {},
    },
  };
});
vi.mock('#src/lib/api.js', () => ({ default: api }));
// 每次 render 回傳同一個物件，與真的 provider 相同
const socketState = { socket };
vi.mock('#src/providers/SocketProvider.js', () => ({ useSocket: () => socketState }));

import { ChatWindow } from '#src/components/inbox/ChatWindow.js';

// 每個測試畫出 50～65 則訊息，機器忙碌時會超過預設的 5 秒
vi.setConfig({ testTimeout: 20_000 });

const BASE = Date.parse('2026-11-01T00:00:00.000Z');
const msg = (n: number) => ({
  id: `m-${String(n).padStart(3, '0')}`,
  direction: 'INBOUND',
  senderType: 'CONTACT',
  contentType: 'text',
  content: { text: `訊息 ${n}` },
  createdAt: new Date(BASE + n * 1000).toISOString(),
});
/** n 到 m 的訊息，由新到舊（與 API 的 order=desc 相同） */
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => msg(to - i));
const page = (data: unknown[], hasMore: boolean, nextCursor: string | null = null) => ({
  data: { success: true, data, meta: { total: 0, limit: 50, hasMore, nextCursor } },
});

const scrollIntoView = vi.fn();
const scrollTops = new WeakMap<Element, number>();
const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
const originalScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');

beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return (this.textContent?.match(/訊息 \d+/g)?.length ?? 0) * 100;
    },
  });
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return scrollTops.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      scrollTops.set(this, value);
    },
  });
});

afterAll(() => {
  if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
  if (originalScrollTop) Object.defineProperty(Element.prototype, 'scrollTop', originalScrollTop);
});

let convSeq = 0;
function conversation() {
  convSeq += 1;
  return {
    id: `conv-older-${convSeq}`,
    channelType: 'WEBCHAT',
    status: 'ACTIVE',
    assignedToId: null,
    contact: { id: 'contact-1', name: '陳小姐' },
  };
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  scrollIntoView.mockReset();
  socket.handlers.clear();
});

/** 依網址回應：/agents 空清單、訊息依 before 分流 */
function mockMessages(latest: () => Promise<unknown>, older: (before: string) => Promise<unknown>) {
  api.get.mockImplementation((url: string) => {
    if (!url.includes('/messages')) return Promise.resolve({ data: { data: [] } });
    const before = new URL(url, 'http://x').searchParams.get('before');
    return before ? older(before) : latest();
  });
}

const olderCalls = () =>
  api.get.mock.calls.map(([url]) => url as string).filter((url) => url.includes('/messages') && url.includes('before='));
const loadOlderButton = () => screen.queryByRole('button', { name: '載入更早的訊息' });
function clickLoadOlder() {
  const button = loadOlderButton();
  assert.ok(button !== null, '應顯示「載入更早的訊息」');
  fireEvent.click(button);
}
/** 等到出現 role="alert"，以斷言失敗呈現找不到的情況 */
async function waitForAlert() {
  let alert: HTMLElement | null = null;
  await vi.waitFor(() => {
    alert = screen.queryByRole('alert');
    assert.ok(alert !== null, '應顯示錯誤訊息');
  });
  return alert as unknown as HTMLElement;
}

test('有更早的訊息：按「載入更早的訊息」以 before 請求，畫面顯示兩頁的訊息', async () => {
  mockMessages(
    () => Promise.resolve(page(range(11, 60), true, 'c1')),
    () => Promise.resolve(page(range(1, 10), false)),
  );
  render(<ChatWindow conversation={conversation()} />);
  await screen.findByText('訊息 60');
  assert.ok(screen.queryByText('訊息 1') === null);

  clickLoadOlder();

  await screen.findByText('訊息 1');
  assert.ok(screen.getByText('訊息 60'));
  assert.equal(olderCalls().length, 1);
  assert.match(olderCalls()[0] as string, /before=c1/);
});

test('已載入全部：沒有更早的訊息時不顯示按鈕；載入到最後一頁後按鈕消失', async () => {
  mockMessages(
    () => Promise.resolve(page(range(1, 3), false)),
    () => Promise.reject(new Error('不應請求')),
  );
  render(<ChatWindow conversation={conversation()} />);
  await screen.findByText('訊息 3');
  assert.ok(loadOlderButton() === null);
});

test('已載入全部：載入到最後一頁後按鈕消失', async () => {
  mockMessages(
    () => Promise.resolve(page(range(11, 60), true, 'c1')),
    () => Promise.resolve(page(range(1, 10), false)),
  );
  render(<ChatWindow conversation={conversation()} />);
  await screen.findByText('訊息 60');
  clickLoadOlder();
  await screen.findByText('訊息 1');
  assert.ok(loadOlderButton() === null);
});

test('往上載入保持捲動位置：scrollTop 增加的量等於增加的高度，不捲到底', async () => {
  mockMessages(
    () => Promise.resolve(page(range(11, 60), true, 'c1')),
    () => Promise.resolve(page(range(1, 10), false)),
  );
  render(<ChatWindow conversation={conversation()} />);
  await screen.findByText('訊息 60');
  const scroller = screen.queryByTestId('chat-messages');
  assert.ok(scroller !== null, '訊息區應有 data-testid="chat-messages"');
  const before = scroller.scrollHeight;
  scroller.scrollTop = 0;
  scrollIntoView.mockClear();

  clickLoadOlder();
  await screen.findByText('訊息 1');

  assert.equal(scroller.scrollHeight - before, 1000, '前提：多了 10 則');
  assert.equal(scroller.scrollTop, 1000);
  assert.equal(scrollIntoView.mock.calls.length, 0, '載入更早的訊息不應捲到底');
});

test('新訊息捲到底：載入更早的訊息後收到 message.new，捲到底', async () => {
  let latest = page(range(11, 60), true, 'c1');
  mockMessages(
    () => Promise.resolve(latest),
    () => Promise.resolve(page(range(1, 10), false)),
  );
  const conv = conversation();
  render(<ChatWindow conversation={conv} />);
  await screen.findByText('訊息 60');
  clickLoadOlder();
  await screen.findByText('訊息 1');
  scrollIntoView.mockClear();

  latest = page(range(12, 61), true, 'c2');
  act(() => socket.handlers.get('message.new')?.({ conversationId: conv.id }));

  await screen.findByText('訊息 61');
  await vi.waitFor(() => assert.ok(scrollIntoView.mock.calls.length > 0, '新訊息應捲到底'));
});

test('已載入更早的訊息時收到新訊息：被擠出最新一頁的訊息與更早的訊息都留在畫面上，每則一次', async () => {
  let latest = page(range(11, 60), true, 'c1');
  mockMessages(
    () => Promise.resolve(latest),
    () => Promise.resolve(page(range(1, 10), false)),
  );
  const conv = conversation();
  render(<ChatWindow conversation={conv} />);
  await screen.findByText('訊息 60');
  clickLoadOlder();
  await screen.findByText('訊息 1');

  latest = page(range(16, 65), true, 'c3');
  act(() => socket.handlers.get('message.new')?.({ conversationId: conv.id }));
  await screen.findByText('訊息 65');

  for (let n = 1; n <= 65; n++) {
    assert.equal(screen.getAllByText(`訊息 ${n}`).length, 1, `訊息 ${n} 應只出現一次`);
  }
});

test('更早的訊息載入失敗：顯示原因與重試，已顯示的訊息留著；重試用同一個游標', async () => {
  let fail = true;
  mockMessages(
    () => Promise.resolve(page(range(11, 60), true, 'c1')),
    () =>
      fail
        ? Promise.reject({ response: { status: 503, data: { error: { message: '伺服器忙碌' } } } })
        : Promise.resolve(page(range(1, 10), false)),
  );
  render(<ChatWindow conversation={conversation()} />);
  await screen.findByText('訊息 60');
  clickLoadOlder();

  const alert = await waitForAlert();
  assert.match(alert.textContent ?? '', /更早的訊息載入失敗：伺服器忙碌/);
  assert.ok(screen.getByText('訊息 60'));

  fail = false;
  fireEvent.click(screen.getByRole('button', { name: '重試' }));
  await screen.findByText('訊息 1');
  assert.equal(olderCalls().length, 2);
  assert.match(olderCalls()[1] as string, /before=c1/);
  assert.ok(screen.queryByRole('alert') === null);
});

test('最新訊息載入失敗：顯示「訊息載入失敗」、原因與重試，不顯示「尚無訊息」', async () => {
  mockMessages(
    () => Promise.reject({ response: { status: 500, data: { error: { message: '資料庫連線失敗' } } } }),
    () => Promise.reject(new Error('不應請求')),
  );
  render(<ChatWindow conversation={conversation()} />);

  const alert = await waitForAlert();
  assert.match(alert.textContent ?? '', /訊息載入失敗/);
  assert.match(alert.textContent ?? '', /資料庫連線失敗/);
  assert.ok(screen.getByRole('button', { name: '重試' }));
  assert.ok(screen.queryByText('尚無訊息') === null);
});
