// @vitest-environment jsdom
/**
 * 嵌入式 widget 的工作階段、送出訊息與即時訊息（主規格 webchat-widget）。
 * widget 在 import 時自動啟動，所以每個測試重新載入模組。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

const socket = vi.hoisted(() => ({
  connectVisitorSocket: vi.fn(),
  handlers: [] as Array<(msg: unknown) => void>,
}));
vi.mock('#src/socket.js', () => ({ connectVisitorSocket: socket.connectVisitorSocket }));

const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';
const API = 'https://crm.example/api/v1';

interface Request {
  url: string;
  init?: RequestInit;
}

let requests: Request[];
let sessionCount: number;
let greeting: string | null;
let messageStatus: number;
let messageThrows: boolean;

beforeEach(() => {
  requests = [];
  sessionCount = 0;
  greeting = null;
  messageStatus = 200;
  messageThrows = false;
  socket.handlers = [];
  socket.connectVisitorSocket.mockReset().mockImplementation(() => ({
    onAgentMessage: (cb: (msg: unknown) => void) => socket.handlers.push(cb),
    disconnect: () => undefined,
  }));
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  sessionStorage.clear();
  localStorage.clear();
  window.alert = vi.fn();
  window.Open333CRM = { channelId: CHANNEL_ID, channelPublicKey: 'ch_public', apiBaseUrl: API };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === `${API}/chatbox/sessions`) {
      sessionCount += 1;
      return json({ data: { sessionId: `session-${sessionCount}` } });
    }
    if (url === `${API}/chatbox/sessions/verify`) {
      const { sessionId } = JSON.parse(String(init?.body));
      return json({
        data: {
          claimToken: `claim-for-${sessionId}`,
          session: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
          config: { greeting, theme: {} },
        },
      });
    }
    if (messageThrows) throw new TypeError('Failed to fetch');
    return json({ data: { ok: true } }, messageStatus);
  }) as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** 載入 widget，等到工作階段建立、socket 連線完成 */
async function loadWidget() {
  const before = socket.connectVisitorSocket.mock.calls.length;
  vi.resetModules();
  await import('#src/index.js');
  await vi.waitFor(() => assert.equal(socket.connectVisitorSocket.mock.calls.length, before + 1));
  const panels = document.querySelectorAll('#o333-panel');
  const panel = panels[panels.length - 1] as HTMLElement;
  return {
    messages: panel.querySelector('#o333-messages') as HTMLElement,
    input: panel.querySelector('#o333-input') as HTMLInputElement,
    sendBtn: panel.querySelector('#o333-send') as HTMLButtonElement,
    panel,
  };
}

function requestsTo(path: string): Request[] {
  return requests.filter((request) => request.url === `${API}${path}`);
}

function jsonBody(request: Request): Record<string, unknown> {
  return JSON.parse(String(request.init?.body));
}

// ── Visitor session initialization ─────────────────────────

test('First-time visitor loads widget：建立並 claim 工作階段，不送 visitorToken，不寫入瀏覽器儲存空間', async () => {
  await loadWidget();

  const created = requestsTo('/chatbox/sessions');
  const verified = requestsTo('/chatbox/sessions/verify');
  assert.equal(created.length, 1);
  assert.equal(verified.length, 1);
  assert.equal(jsonBody(created[0]!).channel, 'ch_public');
  assert.equal(jsonBody(verified[0]!).sessionId, 'session-1');
  assert.equal(requests.indexOf(created[0]!) < requests.indexOf(verified[0]!), true, '先建立再 claim');
  for (const request of requests) {
    assert.equal(String(request.init?.body ?? '').includes('visitorToken'), false);
  }
  assert.equal(sessionStorage.length, 0);
  assert.equal(localStorage.length, 0);
});

test('Same tab reloads widget / Two tabs open the same widget：每次載入都建立並 claim 新的工作階段', async () => {
  await loadWidget();
  await loadWidget();

  const verified = requestsTo('/chatbox/sessions/verify').map((request) => jsonBody(request).sessionId);
  assert.deepEqual(verified, ['session-1', 'session-2']);
  const created = requestsTo('/chatbox/sessions').map((request) => jsonBody(request));
  assert.equal(JSON.stringify(created).includes('session-1'), false, '第二次載入不送前一個 sessionId');
  assert.deepEqual(
    socket.connectVisitorSocket.mock.calls.map((call) => call[1]),
    ['session-1', 'session-2'],
  );
});

