/**
 * POST /s/track 驗證 request body（#387）：公開端點，任何人都能送任意 body。
 * 格式錯誤回 400，不碰資料庫；正常的前端呼叫端（cid 為 null 或省略）照常回目標網址。
 *
 * prismaAdmin 以 mock 替換：記下每一次查詢，用來確認格式錯誤時沒有查詢。
 * 點擊在背景以 app.prisma 開交易寫入；這裡的 $transaction mock 立即失敗，只記 log，不影響回應，
 * 也不碰 prismaAdmin，所以不會污染下一項測試的查詢紀錄。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import Fastify from 'fastify';
import shortlinkRedirectRoutes from '#src/modules/shortlink/shortlink-redirect.routes.js';

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const queries: string[] = [];
const link = {
  id: 'link-1',
  slug: 'abc',
  tenantId: TENANT_ID,
  targetUrl: 'https://example.com/x',
  isActive: true,
  expiresAt: null,
  lineChannelId: 'channel-1',
  tagOnClick: null,
};

const app = Fastify();
app.decorate('prismaAdmin', {
  shortLink: {
    findUnique: async (args: unknown) => {
      queries.push(`shortLink.findUnique ${JSON.stringify(args)}`);
      return link;
    },
  },
} as never);
app.decorate('prisma', { $transaction: async () => { throw new Error('no db in unit test'); } } as never);
app.decorate('io', {} as never);
await app.register(shortlinkRedirectRoutes, { prefix: '/s' });
await app.ready();

async function track(payload: unknown, contentType = 'application/json') {
  queries.length = 0;
  return app.inject({
    method: 'POST',
    url: '/s/track',
    headers: { 'content-type': contentType },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

function assertBadRequest(res: Awaited<ReturnType<typeof track>>) {
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'BAD_REQUEST');
  assert.deepEqual(queries, [], '格式錯誤時不查詢資料庫');
}

test('lineUid 不是字串：回 400，不查詢', async () => {
  assertBadRequest(await track({ slug: 'abc', lineUid: { $ne: null } }));
});

test('slug 不是字串：回 400，不查詢', async () => {
  assertBadRequest(await track({ slug: { contains: 'a' } }));
});

test('cid 不是字串：回 400，不查詢', async () => {
  assertBadRequest(await track({ slug: 'abc', cid: 123 }));
});

test('lineUid 超過長度上限：回 400，不查詢', async () => {
  assertBadRequest(await track({ slug: 'abc', lineUid: 'U'.repeat(65) }));
});

test('沒有 slug：維持 400 slug required', async () => {
  const res = await track({ cid: null });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.message, 'slug required');
});

test('外部瀏覽器頁的 sendBeacon（text/plain，cid 為 null）：回目標網址', async () => {
  const res = await track(JSON.stringify({ slug: 'abc', cid: null }), 'text/plain');
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().data.targetUrl, 'https://example.com/x');
});

test('LIFF 頁（省略 cid，帶 lineUid）：回目標網址', async () => {
  const res = await track({ slug: 'abc', lineUid: `U${'0'.repeat(32)}` });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().data.targetUrl, 'https://example.com/x');
});
