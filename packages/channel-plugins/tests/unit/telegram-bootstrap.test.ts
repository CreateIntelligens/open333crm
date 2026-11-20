import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { TelegramPlugin } from '#src/telegram.js';

const plugin = new TelegramPlugin();
const credentials = { botToken: 'secret-token', webhookSecret: 'webhook-secret' };
const bot = { id: 123456789012, is_bot: true, first_name: 'Support', username: 'support_bot' };
const webhook = { url: 'https://crm.example/telegram/123', has_custom_certificate: false, pending_update_count: 0 };
let requests: Array<{ url: string; init: RequestInit }> = [];

function mockTelegram(status: number, payload: unknown) {
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init: RequestInit = {}) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify(payload), { status });
  }));
}

afterEach(() => vi.unstubAllGlobals());
function hasOutcome(error: unknown, outcome: string): boolean {
  return typeof error === 'object' && error !== null && 'outcome' in error && error.outcome === outcome;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

test('getMe 回傳經 Telegram 確認的 Bot 資訊，且呼叫不暴露 token', async () => {
  mockTelegram(200, { ok: true, result: bot });

  const result = await plugin.getMe(credentials);

  assert.deepEqual(result, bot);
  assert.equal(requests[0]?.url, 'https://api.telegram.org/botsecret-token/getMe');
  assert.equal(requests[0]?.init.method, 'POST');
});

test('getWebhookInfo 回傳目前 webhook 資訊', async () => {
  mockTelegram(200, { ok: true, result: webhook });

  assert.deepEqual(await plugin.getWebhookInfo(credentials), webhook);
  assert.equal(requests[0]?.url, 'https://api.telegram.org/botsecret-token/getWebhookInfo');
});

test('setWebhook 傳入 URL、secret_token 與限定的更新類型，並驗證 true 結果', async () => {
  mockTelegram(200, { ok: true, result: true });

  await plugin.setWebhook(webhook.url, credentials);

  assert.equal(requests[0]?.url, 'https://api.telegram.org/botsecret-token/setWebhook');
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), {
    url: webhook.url,
    secret_token: credentials.webhookSecret,
    allowed_updates: ['message'],
  });
});

test('Telegram ok:false 是明確拒絕，錯誤內容不含 token、密鑰或原始描述', async () => {
  mockTelegram(200, { ok: false, error_code: 401, description: 'bad secret-token webhook-secret' });

  await assert.rejects(plugin.getMe(credentials), (error: unknown) => {
    assert.equal(error instanceof Error, true);
    assert.equal(errorMessage(error).includes('secret-token'), false);
    assert.equal(errorMessage(error).includes('webhook-secret'), false);
    assert.equal(errorMessage(error).includes('bad secret-token'), false);
    assert.equal(hasOutcome(error, 'rejected'), true);
    return true;
  });
});

test('HTTP 非成功與無效 JSON 回應屬於不明結果，且錯誤不含 token', async () => {
  mockTelegram(502, { ok: false, description: 'proxy echoed secret-token' });
  await assert.rejects(plugin.setWebhook(webhook.url, credentials), (error: unknown) => {
    assert.equal(hasOutcome(error, 'unknown'), true);
    assert.equal(errorMessage(error).includes('secret-token'), false);
    return true;
  });

  vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 200 })));
  await assert.rejects(plugin.getWebhookInfo(credentials), (error: unknown) => {
    assert.equal(hasOutcome(error, 'unknown'), true);
    assert.equal(errorMessage(error).includes('secret-token'), false);
    return true;
  });
});

test('網路錯誤屬於不明結果，原始錯誤不會洩漏 token', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('request failed for secret-token'); }));

  await assert.rejects(plugin.getMe(credentials), (error: unknown) => {
    assert.equal(hasOutcome(error, 'unknown'), true);
    assert.equal(errorMessage(error).includes('secret-token'), false);
    return true;
  });
});

test('getMe、getWebhookInfo 與 setWebhook 都驗證必要結果欄位', async () => {
  mockTelegram(200, { ok: true });
  await assert.rejects(plugin.getMe(credentials), (error: unknown) => hasOutcome(error, 'unknown'));

  mockTelegram(200, { ok: true, result: { ...webhook, url: 9 } });
  await assert.rejects(plugin.getWebhookInfo(credentials), (error: unknown) => hasOutcome(error, 'unknown'));

  mockTelegram(200, { ok: true, result: false });
  await assert.rejects(plugin.setWebhook(webhook.url, credentials), (error: unknown) => hasOutcome(error, 'unknown'));
});

test('私人文字更新分開保留發送者、聊天室與更新 ID', async () => {
  const message = { message_id: 8, from: { id: 42 }, chat: { id: 73, type: 'private' }, date: 100, text: 'hello' };
  const parse = (payload: unknown) => plugin.parseWebhook(Buffer.from(JSON.stringify(payload)), {});
  assert.deepEqual(await parse({ update_id: 9, message }), [{
    providerEventId: '9', channelMsgId: '8', externalId: '42', contactUid: '42',
    replyDestination: '73', timestamp: new Date(100_000), contentType: 'text', content: { text: 'hello' },
  }]);
  assert.deepEqual(await parse({ update_id: 9, message: { ...message, chat: { id: 73, type: 'group' } } }), []);
  assert.deepEqual(await parse({ update_id: 9, message: { ...message, from: undefined } }), []);
});

test('發送使用聊天室 ID，缺少成功收據時保留不明結果', async () => {
  const message = { contentType: 'text', content: { text: 'hello' } };
  mockTelegram(200, { ok: true, result: { message_id: 8 } });
  assert.deepEqual(await plugin.sendMessage('73', message, credentials), {
    success: true, outcome: 'accepted', channelMsgId: '8',
  });
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), { chat_id: '73', text: 'hello' });
  mockTelegram(200, { ok: true, result: {} });
  const result = await plugin.sendMessage('73', message, credentials);
  assert.equal(result.outcome, 'unknown');
  assert.equal(result.error?.includes(credentials.botToken), false);
});

test('Webhook 驗證拒絕空密鑰、缺少標頭和錯誤密鑰', () => {
  const body = Buffer.alloc(0);
  const header = 'x-telegram-bot-api-secret-token';
  assert.equal(plugin.verifySignature(body, {}, credentials.webhookSecret), false);
  assert.equal(plugin.verifySignature(body, { [header]: '' }, ''), false);
  assert.equal(plugin.verifySignature(body, { [header]: 'wrong' }, credentials.webhookSecret), false);
  assert.equal(plugin.verifySignature(body, { [header]: credentials.webhookSecret }, credentials.webhookSecret), true);
});

test('Telegram 的 HTTP 401 拒絕不洩漏原始回應', async () => {
  mockTelegram(401, { ok: false, error_code: 401, description: credentials.botToken });
  const result = await plugin.sendMessage('73', { contentType: 'text', content: { text: 'hello' } }, credentials);
  assert.equal(result.outcome, 'rejected');
  assert.equal(result.error?.includes(credentials.botToken), false);
});
