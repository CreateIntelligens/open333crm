/**
 * FB 外掛 sendMessage 的特性測試（change add-comment-keyword-private-reply，tasks 1.1、design D6）。
 *
 * 重構前補上：把 sendMessage 的組 body 抽成共用的 postMessage() 時，一般私訊送出的內容必須完全不變。
 * spec channel-plugins「Facebook private reply targets the comment」› Scenario「Direct message unchanged」。
 *
 * 現況（2026-11-13 讀 main）：body 只有 `recipient` 與 `message` 兩個欄位，**沒有** `messaging_type`；
 * 權杖放在網址的 access_token。這裡以整個 body deepEqual 釘住，任何多出或少掉的欄位都會失敗。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { FbPlugin } from '#src/facebook/index.js';

interface Sent {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

const creds = { pageAccessToken: 'page-token' };
let sent: Sent[] = [];
let reply: () => Response;

beforeEach(() => {
  sent = [];
  reply = () => new Response(JSON.stringify({ recipient_id: 'PSID-1', message_id: 'mid-1' }), { status: 200 });
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    sent.push({
      url: String(url),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body)),
    });
    return reply();
  }));
});
afterEach(() => vi.unstubAllGlobals());

const plugin = new FbPlugin({ siteBaseUrl: () => 'https://uat.example.com' });

test('Direct message unchanged', async () => {
  const result = await plugin.sendMessage('PSID-1', { contentType: 'text', content: { text: '你好' } }, creds);

  assert.deepEqual(result, { success: true, channelMsgId: 'mid-1' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.url, 'https://graph.facebook.com/v21.0/me/messages?access_token=page-token');
  assert.equal(sent[0]!.method, 'POST');
  assert.equal(sent[0]!.headers['content-type'], 'application/json');
  assert.deepEqual(sent[0]!.body, { recipient: { id: 'PSID-1' }, message: { text: '你好' } });
});

test('Direct message unchanged：圖片與按鈕版型的 body 也只有 recipient.id 與 message', async () => {
  await plugin.sendMessage('PSID-1', { contentType: 'fb_image', content: { url: 'https://cdn.example.com/a.jpg' } }, creds);
  await plugin.sendMessage('PSID-1', {
    contentType: 'fb_button',
    content: { text: '請選擇', buttons: [{ type: 'postback', title: 'A', payload: 'a' }] },
  }, creds);

  assert.deepEqual(sent[0]!.body, {
    recipient: { id: 'PSID-1' },
    message: { attachment: { type: 'image', payload: { url: 'https://cdn.example.com/a.jpg', is_reusable: true } } },
  });
  assert.deepEqual(sent[1]!.body, {
    recipient: { id: 'PSID-1' },
    message: {
      attachment: {
        type: 'template',
        payload: { template_type: 'button', text: '請選擇', buttons: [{ type: 'postback', title: 'A', payload: 'a' }] },
      },
    },
  });
});

test('Direct message unchanged：站內路徑換成公開網址', async () => {
  await plugin.sendMessage('PSID-1', { contentType: 'fb_image', content: { url: '/material-samples/cafe.jpeg' } }, creds);
  assert.equal(sent[0]!.body.message.attachment.payload.url, 'https://uat.example.com/material-samples/cafe.jpeg');
});

test('Direct message unchanged：Graph API 回錯誤時回傳 Meta 的錯誤訊息', async () => {
  reply = () => new Response(JSON.stringify({ error: { message: '(#551) This person isn\'t available right now.', code: 551 } }), { status: 400 });
  const result = await plugin.sendMessage('PSID-1', { contentType: 'text', content: { text: '你好' } }, creds);
  assert.deepEqual(result, { success: false, error: '(#551) This person isn\'t available right now.' });
});

test('Direct message unchanged：fetch 丟錯時回傳錯誤訊息、不丟出', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up'); }));
  const result = await plugin.sendMessage('PSID-1', { contentType: 'text', content: { text: '你好' } }, creds);
  assert.deepEqual(result, { success: false, error: 'socket hang up' });
});

test('Direct message unchanged：沒有設定網站公開網址時，站內路徑不送出', async () => {
  const noBase = new FbPlugin({ siteBaseUrl: () => undefined });
  const result = await noBase.sendMessage('PSID-1', { contentType: 'fb_image', content: { url: '/material-samples/cafe.jpeg' } }, creds);
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /WEB_BASE_URL/);
  assert.equal(sent.length, 0);
});
