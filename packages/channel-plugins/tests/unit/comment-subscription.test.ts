/**
 * 補訂閱留言事件（change add-comment-keyword-private-reply，tasks 1.6、design D19）。
 *
 * `POST /{page-id}/subscribed_apps` 是**整份取代**，不是附加：少送一個 messaging 欄位就是全租戶私訊中斷。
 * 外掛一律把呼叫端給的完整清單原樣送出，不自己增減欄位。
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { fbPlugin } from '#src/facebook/index.js';
import { threadsPlugin } from '#src/threads.js';
import { MetaApiError } from '#src/index.js';
import { graphError, subscribeOk } from '../fixtures/meta-comments/graph-responses.js';

/** 擴充不存在時以斷言失敗（不是 TypeError） */
const fbC = () => {
  assert.ok(fbPlugin.extensions?.comments, 'FB 外掛要有 extensions.comments');
  return fbPlugin.extensions.comments;
};
const igC = () => {
  assert.ok(threadsPlugin.extensions?.comments, 'IG 外掛要有 extensions.comments');
  return threadsPlugin.extensions.comments;
};


interface Sent {
  url: URL;
  method?: string;
  headers: Record<string, string>;
  form: Record<string, string>;
}

let sent: Sent[] = [];
let respond: () => Response;

beforeEach(() => {
  sent = [];
  respond = () => new Response(JSON.stringify(subscribeOk), { status: 200 });
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    sent.push({
      url: new URL(String(url)),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      form: init?.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : {},
    });
    return respond();
  }));
});
afterEach(() => vi.unstubAllGlobals());

const FULL = ['messages', 'messaging_postbacks', 'messaging_referrals', 'message_echoes', 'feed'];
const proof = (token: string, secret: string) => createHmac('sha256', secret).update(token).digest('hex');
/** 送出的欄位可能放在 body 或網址，兩處都看 */
const fieldsOf = (s: Sent) => (s.form.subscribed_fields ?? s.url.searchParams.get('subscribed_fields') ?? '').split(',').filter(Boolean);
const proofOf = (s: Sent) => s.form.appsecret_proof ?? s.url.searchParams.get('appsecret_proof');

test('FB subscribeFields 送出的 subscribed_fields 等於傳入的完整清單，並帶 appsecret_proof', async () => {
  const ext = fbPlugin.extensions?.comments;
  assert.ok(ext, 'FB 外掛要有 extensions.comments');
  await ext.subscribeFields(
    { connectMode: 'platform', pageId: 'PAGE1', pageAccessToken: 'page-token' },
    { accountId: 'PAGE1', fields: FULL, appSecret: 'platform-secret' },
  );

  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.method, 'POST');
  assert.equal(sent[0]!.url.origin + sent[0]!.url.pathname, 'https://graph.facebook.com/v21.0/PAGE1/subscribed_apps');
  assert.deepEqual(fieldsOf(sent[0]!).sort(), [...FULL].sort());
  assert.equal(proofOf(sent[0]!), proof('page-token', 'platform-secret'));
});

test('FB subscribeFields 關閉接收時只送 4 個 messaging 欄位（外掛不自己加 feed）', async () => {
  const messaging = FULL.slice(0, 4);
  await fbC().subscribeFields(
    { connectMode: 'platform', pageAccessToken: 'page-token' },
    { accountId: 'PAGE1', fields: messaging, appSecret: 'platform-secret' },
  );
  assert.deepEqual(fieldsOf(sent[0]!).sort(), [...messaging].sort());
});

test('自備 App 的渠道用渠道自己的 App Secret 算 appsecret_proof', async () => {
  await fbC().subscribeFields(
    { appId: 'OWN-APP', appSecret: 'own-secret', pageAccessToken: 'own-token', pageId: 'PAGE2' },
    { accountId: 'PAGE2', fields: FULL },
  );
  assert.equal(proofOf(sent[0]!), proof('own-token', 'own-secret'));
});

test('IG subscribeFields 打 graph.instagram.com/.../me/subscribed_apps，欄位含 messages 與 comments', async () => {
  const ext = threadsPlugin.extensions?.comments;
  assert.ok(ext, 'IG 外掛要有 extensions.comments');
  await ext.subscribeFields(
    { appId: 'IG-APP', appSecret: 'ig-secret', pageAccessToken: 'ig-token' },
    { accountId: 'IGID1', fields: ['messages', 'comments'] },
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.method, 'POST');
  assert.equal(sent[0]!.url.origin + sent[0]!.url.pathname, 'https://graph.instagram.com/v21.0/me/subscribed_apps');
  assert.deepEqual(fieldsOf(sent[0]!).sort(), ['comments', 'messages']);
});

test('Meta 回權限錯誤時丟出 MetaApiError，原因是 PERMISSION_MISSING', async () => {
  respond = () => new Response(JSON.stringify(graphError(200)), { status: 403 });
  await assert.rejects(
    fbC().subscribeFields({ pageAccessToken: 't' }, { accountId: 'PAGE1', fields: FULL, appSecret: 's' }),
    (err: unknown) => err instanceof MetaApiError && err.info.reason === 'PERMISSION_MISSING' && err.info.code === 200,
  );
});

test('Meta 回 HTTP 500 時丟出 MetaApiError，原因是 NETWORK', async () => {
  respond = () => new Response('oops', { status: 500 });
  await assert.rejects(
    igC().subscribeFields({ pageAccessToken: 't' }, { accountId: 'IGID1', fields: ['messages', 'comments'] }),
    (err: unknown) => err instanceof MetaApiError && err.info.reason === 'NETWORK' && err.info.transient === true,
  );
});

test('回 200 但 success 不是 true 也視為失敗', async () => {
  respond = () => new Response(JSON.stringify({ success: false }), { status: 200 });
  await assert.rejects(
    fbC().subscribeFields({ pageAccessToken: 't' }, { accountId: 'PAGE1', fields: FULL, appSecret: 's' }),
    MetaApiError,
  );
});
