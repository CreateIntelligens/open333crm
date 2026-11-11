/**
 * 短連結的後台路由與點擊記錄（#337 階段 3）。
 * - 建立、修改目標網址時，背景抓取 OG 快照並寫回短連結（沒有手動填 OG 時）。
 * - POST /s/track 回傳目標網址；點擊紀錄、次數、點擊貼標在背景寫入。
 * - 點擊貼標失敗時，點擊照樣記錄。
 * - 同一個 lineUid 並行點擊時，只算一次不重複點擊（advisory lock 排隊）。
 * - link.clicked、contact.tagged 與點擊一起寫進 outbox（主規格 event-delivery）。
 * 屬於 feature 組：走真實路由與 app_tenant 連線（RLS）。OG 抓取以 vi.mock 替換，不連外部網站。
 * 本檔建立的資料以 MARK 標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, test, vi } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import shortlinkRoutes from '#src/modules/shortlink/shortlink.routes.js';
import shortlinkRedirectRoutes from '#src/modules/shortlink/shortlink-redirect.routes.js';
import { createFlowLog, recordingIo } from '../../../support/flow-harness.js';

vi.mock('#src/modules/shortlink/og-scraper.js', () => ({
  scrapeOg: async (url: string) => ({ ogTitle: `OG ${url}`, ogDescription: 'desc', ogImage: undefined }),
}));

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const MARK = `ci-shortlink-flow-${Date.now()}`;

const role = await owner.role.create({
  data: {
    tenantId: T,
    slug: `${MARK}-role`,
    name: `${MARK}-role`,
    permissions: { create: ['shortlink.view', 'shortlink.manage'].map((permissionCode) => ({ permissionCode })) },
  },
});
const agent = await owner.agent.create({
  data: { tenantId: T, roleId: role.id, email: `${MARK}@example.test`, name: MARK, passwordHash: 'x' },
});
const contact = await owner.contact.create({ data: { tenantId: T, displayName: `${MARK}-contact` } });
const contactTag = await owner.tag.create({ data: { tenantId: T, name: `${MARK}-clicked`, scope: 'CONTACT' } });
const caseTag = await owner.tag.create({ data: { tenantId: T, name: `${MARK}-case-only`, scope: 'CASE' } });

const log = createFlowLog();
const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', tenantDb);
app.decorate('prismaAdmin', owner);
app.decorate('io', recordingIo(log));
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: agent.id, tenantId: T, role: 'AGENT', roleId: role.id } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, T);
});
await app.register(shortlinkRoutes, { prefix: '/api/v1/shortlinks' });
await app.register(shortlinkRedirectRoutes, { prefix: '/s' });
await app.ready();

afterAll(async () => {
  await app.close();
  const links = (await owner.shortLink.findMany({ where: { tenantId: T, createdById: agent.id }, select: { id: true } })).map((l) => l.id);
  await owner.$executeRaw`DELETE FROM outbox WHERE "tenantId" = ${T}::uuid AND payload->>'shortLinkId' = ANY(${links}::text[])`;
  await owner.$executeRaw`DELETE FROM outbox WHERE "tenantId" = ${T}::uuid AND payload->>'contactId' = ${contact.id}`;
  await owner.clickLog.deleteMany({ where: { shortLinkId: { in: links } } });
  await owner.shortLink.deleteMany({ where: { id: { in: links } } });
  await owner.contactTag.deleteMany({ where: { contactId: contact.id } });
  await owner.contact.deleteMany({ where: { id: contact.id } });
  await owner.tag.deleteMany({ where: { id: { in: [contactTag.id, caseTag.id] } } });
  await owner.agent.deleteMany({ where: { id: agent.id } });
  await owner.role.deleteMany({ where: { id: role.id } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

/** 背景寫入：每 50 ms 檢查一次，最多等 3 秒 */
async function eventually<R>(read: () => Promise<R>, ok: (r: R) => boolean): Promise<R> {
  let last = await read();
  for (let i = 0; i < 60 && !ok(last); i++) {
    await new Promise((r) => setTimeout(r, 50));
    last = await read();
  }
  return last;
}

async function createLink(payload: Record<string, unknown>) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/shortlinks', payload });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().data as { id: string; slug: string };
}

const track = (slug: string, cid?: string) =>
  app.inject({ method: 'POST', url: '/s/track', payload: { slug, ...(cid ? { cid } : {}) } });

const outboxOf = (shortLinkId: string) =>
  owner.outbox.findMany({ where: { tenantId: T, payload: { path: ['shortLinkId'], equals: shortLinkId } } });

test('Create without manual OG triggers a scrape：建立短連結（沒有填 OG）時，背景抓取 OG 快照並寫回', async () => {
  const link = await createLink({ targetUrl: 'https://example.com/a', title: `${MARK}-a` });

  const after = await eventually(() => owner.shortLink.findUnique({ where: { id: link.id } }), (l) => !!l?.ogTitle);
  assert.equal(after?.ogTitle, 'OG https://example.com/a');
});

