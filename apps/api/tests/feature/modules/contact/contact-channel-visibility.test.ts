/**
 * 聯絡人本身依渠道可見範圍過濾（change extend-channel-visibility-to-contacts-and-marketing，
 * 規格 channel-scoped-visibility「聯絡人依渠道身份判斷可見」「列表查詢套用渠道過濾」「單筆讀取與操作的存取檢查」）。
 *
 * 分店帳號只綁渠道 A：
 *   P 只在渠道 B 有身份 → 看不到
 *   Q 在 A、B 都有身份 → 看得到，只列出 A 的身份
 *   R 沒有任何渠道身份（客服手動建立）→ 看得到
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import contactRoutes from '#src/modules/contact/contact.routes.js';

loadEnvConfig();
const prisma = new PrismaClient();
const T = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const stamp = Date.now();
const mark = `CI 聯絡人可見 ${stamp}`;

const role = await prisma.role.create({
  data: {
    tenantId: T,
    slug: `ci-contact-vis-${stamp}`,
    name: 'CI 聯絡人可見性',
    permissions: {
      create: ['contact.view', 'contact.update', 'contact.merge', 'inbox.view', 'case.view'].map((permissionCode) => ({ permissionCode })),
    },
  },
});
const mkChannel = (name: string) =>
  prisma.channel.create({
    data: { tenantId: T, channelType: 'WEBCHAT', displayName: `${mark} 渠道 ${name}`, credentialsEncrypted: 'x' },
  });
const chA = await mkChannel('A');
const chB = await mkChannel('B');
const agent = await prisma.agent.create({
  data: { tenantId: T, email: `ci-contact-vis-${stamp}@example.test`, name: 'CI 分店', passwordHash: 'x', roleId: role.id },
});
await prisma.agentChannelAccess.create({ data: { agentId: agent.id, channelId: chA.id, accessLevel: 'full' } });

const mkContact = (name: string) =>
  prisma.contact.create({ data: { tenantId: T, displayName: `${mark} ${name}`, phone: `09${String(stamp).slice(-6)}${name.length}`, email: `${name}-${stamp}@example.test` } });
const P = await mkContact('P');
const Q = await mkContact('Q');
const R = await mkContact('R');
const identity = (contactId: string, channelId: string, label: string) =>
  prisma.channelIdentity.create({
    data: { contactId, channelId, channelType: 'WEBCHAT', uid: `ci-vis-${label}-${stamp}`, profileName: `CI 暱稱 ${label}` },
  });
await identity(P.id, chB.id, 'P-B');
await identity(Q.id, chA.id, 'Q-A');
await identity(Q.id, chB.id, 'Q-B');
const tag = await prisma.tag.create({ data: { tenantId: T, name: `${mark} 標籤` } });
// 不可見的 LINE 渠道：Q2 在可見的 A（WEBCHAT）與這個 LINE 渠道都有身份
const chLine = await prisma.channel.create({
  data: { tenantId: T, channelType: 'LINE', displayName: `${mark} 渠道 LINE`, credentialsEncrypted: 'x' },
});
const Q2 = await mkContact('Q2');
await identity(Q2.id, chA.id, 'Q2-A');
await prisma.channelIdentity.create({
  data: { contactId: Q2.id, channelId: chLine.id, channelType: 'LINE', uid: `ci-vis-Q2-LINE-${stamp}` },
});
// S 已併入 P（身份都移到 P）；S2 已併入 Q
const S = await prisma.contact.create({ data: { tenantId: T, displayName: `${mark} S`, isArchived: true, mergedIntoId: P.id } });
const S2 = await prisma.contact.create({ data: { tenantId: T, displayName: `${mark} S2`, isArchived: true, mergedIntoId: Q.id } });
const hiddenLog = await prisma.contactMergeLog.create({
  data: { tenantId: T, survivorId: P.id, mergedId: S.id, source: 'MANUAL', movedRecords: {} },
});

const app = Fastify();
app.decorate('prisma', prisma);
app.decorate('prismaAdmin', prisma);
app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: agent.id, tenantId: T, role: 'AGENT', roleId: role.id } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
});
await app.register(contactRoutes, { prefix: '/api/v1/contacts' });
await app.ready();

afterAll(async () => {
  await app.close().catch(() => {});
  const ids = [P.id, Q.id, R.id, Q2.id, S.id, S2.id];
  await prisma.contactMergeLog.deleteMany({ where: { tenantId: T, id: hiddenLog.id } });
  await prisma.contactTag.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.tag.deleteMany({ where: { id: tag.id, tenantId: T } });
  await prisma.channelIdentity.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { tenantId: T, id: { in: ids } } });
  await prisma.agentChannelAccess.deleteMany({ where: { agentId: agent.id } });
  await prisma.agent.deleteMany({ where: { id: agent.id, tenantId: T } });
  await prisma.channel.deleteMany({ where: { tenantId: T, id: { in: [chA.id, chB.id, chLine.id] } } });
  await prisma.role.deleteMany({ where: { id: role.id } });
  await prisma.$disconnect();
});

test('聯絡人列表只含看得到的聯絡人：含 Q 與 R，不含 P，total 也不計入 P', async () => {
  const res = await app.inject({ method: 'GET', url: `/api/v1/contacts?q=${encodeURIComponent(mark)}&limit=50` });
  assert.equal(res.statusCode, 200, res.body);
  const ids = (res.json().data as Array<{ id: string }>).map((c) => c.id).sort();
  assert.deepEqual(ids, [Q.id, R.id, Q2.id].sort(), '已合併（封存）的 S、S2 不列出');
  assert.equal(res.json().meta.total, 3);
});

test('讀取看不到的聯絡人被拒：回 404，不回傳姓名、電話與 email', async () => {
  const res = await app.inject({ method: 'GET', url: `/api/v1/contacts/${P.id}` });
  assert.equal(res.statusCode, 404, res.body);
  assert.ok(!res.body.includes(P.displayName), '不可出現姓名');
  assert.ok(!res.body.includes(P.email!), '不可出現 email');
  assert.ok(!res.body.includes(P.phone!), '不可出現電話');
});

test('讀取看不到的聯絡人被拒：對話、訊息、工單、時間軸、合併紀錄都回 404', async () => {
  for (const sub of ['conversations', 'messages', 'cases', 'timeline', 'merge-logs']) {
    const res = await app.inject({ method: 'GET', url: `/api/v1/contacts/${P.id}/${sub}` });
    assert.equal(res.statusCode, 404, `${sub} 應回 404，實際 ${res.statusCode} ${res.body}`);
  }
});

test('修改看不到的聯絡人被拒：PATCH、貼標、移除標籤回 404，資料與標籤不變', async () => {
  const patch = await app.inject({ method: 'PATCH', url: `/api/v1/contacts/${P.id}`, payload: { displayName: '被改掉' } });
  assert.equal(patch.statusCode, 404, patch.body);
  const addTag = await app.inject({ method: 'POST', url: `/api/v1/contacts/${P.id}/tags`, payload: { tagId: tag.id } });
  assert.equal(addTag.statusCode, 404, addTag.body);
  const removeTag = await app.inject({ method: 'DELETE', url: `/api/v1/contacts/${P.id}/tags/${tag.id}` });
  assert.equal(removeTag.statusCode, 404, removeTag.body);

  const after = await prisma.contact.findUniqueOrThrow({ where: { id: P.id }, include: { tags: true } });
  assert.equal(after.displayName, P.displayName);
  assert.equal(after.tags.length, 0);
});

test('修改看不到的聯絡人被拒：合併與合併預覽任一方看不到都回 404', async () => {
  const merge = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts/merge',
    payload: { primaryContactId: Q.id, secondaryContactId: P.id },
  });
  assert.equal(merge.statusCode, 404, merge.body);
  const preview = await app.inject({ method: 'GET', url: `/api/v1/contacts/merge-preview?primaryId=${P.id}&secondaryId=${R.id}` });
  assert.equal(preview.statusCode, 404, preview.body);
  const stillThere = await prisma.contact.findUniqueOrThrow({ where: { id: P.id } });
  assert.equal(stillThere.mergedIntoId, null);
});

test('跨渠道聯絡人只列出可見渠道的身份：Q 的詳情只有渠道 A 的身份', async () => {
  const res = await app.inject({ method: 'GET', url: `/api/v1/contacts/${Q.id}` });
  assert.equal(res.statusCode, 200, res.body);
  const channelIds = (res.json().data.channelIdentities as Array<{ channelId: string }>).map((i) => i.channelId);
  assert.deepEqual(channelIds, [chA.id]);
});

test('沒有渠道身份的聯絡人：R 的詳情照常回傳，也可以修改', async () => {
  const res = await app.inject({ method: 'GET', url: `/api/v1/contacts/${R.id}` });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().data.id, R.id);
  const patch = await app.inject({ method: 'PATCH', url: `/api/v1/contacts/${R.id}`, payload: { language: 'en' } });
  assert.equal(patch.statusCode, 200, patch.body);
});

test('解除看不到的聯絡人的合併被拒：回 404，合併紀錄維持未解除', async () => {
  const res = await app.inject({ method: 'POST', url: `/api/v1/contacts/merge-logs/${hiddenLog.id}/revert` });
  assert.equal(res.statusCode, 404, res.body);
  const log = await prisma.contactMergeLog.findUniqueOrThrow({ where: { id: hiddenLog.id } });
  assert.equal(log.revertedAt, null);
});

test('被合併的聯絡人依保留方判斷：S 併入看不到的 P → 404；S2 併入看得到的 Q → 200', async () => {
  const s1 = await app.inject({ method: 'GET', url: `/api/v1/contacts/${S.id}` });
  assert.equal(s1.statusCode, 404, s1.body);
  assert.ok(!s1.body.includes(`${mark} S`), '不可回傳被合併聯絡人的姓名');
  const s2 = await app.inject({ method: 'GET', url: `/api/v1/contacts/${S2.id}` });
  assert.equal(s2.statusCode, 200, s2.body);
});

test('依渠道類型篩選只比對可見渠道：以 LINE 篩選不列出只在不可見 LINE 渠道有身份的 Q2', async () => {
  const res = await app.inject({ method: 'GET', url: `/api/v1/contacts?q=${encodeURIComponent(mark)}&channelType=LINE&limit=50` });
  assert.equal(res.statusCode, 200, res.body);
  const ids = (res.json().data as Array<{ id: string }>).map((c) => c.id);
  assert.ok(!ids.includes(Q2.id), '不可藉渠道類型篩選看出 Q2 在其他分店有 LINE 帳號');
});

test('合併預覽與修改的回應只含可見渠道的身份', async () => {
  const preview = await app.inject({ method: 'GET', url: `/api/v1/contacts/merge-preview?primaryId=${Q.id}&secondaryId=${R.id}` });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.ok(!preview.body.includes(`ci-vis-Q-B-${stamp}`), '合併預覽不可出現不可見渠道的 uid');
  assert.ok(!preview.body.includes('CI 暱稱 Q-B'), '合併預覽不可出現不可見渠道的暱稱');

  const patch = await app.inject({ method: 'PATCH', url: `/api/v1/contacts/${Q.id}`, payload: { language: 'ja' } });
  assert.equal(patch.statusCode, 200, patch.body);
  assert.ok(!patch.body.includes(`ci-vis-Q-B-${stamp}`), '修改的回應不可出現不可見渠道的 uid');
});
