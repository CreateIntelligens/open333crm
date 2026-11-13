/**
 * 留言擴充的貼文清單、貼文網址解析與訂閱狀態（change add-comment-keyword-private-reply，tasks 1.8 的外掛契約，
 * design「外掛契約」表）。路由層的情境（readiness、resolve-url）在第 7 節的 feature 測試；這裡只測外掛呼叫哪個端點、
 * 怎麼轉換回應，以及 resolvePostUrl 不會去 fetch 使用者給的網址（SEC-01）。
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { fbPlugin } from '#src/facebook/index.js';
import { threadsPlugin } from '#src/threads.js';

/** 擴充不存在時以斷言失敗（不是 TypeError） */
const fbC = () => {
  assert.ok(fbPlugin.extensions?.comments, 'FB 外掛要有 extensions.comments');
  return fbPlugin.extensions.comments;
};
const igC = () => {
  assert.ok(threadsPlugin.extensions?.comments, 'IG 外掛要有 extensions.comments');
  return threadsPlugin.extensions.comments;
};


type Handler = (url: URL, init?: RequestInit) => unknown;
let urls: URL[] = [];
let handler: Handler;

beforeEach(() => {
  urls = [];
  handler = () => ({});
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    urls.push(url);
    const body = handler(url, init);
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const fbCreds = { connectMode: 'platform', pageId: 'PAGE1', pageAccessToken: 'page-token' };
const igCreds = { appId: 'IG-APP', appSecret: 'ig-secret', pageAccessToken: 'ig-token' };

describe('listRecentPosts', () => {
  test('FB 打 /{page-id}/published_posts 並轉成 RecentPost', async () => {
    handler = () => ({
      data: [{
        id: 'PAGE1_1',
        message: '雙 11 限時優惠，留言 +1 領券',
        created_time: '2026-11-11T02:00:00+0000',
        permalink_url: 'https://www.facebook.com/PAGE1/posts/pfbid0abc',
        full_picture: 'https://scontent.example/1.jpg',
        attachments: { data: [{ media_type: 'photo' }] },
      }],
      paging: { cursors: { after: 'CUR2' }, next: 'https://graph.facebook.com/next' },
    });
    const res = await fbC().listRecentPosts(fbCreds);
    assert.equal(urls[0]!.origin + urls[0]!.pathname, 'https://graph.facebook.com/v21.0/PAGE1/published_posts');
    assert.equal(res.nextCursor, 'CUR2');
    assert.equal(res.posts.length, 1);
    assert.deepEqual(res.posts[0], {
      postId: 'PAGE1_1',
      permalink: 'https://www.facebook.com/PAGE1/posts/pfbid0abc',
      thumbnailUrl: 'https://scontent.example/1.jpg',
      excerpt: '雙 11 限時優惠，留言 +1 領券',
      mediaType: 'image',
      publishedAt: new Date('2026-11-11T02:00:00Z'),
    });
  });

  test('FB 帶 cursor 時送 after；最後一頁 nextCursor 為 null', async () => {
    handler = () => ({ data: [], paging: { cursors: { after: 'X' } } });
    const res = await fbC().listRecentPosts(fbCreds, 'CUR2');
    assert.equal(urls[0]!.searchParams.get('after'), 'CUR2');
    assert.equal(res.nextCursor, null, '沒有 paging.next 就是最後一頁');
  });

  test('IG 打 /me/media，REELS 對應 reels', async () => {
    handler = () => ({
      data: [{
        id: 'M1',
        caption: '新品',
        media_type: 'VIDEO',
        media_product_type: 'REELS',
        permalink: 'https://www.instagram.com/reel/Cabc/',
        thumbnail_url: 'https://cdn.example/t.jpg',
        timestamp: '2026-11-11T02:00:00+0000',
      }],
      paging: { cursors: { after: 'A' }, next: 'https://graph.instagram.com/next' },
    });
    const res = await igC().listRecentPosts(igCreds);
    assert.equal(urls[0]!.origin + urls[0]!.pathname, 'https://graph.instagram.com/v21.0/me/media');
    assert.equal(res.posts[0]!.postId, 'M1');
    assert.equal(res.posts[0]!.mediaType, 'reels');
    assert.equal(res.posts[0]!.thumbnailUrl, 'https://cdn.example/t.jpg');
    assert.equal(res.nextCursor, 'A');
  });

  test('Graph API 回錯誤時丟出（路由轉成錯誤代碼）', async () => {
    handler = () => new Response(JSON.stringify({ error: { code: 10, message: 'no perm' } }), { status: 403 });
    await assert.rejects(fbC().listRecentPosts(fbCreds));
  });
});

describe('resolvePostUrl', () => {
  test('FB 可離線換算的網址直接查 /{post-id}，不 fetch 使用者網址', async () => {
    handler = (url) => ({ id: url.pathname.split('/').pop(), message: 'x', created_time: '2026-11-11T02:00:00+0000', permalink_url: 'https://www.facebook.com/PAGE1/posts/123' });
    const post = await fbC().resolvePostUrl('https://www.facebook.com/PAGE1/posts/123', fbCreds);
    assert.equal(post?.postId, 'PAGE1_123');
    assert.ok(urls.every((u) => u.host === 'graph.facebook.com'), '只呼叫 Graph API');
  });

  test('FB pfbid 網址掃最近貼文比對 permalink_url，最多 4 頁', async () => {
    let page = 0;
    handler = () => {
      page += 1;
      return { data: [{ id: `PAGE1_${page}`, created_time: '2026-11-11T02:00:00+0000', permalink_url: `https://www.facebook.com/PAGE1/posts/pfbid${page}` }], paging: { cursors: { after: `C${page}` }, next: 'n' } };
    };
    const found = await fbC().resolvePostUrl('https://www.facebook.com/PAGE1/posts/pfbid3', fbCreds);
    assert.equal(found?.postId, 'PAGE1_3');

    page = 0;
    urls = [];
    const missing = await fbC().resolvePostUrl('https://www.facebook.com/PAGE1/posts/pfbid99', fbCreds);
    assert.equal(missing, null);
    assert.equal(urls.length, 4, '最多掃 4 頁');
  });

  test('任意外部網址不發任何請求、回 null', async () => {
    assert.equal(await fbC().resolvePostUrl('https://evil.example/posts/123', fbCreds), null);
    assert.equal(await igC().resolvePostUrl('https://evil.example/p/abc', igCreds), null);
    assert.equal(urls.length, 0);
  });

  test('IG 以 shortcode 比對 permalink', async () => {
    handler = () => ({ data: [{ id: 'M9', media_product_type: 'FEED', media_type: 'IMAGE', permalink: 'https://www.instagram.com/p/Cxyz/', timestamp: '2026-11-11T02:00:00+0000' }] });
    const post = await igC().resolvePostUrl('https://www.instagram.com/p/Cxyz/?igsh=1', igCreds);
    assert.equal(post?.postId, 'M9');
    assert.ok(urls.every((u) => u.host === 'graph.instagram.com'));
  });
});

describe('getSubscriptionStatus', () => {
  test('FB 看自己的 App 是否訂了 feed，並以 debug_token 找出缺少的權限', async () => {
    handler = (url) => {
      if (url.pathname.endsWith('/subscribed_apps')) {
        return { data: [{ id: 'OTHER', subscribed_fields: ['feed'] }, { id: 'APP1', subscribed_fields: ['messages', 'feed'] }] };
      }
      return { data: { scopes: ['pages_show_list', 'pages_manage_metadata', 'pages_messaging'] } };
    };
    const st = await fbC().getSubscriptionStatus(fbCreds, { accountId: 'PAGE1', appId: 'APP1', appSecret: 'sec' });
    assert.equal(st.subscribed, true);
    assert.deepEqual(st.missingPermissions?.sort(), ['pages_manage_engagement', 'pages_read_engagement']);
    assert.equal(st.canPrivateReply, true);
    assert.equal(st.canPublicReply, false);
    const sub = urls.find((u) => u.pathname.endsWith('/subscribed_apps'))!;
    assert.equal(sub.searchParams.get('appsecret_proof'), createHmac('sha256', 'sec').update('page-token').digest('hex'));
    const dbg = urls.find((u) => u.pathname.endsWith('/debug_token'))!;
    assert.equal(dbg.searchParams.get('input_token'), 'page-token');
    assert.equal(dbg.searchParams.get('access_token'), 'APP1|sec');
  });

  test('FB 自己的 App 沒訂 feed → subscribed false', async () => {
    handler = (url) => (url.pathname.endsWith('/subscribed_apps')
      ? { data: [{ id: 'APP1', subscribed_fields: ['messages'] }] }
      : { data: { scopes: ['pages_messaging', 'pages_manage_metadata', 'pages_show_list'] } });
    const st = await fbC().getSubscriptionStatus(fbCreds, { accountId: 'PAGE1', appId: 'APP1', appSecret: 'sec' });
    assert.equal(st.subscribed, false);
  });

  test('FB 查詢失敗時 subscribed 與 missingPermissions 為 null，不丟錯', async () => {
    handler = () => new Response('x', { status: 500 });
    const st = await fbC().getSubscriptionStatus(fbCreds, { accountId: 'PAGE1', appId: 'APP1', appSecret: 'sec' });
    assert.equal(st.subscribed, null);
    assert.equal(st.missingPermissions, null);
  });

  test('IG 打 /me/subscribed_apps；沒有 debug_token，missingPermissions 為 null（M7 待實測）', async () => {
    handler = () => ({ data: [{ subscribed_fields: ['messages', 'comments'] }] });
    const st = await igC().getSubscriptionStatus(igCreds, { accountId: 'IGID1' });
    assert.equal(urls[0]!.origin + urls[0]!.pathname, 'https://graph.instagram.com/v21.0/me/subscribed_apps');
    assert.equal(st.subscribed, true);
    assert.equal(st.missingPermissions, null);

    handler = () => new Response(JSON.stringify({ error: { code: 100, message: 'unsupported' } }), { status: 400 });
    const unknown = await igC().getSubscriptionStatus(igCreds, { accountId: 'IGID1' });
    assert.equal(unknown.subscribed, null, 'Instagram Login 不提供查詢時回 null');
  });
});