test('修改目標網址（沒有填 OG）：重新抓取 OG 快照', async () => {
  const link = await createLink({ targetUrl: 'https://example.com/b', title: `${MARK}-b` });
  await eventually(() => owner.shortLink.findUnique({ where: { id: link.id } }), (l) => !!l?.ogTitle);

  const res = await app.inject({ method: 'PATCH', url: `/api/v1/shortlinks/${link.id}`, payload: { targetUrl: 'https://example.com/b2' } });
  assert.equal(res.statusCode, 200);

  const after = await eventually(
    () => owner.shortLink.findUnique({ where: { id: link.id } }),
    (l) => l?.ogTitle === 'OG https://example.com/b2',
  );
  assert.equal(after?.ogTitle, 'OG https://example.com/b2');
});

test('點擊：回傳目標網址，背景記錄點擊、累加次數、貼上點擊標籤', async () => {
  const link = await createLink({ targetUrl: 'https://example.com/c', title: `${MARK}-c`, tagOnClick: contactTag.id });

  const res = await track(link.slug, contact.id);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().data.targetUrl, 'https://example.com/c');

  const after = await eventually(
    () => owner.shortLink.findUnique({ where: { id: link.id } }),
    (l) => l?.totalClicks === 1,
  );
  assert.equal(after?.totalClicks, 1);
  assert.equal(after?.uniqueClicks, 1);
  const clicks = await owner.clickLog.findMany({ where: { shortLinkId: link.id } });
  assert.deepEqual(clicks.map((c) => c.contactId), [contact.id]);
  const tagged = await eventually(
    () => owner.contactTag.findFirst({ where: { contactId: contact.id, tagId: contactTag.id } }),
    (t) => !!t,
  );
  assert.ok(tagged, '點擊標籤已貼上');
});

test('Click events commit with the click：link.clicked 與 contact.tagged 寫進 outbox', async () => {
  const link = await createLink({ targetUrl: 'https://example.com/d', title: `${MARK}-d`, tagOnClick: contactTag.id });

  await track(link.slug, contact.id);

  const rows = await eventually(() => outboxOf(link.id), (r) => r.length > 0);
  assert.deepEqual(rows.map((r) => r.name), ['link.clicked']);
  assert.deepEqual(rows[0].payload, {
    shortLinkId: link.id,
    slug: link.slug,
    contactId: contact.id,
    isUnique: true,
  });
  const tagged = await owner.outbox.findMany({
    where: { tenantId: T, name: 'contact.tagged', payload: { path: ['tagId'], equals: contactTag.id } },
  });
  assert.equal(tagged.length >= 1, true);
  assert.deepEqual(tagged.at(-1)?.payload, {
    contactId: contact.id,
    tagId: contactTag.id,
    tagName: contactTag.name,
    source: 'system',
  });
});

test('A failed click tag does not drop the click：標籤不適用於聯絡人時，點擊照樣記錄，不貼標', async () => {
  const link = await createLink({ targetUrl: 'https://example.com/e', title: `${MARK}-e`, tagOnClick: caseTag.id });

  const res = await track(link.slug, contact.id);
  assert.equal(res.statusCode, 200);

  const after = await eventually(
    () => owner.shortLink.findUnique({ where: { id: link.id } }),
    (l) => l?.totalClicks === 1,
  );
  assert.equal(after?.totalClicks, 1);
  assert.equal(await owner.contactTag.count({ where: { contactId: contact.id, tagId: caseTag.id } }), 0);
});

test('同一個 lineUid 並行點擊：只算一次唯一點擊', async () => {
  const link = await createLink({ targetUrl: 'https://example.com/f', title: `${MARK}-f` });
  const { getLinkForRedirect } = await import('#src/modules/shortlink/shortlink.service.js');
  const { trackClickFlow } = await import('#src/modules/shortlink/shortlink.flow.js');
  const resolved = await getLinkForRedirect(owner, link.slug);
  assert.ok(resolved);

  // 兩個交易都在 count 前停下，等另一個也到達（最多 500 ms）：重現「互相看不到未 commit 的點擊」
  let arrived = 0;
  let release: () => void = () => {};
  const bothArrived = new Promise<void>((r) => (release = r));
  const barrierPrisma = new Proxy(tenantDb, {
    get(target, prop, receiver) {
      if (prop !== '$transaction') return Reflect.get(target, prop, receiver);
      return (fn: (tx: unknown) => Promise<unknown>, options?: unknown) =>
        target.$transaction((tx) => {
          const clickLog = new Proxy(tx.clickLog, {
            get(cl, p, r) {
              if (p !== 'count') return Reflect.get(cl, p, r);
              return async (args: Parameters<typeof tx.clickLog.count>[0]) => {
                if (++arrived === 2) release();
                await Promise.race([bothArrived, new Promise((r) => setTimeout(r, 500))]);
                return cl.count(args);
              };
            },
          });
          return fn(new Proxy(tx, { get: (t, p, r) => (p === 'clickLog' ? clickLog : Reflect.get(t, p, r)) }));
        }, options as never);
    },
  });

  const deps = { prisma: barrierPrisma as PrismaClient, io: recordingIo(createFlowLog()) };
  await Promise.all([
    trackClickFlow(deps, resolved.link, { lineUid: `${MARK}-uid` }),
    trackClickFlow(deps, resolved.link, { lineUid: `${MARK}-uid` }),
  ]);

  const after = await owner.shortLink.findUnique({ where: { id: link.id } });
  assert.equal(after?.totalClicks, 2);
  assert.equal(after?.uniqueClicks, 1);
});

test('點擊不存在的短連結：回 410', async () => {
  const res = await track(`${MARK}-missing`);
  assert.equal(res.statusCode, 410);
});
