/**
 * 留言私訊與公開回覆、Meta 錯誤正規化（change add-comment-keyword-private-reply，tasks 1.4）。
 * spec channel-plugins「Facebook private reply targets the comment」「Comment extension normalizes Meta errors」、
 * spec threads-channel「Instagram Comment Private Reply」。
 *
 * 錯誤碼 10900／10903 為社群經驗、待 UAT 實測（見 fixtures/meta-comments/graph-responses.ts 檔頭）。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { FbPlugin } from '#src/facebook/index.js';
import { threadsPlugin } from '#src/threads.js';
import type { ChannelCommentExtension } from '#src/index.js';
import {
  alreadyReplied,
  bucUsageHeader,
  commentNotFound,
  expiredByMeta,
  graphError,
  igPrivateReplyOk,
  permission200,
  permissionMissing,
  privateReplyOk,
  publicReplyOk,
  rateLimited4,
  rateLimited613,
  rateLimitedBuc,
  tokenExpired,
  unknownError,
  userUnavailable,
} from '../fixtures/meta-comments/graph-responses.js';

interface Sent {
  url: URL;
  method?: string;
  body: any;
}

const creds = { pageAccessToken: 'page-token' };
let sent: Sent[] = [];
let respond: () => Response | Promise<Response>;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

beforeEach(() => {
  sent = [];
  respond = json(privateReplyOk);
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    const raw = init?.body == null ? null : String(init.body);
    let body: any = null;
    if (raw) {
      try { body = JSON.parse(raw); } catch { body = Object.fromEntries(new URLSearchParams(raw)); }
    }
    sent.push({ url: new URL(String(url)), method: init?.method, body });
    return respond();
  }));
});
afterEach(() => vi.unstubAllGlobals());

const fb = new FbPlugin({ siteBaseUrl: () => 'https://uat.example.com' });
const fbExt = () => {
  assert.ok(fb.extensions?.comments, 'FB 外掛要有 extensions.comments');
  return fb.extensions.comments as ChannelCommentExtension;
};
const igExt = () => {
  assert.ok(threadsPlugin.extensions?.comments, 'IG 外掛要有 extensions.comments');
  return threadsPlugin.extensions.comments as ChannelCommentExtension;
};

describe('FB 私訊', () => {
  test('Private reply body', async () => {
    const result = await fbExt().sendPrivateReply('C1', { contentType: 'text', content: { text: '感謝' } }, creds);

    assert.deepEqual(result, { ok: true, recipientId: 'PSID-1', messageId: 'm_1' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.method, 'POST');
    assert.equal(sent[0]!.url.origin + sent[0]!.url.pathname, 'https://graph.facebook.com/v21.0/me/messages');
    assert.equal(sent[0]!.body.recipient.comment_id, 'C1');
    assert.equal(sent[0]!.body.recipient.id, undefined, '不可帶 recipient.id');
    assert.equal(sent[0]!.body.message.text, '感謝');
    assert.equal(sent[0]!.body.messaging_type, undefined, '私訊回覆不帶 messaging_type（design D6）');
  });

  test('Private reply body：素材的站內路徑換成公開網址（與 sendMessage 共用 postMessage）', async () => {
    await fbExt().sendPrivateReply('C1', { contentType: 'fb_image', content: { url: '/material-samples/cafe.jpeg' } }, creds);
    assert.deepEqual(sent[0]!.body.message, {
      attachment: { type: 'image', payload: { url: 'https://uat.example.com/material-samples/cafe.jpeg', is_reusable: true } },
    });
  });

  test('未開放的版型（收據）不呼叫 Meta，回 MATERIAL_UNSUPPORTED', async () => {
    const result = await fbExt().sendPrivateReply('C1', { contentType: 'fb_receipt', content: { recipient_name: 'x' } }, creds);
    assert.equal(sent.length, 0);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.reason, 'MATERIAL_UNSUPPORTED');
  });

  test('Token expired', async () => {
    respond = json(tokenExpired, 400);
    const result = await fbExt().sendPrivateReply('C1', { contentType: 'text', content: { text: '感謝' } }, creds);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.reason, 'TOKEN_EXPIRED');
    assert.equal(result.error.transient, false);
    assert.equal(result.error.code, 190);
    assert.equal(result.error.subcode, 463);
    assert.equal(result.error.traceId, 'TRACE-1');
    assert.equal(result.error.message, '(#190) test error');
  });

  test('Network failure', async () => {
    respond = () => { throw new TypeError('fetch failed'); };
    const result = await fbExt().sendPrivateReply('C1', { contentType: 'text', content: { text: '感謝' } }, creds);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.reason, 'NETWORK');
    assert.equal(result.error.transient, true);
    assert.match(result.error.message, /fetch failed/);
  });
});

describe('Meta 錯誤正規化', () => {
  const cases: Array<[string, unknown, number, string, boolean]> = [
    ['190', tokenExpired, 400, 'TOKEN_EXPIRED', false],
    ['10', permissionMissing, 403, 'PERMISSION_MISSING', false],
    ['200', permission200, 400, 'PERMISSION_MISSING', false],
    ['299', graphError(299), 400, 'PERMISSION_MISSING', false],
    ['551', userUnavailable, 400, 'USER_UNAVAILABLE', false],
    ['100/33', commentNotFound, 400, 'COMMENT_NOT_FOUND', false],
    ['100 沒有 subcode 33', graphError(100), 400, 'UNKNOWN', false],
    ['10900（待實測）', alreadyReplied, 400, 'ALREADY_REPLIED', false],
    ['10903（待實測）', expiredByMeta, 400, 'EXPIRED_BY_META', false],
    ['613', rateLimited613, 400, 'RATE_LIMITED', true],
    ['4', rateLimited4, 400, 'RATE_LIMITED', true],
    ['17', graphError(17), 400, 'RATE_LIMITED', true],
    ['32', graphError(32), 400, 'RATE_LIMITED', true],
    ['80001', rateLimitedBuc, 400, 'RATE_LIMITED', true],
    ['80014', graphError(80014), 400, 'RATE_LIMITED', true],
    ['HTTP 500', { error: { message: 'Internal', code: 2 } }, 500, 'NETWORK', true],
    ['HTTP 503 沒有 JSON', 'Service Unavailable', 503, 'NETWORK', true],
    ['其他', unknownError, 400, 'UNKNOWN', false],
  ];

  for (const [name, body, status, reason, transient] of cases) {
    test(`錯誤 ${name} → ${reason}`, async () => {
      respond = typeof body === 'string' ? () => new Response(body, { status }) : json(body, status);
      for (const ext of [fbExt(), igExt()]) {
        const result = await ext.sendPrivateReply('C1', { contentType: 'text', content: { text: '感謝' } }, creds);
        assert.equal(result.ok, false);
        if (result.ok) continue;
        assert.equal(result.error.reason, reason, ext.capabilities.platform);
        assert.equal(result.error.transient, transient, ext.capabilities.platform);
      }
    });
  }

  test('限流時依 X-Business-Use-Case-Usage 帶 retryAfterMs', async () => {
    respond = json(rateLimited613, 400, { 'x-business-use-case-usage': bucUsageHeader(5) });
    const result = await fbExt().sendPrivateReply('C1', { contentType: 'text', content: { text: '感謝' } }, creds);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.reason, 'RATE_LIMITED');
    assert.equal(result.error.retryAfterMs, 5 * 60_000);
  });

  test('HTTP 200 但 body 帶 error 也視為失敗', async () => {
    respond = json(userUnavailable, 200);
    const result = await igExt().sendPrivateReply('IC1', { contentType: 'text', content: { text: '感謝' } }, creds);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.reason, 'USER_UNAVAILABLE');
  });
});

describe('IG 私訊', () => {
  test('文字私訊', async () => {
    respond = json(igPrivateReplyOk);
    const result = await igExt().sendPrivateReply('IC1', { contentType: 'text', content: { text: '感謝' } }, creds);
    assert.deepEqual(result, { ok: true, recipientId: 'IGSID-1', messageId: 'm1' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.method, 'POST');
    assert.equal(sent[0]!.url.origin + sent[0]!.url.pathname, 'https://graph.instagram.com/v21.0/me/messages');
    assert.deepEqual(sent[0]!.body, { recipient: { comment_id: 'IC1' }, message: { text: '感謝' } });
  });

  test('非文字內容', async () => {
    const result = await igExt().sendPrivateReply('IC1', { contentType: 'image', content: { url: 'https://cdn.example.com/a.jpg' } }, creds);
    assert.equal(sent.length, 0, '不可呼叫 Graph API');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, 'MATERIAL_UNSUPPORTED');
      assert.equal(result.error.transient, false);
    }
  });

  test('外掛宣告的私訊類型只有 text、沒有素材類型', () => {
    assert.deepEqual([...igExt().capabilities.privateReplyContentTypes], ['text']);
    assert.equal(igExt().capabilities.materialChannelType, null);
    assert.equal(igExt().capabilities.platform, 'ig');
    assert.equal(fbExt().capabilities.platform, 'fb');
    assert.equal(fbExt().capabilities.materialChannelType, 'fb');
    assert.ok(fbExt().capabilities.privateReplyContentTypes.includes('fb_image'));
    assert.ok(!fbExt().capabilities.privateReplyContentTypes.includes('fb_receipt'), '收據等交易版型第一版不開放');
  });
});

describe('公開回覆', () => {
  test('FB 打 POST /{comment-id}/comments', async () => {
    respond = json(publicReplyOk);
    const result = await fbExt().replyToComment('C1', '已私訊您', creds);
    assert.deepEqual(result, { ok: true, replyId: 'REPLY-1' });
    assert.equal(sent[0]!.method, 'POST');
    assert.equal(sent[0]!.url.origin + sent[0]!.url.pathname, 'https://graph.facebook.com/v21.0/C1/comments');
    assert.equal(sent[0]!.body.message, '已私訊您');
  });

  test('IG 打 POST /{comment-id}/replies', async () => {
    respond = json(publicReplyOk);
    const result = await igExt().replyToComment('IC1', '已私訊您', creds);
    assert.deepEqual(result, { ok: true, replyId: 'REPLY-1' });
    assert.equal(sent[0]!.method, 'POST');
    assert.equal(sent[0]!.url.origin + sent[0]!.url.pathname, 'https://graph.instagram.com/v21.0/IC1/replies');
    assert.equal(sent[0]!.body.message, '已私訊您');
  });

  test('公開回覆的錯誤也正規化、不丟出', async () => {
    respond = json(permission200, 400);
    const r1 = await fbExt().replyToComment('C1', '已私訊您', creds);
    assert.equal(r1.ok, false);
    if (!r1.ok) assert.equal(r1.error.reason, 'PERMISSION_MISSING');

    respond = () => { throw new TypeError('fetch failed'); };
    const r2 = await igExt().replyToComment('IC1', '已私訊您', creds);
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.equal(r2.error.reason, 'NETWORK');
  });
});
