/**
 * Instagram 私訊外掛的解析與送出（主規格 threads-channel「Message Parsing」「Message Sending」，
 * change restore-instagram-channel-spec）。Graph API 以假 fetch 取代。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { ThreadsPlugin } from '#src/threads.js';

const plugin = new ThreadsPlugin();
const BIZ = '17841400000000001';
const CUSTOMER = '9990001';

function webhook(messaging: Record<string, unknown>, object = 'instagram') {
  return Buffer.from(JSON.stringify({
    object,
    entry: [{ id: BIZ, time: 1, messaging: [{ sender: { id: CUSTOMER }, recipient: { id: BIZ }, timestamp: 1000, ...messaging }] }],
  }));
}
const parse = (messaging: Record<string, unknown>, object?: string) => plugin.parseWebhook(webhook(messaging, object), {});

test('Text Message：文字私訊解析成 text，channelMsgId 是 message.mid', async () => {
  const [msg, ...rest] = await parse({ message: { mid: 'm-1', text: '請問營業時間' } });
  assert.equal(rest.length, 0);
  assert.equal(msg!.contentType, 'text');
  assert.equal(msg!.content.text, '請問營業時間');
  assert.equal(msg!.channelMsgId, 'm-1');
  assert.equal(msg!.contactUid, CUSTOMER);
});

test('Image Message：圖片的 mediaUrl 與 url 都是圖片網址，沒有 text', async () => {
  const [msg] = await parse({ message: { mid: 'm-2', attachments: [{ type: 'image', payload: { url: 'https://cdn.example.com/a.jpg' } }] } });
  assert.equal(msg!.contentType, 'image');
  assert.equal(msg!.content.mediaUrl, 'https://cdn.example.com/a.jpg');
  assert.equal(msg!.content.url, 'https://cdn.example.com/a.jpg');
  assert.equal(msg!.content.text, undefined);
});

test('Story Reply：回覆限時動態解析成「[Story reply] 」開頭的文字', async () => {
  const [msg] = await parse({ message: { mid: 'm-3', text: '好看', reply_to: { story: { url: 'https://x', id: 's1' } } } });
  assert.equal(msg!.contentType, 'text');
  assert.equal(msg!.content.text, '[Story reply] 好看');
});

test('Like (Heart) Reaction：愛心解析成 sticker，文字是「❤️」', async () => {
  const [msg] = await parse({ message: { mid: 'm-4', attachments: [{ type: 'like_heart' }] } });
  assert.equal(msg!.contentType, 'sticker');
  assert.equal(msg!.content.text, '❤️');
});

test('沒有 mid 的事件：已讀回條不產生訊息', async () => {
  assert.deepEqual(await parse({ read: { mid: 'm-1' } }), []);
  assert.deepEqual(await parse({ message: { text: '沒有 mid' } }), []);
});

test('商業帳號自己送出的 echo：is_echo 或 sender 是商業帳號都不產生訊息', async () => {
  assert.deepEqual(await parse({ message: { mid: 'm-5', text: '我們的回覆', is_echo: true } }), []);
  assert.deepEqual(await parse({ sender: { id: BIZ }, message: { mid: 'm-6', text: '我們的回覆' } }), []);
});

test('object 不是 instagram 的事件不產生訊息', async () => {
  assert.deepEqual(await parse({ message: { mid: 'm-7', text: 'hi' } }, 'page'), []);
});

// ── 送出 ──────────────────────────────────────────────────────────────

let sent: Array<{ url: string; body: Record<string, unknown> }> = [];
function fakeGraph(response: Record<string, unknown>) {
  sent = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(response), { status: 200 });
  });
}
afterEach(() => vi.unstubAllGlobals());
const CREDS = { pageAccessToken: 'token-1' };

test('Send Text Reply：送出文字，回傳 Graph API 的 message_id', async () => {
  fakeGraph({ message_id: 'mid-9' });
  const result = await plugin.sendMessage(CUSTOMER, { contentType: 'text', content: { text: '您好' } }, CREDS);
  assert.deepEqual(result, { success: true, channelMsgId: 'mid-9' });
  assert.ok(sent[0]!.url.startsWith('https://graph.instagram.com/'), sent[0]!.url);
  assert.ok(sent[0]!.url.includes('/me/messages'), sent[0]!.url);
  assert.deepEqual(sent[0]!.body, { recipient: { id: CUSTOMER }, message: { text: '您好' } });
});

test('Send Image Reply：圖片以 attachment 的 URL 送出', async () => {
  fakeGraph({ message_id: 'mid-10' });
  await plugin.sendMessage(CUSTOMER, { contentType: 'image', content: { mediaUrl: 'https://cdn.example.com/a.jpg' } }, CREDS);
  assert.deepEqual(sent[0]!.body.message, { attachment: { type: 'image', payload: { url: 'https://cdn.example.com/a.jpg' } } });
});

test('Send Quick Reply Button：選項轉成 content_type 為 text 的 quick_replies', async () => {
  fakeGraph({ message_id: 'mid-11' });
  await plugin.sendMessage(
    CUSTOMER,
    { contentType: 'text', content: { text: '請選擇', quickReplies: [{ label: '查訂單', postbackData: 'order' }] } },
    CREDS,
  );
  assert.deepEqual(sent[0]!.body.message, {
    text: '請選擇',
    quick_replies: [{ content_type: 'text', title: '查訂單', payload: 'order' }],
  });
});

test('Graph API 回傳錯誤：sendMessage 回傳 success: false 與錯誤訊息', async () => {
  fakeGraph({ error: { message: 'Invalid token' } });
  const result = await plugin.sendMessage(CUSTOMER, { contentType: 'text', content: { text: '您好' } }, CREDS);
  assert.deepEqual(result, { success: false, error: 'Invalid token' });
});

// ── 個人資料 ──────────────────────────────────────────────────────────

test('Get Profile：回傳 displayName 與 avatarUrl', async () => {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ name: '小美', profile_pic: 'https://cdn.example.com/p.jpg' }), { status: 200 });
  });
  const profile = await plugin.getProfile(CUSTOMER, CREDS);
  assert.deepEqual(profile, { uid: CUSTOMER, displayName: '小美', avatarUrl: 'https://cdn.example.com/p.jpg' });
  assert.ok(urls[0]!.startsWith(`https://graph.instagram.com/v21.0/${CUSTOMER}?`), urls[0]);
});

test('取得個人資料失敗：displayName 是「Instagram User <uid>」，不拋出錯誤', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('network down');
  });
  const profile = await plugin.getProfile(CUSTOMER, CREDS);
  assert.deepEqual(profile, { uid: CUSTOMER, displayName: `Instagram User ${CUSTOMER}` });
});