test('Session API returns greeting：verify 回應有問候語時，widget 把它顯示為第一則訊息', async () => {
  greeting = '歡迎光臨';
  const { messages } = await loadWidget();

  assert.equal(messages.children.length, 1);
  assert.equal(messages.children[0]!.textContent, '歡迎光臨');
});

// ── Visitor message sending ────────────────────────────────

test('Visitor sends a text message：以 sessionId 與 claim token 送出，不送 visitorToken', async () => {
  const { input, sendBtn } = await loadWidget();

  input.value = 'hello';
  sendBtn.click();
  await vi.waitFor(() => assert.equal(requestsTo(`/webchat/${CHANNEL_ID}/messages`).length, 1));

  const body = jsonBody(requestsTo(`/webchat/${CHANNEL_ID}/messages`)[0]!);
  assert.equal(body.sessionId, 'session-1');
  assert.equal(body.claimToken, 'claim-for-session-1');
  assert.equal(typeof body.clientMessageId, 'string');
  assert.equal(body.type, 'text');
  assert.deepEqual(body.payload, { text: 'hello' });
  assert.equal('visitorToken' in body, false);
});

test('Visitor sends an image：訊息輸入區沒有附加檔案按鈕與選檔欄位', async () => {
  const { panel } = await loadWidget();

  assert.ok(panel.querySelector('#o333-attach') === null);
  assert.ok(panel.querySelector('input[type="file"]') === null);
});

test('Message send fails：文字訊息被 API 拒絕或請求失敗時，在那則訊息標示傳送失敗', async () => {
  const { messages, input, sendBtn } = await loadWidget();

  messageStatus = 401;
  input.value = 'rejected';
  sendBtn.click();
  await vi.waitFor(() => assert.match(messages.lastElementChild?.textContent ?? '', /\[傳送失敗\]/));
  assert.match(messages.lastElementChild!.textContent!, /^rejected/);

  messageThrows = true;
  input.value = 'offline';
  sendBtn.click();
  await vi.waitFor(() => assert.match(messages.lastElementChild?.textContent ?? '', /^offline.*\[傳送失敗\]/));
  assert.match(messages.children[0]!.textContent!, /^rejected.*\[傳送失敗\]/, '前一則的標示不變');
});

// ── Real-time message delivery to visitor ──────────────────

test('Agent replies to visitor（widget 端）：收到 agent:message 時顯示訊息，不重新載入頁面', async () => {
  const { messages } = await loadWidget();

  assert.equal(socket.connectVisitorSocket.mock.calls[0]![1], 'session-1');
  assert.equal(socket.connectVisitorSocket.mock.calls[0]![2], 'claim-for-session-1');
  assert.equal(socket.handlers.length, 1);
  socket.handlers[0]!({ direction: 'OUTBOUND', senderType: 'AGENT', contentType: 'text', content: { text: '客服回覆' } });

  assert.equal(messages.lastElementChild?.textContent, '客服回覆');
});

// ── Widget shows visitor and agent messages on separate sides ────

function sideOf(el: Element | null | undefined): 'visitor' | 'other' | 'none' {
  const out = el?.classList.contains('o333-msg-out') ?? false;
  const inn = el?.classList.contains('o333-msg-in') ?? false;
  if (out && !inn) return 'visitor';
  if (inn && !out) return 'other';
  return 'none';
}

test("Visitor message is on the visitor's side：訪客送出的文字靠右（o333-msg-out）", async () => {
  const { messages, input, sendBtn } = await loadWidget();

  input.value = 'hello';
  sendBtn.click();

  assert.equal(messages.lastElementChild?.textContent, 'hello');
  assert.equal(sideOf(messages.lastElementChild), 'visitor');
});

test('Agent and bot messages are on the other side：問候語與 agent:message 靠左（o333-msg-in）', async () => {
  greeting = '歡迎光臨';
  const { messages } = await loadWidget();
  assert.equal(sideOf(messages.children[0]), 'other', '問候語');

  socket.handlers[0]!({ direction: 'OUTBOUND', senderType: 'AGENT', contentType: 'text', content: { text: '客服回覆' } });
  assert.equal(sideOf(messages.lastElementChild), 'other', '客服回覆');

  socket.handlers[0]!({ direction: 'OUTBOUND', senderType: 'BOT', contentType: 'image', content: { url: 'https://cdn.test/a.png' } });
  assert.equal(sideOf(messages.lastElementChild), 'other', 'Bot 圖片');
});
