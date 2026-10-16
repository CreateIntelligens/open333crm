/**
 * 主規格 tenant-data-erasure 的路由與 worker 情境（change restore-tenant-audit-gdpr-specs）：
 * 發起匿名化、其他租戶的聯絡人被拒、沒有 data.erase 不能發起、匿名化、硬刪除、完成稽核與失敗紀錄。
 * 測試資料涵蓋規格列出的每一類資料，逐類檢查匿名化與硬刪除的結果。
 *
 * 路由走真實的 requirePermission 與 app_tenant 連線（RLS），入列以 setEnqueueErasureJob 取代；
 * worker 直接呼叫 apps/workers 的 handler，資料庫是真的。物件儲存與通知佇列以 mock 取代。
 * 每次執行建立兩個專用租戶，結束時整個刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test, vi } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  remove: vi.fn(async (_bucket: string, _key: string) => undefined),
  notify: vi.fn(async (_input: { agentId: string; type: string }) => undefined),
}));

vi.mock('@open333crm/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@open333crm/core')>()),
  MinioStorageProvider: class {
    delete = mocks.remove;
  },
}));
vi.mock('../../../../../workers/src/lib/notification-queue.js', () => ({ enqueueNotification: mocks.notify }));

const { loadEnvConfig } = await import('#src/config/env.js');
const { tenantScopedClient } = await import('#src/lib/tenant-db.js');
const { default: errorHandlerPlugin } = await import('#src/plugins/error-handler.plugin.js');
const { default: dataErasureRoutes } = await import('#src/modules/data-erasure/data-erasure.routes.js');
const { setEnqueueErasureJob } = await import('#src/modules/data-erasure/data-erasure.service.js');
const { handleDataErasureJob } = await import('../../../../../workers/src/handlers/data-erasure.handler.js');

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-erasure-flow-${Date.now()}`;
let seq = 0;

const tenantA = await owner.tenant.create({ data: { name: `${MARK}-a` } });
const tenantB = await owner.tenant.create({ data: { name: `${MARK}-b` } });
const A = tenantA.id;

const eraserRole = await owner.role.create({
  data: {
    tenantId: A,
    slug: `${MARK}-eraser`,
    name: 'eraser',
    permissions: { create: [{ permissionCode: 'data.erase' }, { permissionCode: 'contact.view' }] },
  },
});
const plainRole = await owner.role.create({
  data: { tenantId: A, slug: `${MARK}-plain`, name: 'plain', permissions: { create: [{ permissionCode: 'contact.view' }] } },
});
const eraser = await owner.agent.create({
  data: { tenantId: A, roleId: eraserRole.id, email: `${MARK}-eraser@example.test`, name: '刪除者', passwordHash: 'x' },
});
const plain = await owner.agent.create({
  data: { tenantId: A, roleId: plainRole.id, email: `${MARK}-plain@example.test`, name: '一般成員', passwordHash: 'x' },
});
const channel = await owner.channel.create({
  data: { tenantId: A, channelType: 'LINE', displayName: `${MARK}-ch`, credentialsEncrypted: 'x' },
});
const foreignContact = await owner.contact.create({ data: { tenantId: tenantB.id, displayName: `${MARK}-其他租戶` } });
const tag = await owner.tag.create({ data: { tenantId: A, name: `${MARK}-tag` } });
const activity = await owner.portalActivity.create({
  data: { tenantId: A, type: 'FORM', title: `${MARK}-活動`, createdById: eraser.id },
});

const PII = { displayName: '王小明', phone: '0912345678', email: 'ming@example.test', avatarUrl: 'https://example.test/a.png' };

/**
 * 建一位聯絡人，帶齊規格提到的資料：渠道身分、屬性、IdentityMap、長期記憶、標籤、活動提交、積分紀錄、
 * 對話（進站與出站訊息，進站訊息帶媒體檔）與工單。回傳的 storageKey 是這位聯絡人的媒體檔。
 */
async function createSubject() {
  seq += 1;
  const uid = `${MARK}-uid-${seq}`;
  const storageKey = `${MARK}/photo-${seq}.jpg`;
  const contact = await owner.contact.create({ data: { tenantId: A, ...PII } });
  await owner.channelIdentity.create({ data: { contactId: contact.id, channelId: channel.id, channelType: 'LINE', uid } });
  await owner.contactAttribute.create({ data: { contactId: contact.id, key: 'birthday', value: '1990-01-01' } });
  await owner.identityMap.create({ data: { tenantId: A, contactId: contact.id, channelType: 'LINE', uid, source: 'MANUAL' } });
  await owner.longTermMemory.create({ data: { contactId: contact.id, content: '客人住在台北' } });
  await owner.contactTag.create({ data: { contactId: contact.id, tagId: tag.id } });
  await owner.portalSubmission.create({
    data: { tenantId: A, activityId: activity.id, contactId: contact.id, answers: { phone: PII.phone } },
  });
  await owner.pointTransaction.create({ data: { tenantId: A, contactId: contact.id, amount: 10, balance: 10, type: 'earn' } });
  const conversation = await owner.conversation.create({
    data: { tenantId: A, contactId: contact.id, channelId: channel.id, channelType: 'LINE' },
  });
  await owner.message.create({
    data: {
      conversationId: conversation.id,
      senderType: 'CONTACT',
      direction: 'INBOUND',
      contentType: 'image',
      content: { text: '我的電話是 0912345678', storageKey },
    },
  });
  await owner.message.create({
    data: { conversationId: conversation.id, senderType: 'AGENT', direction: 'OUTBOUND', contentType: 'text', content: { text: '收到' } },
  });
  const kase = await owner.case.create({ data: { tenantId: A, contactId: contact.id, channelId: channel.id, title: `${MARK}-工單` } });
  return { contact, conversation, kase, storageKey };
}

async function createRequest(contactId: string, mode: 'anonymize' | 'hard_delete') {
  return owner.dataErasureRequest.create({ data: { tenantId: A, requestedBy: eraser.id, contactId, mode, status: 'pending' } });
}
const runJob = (request: { id: string; contactId: string; mode: string }) =>
  handleDataErasureJob(
    { data: { requestId: request.id, tenantId: A, contactId: request.contactId, mode: request.mode, requestedBy: eraser.id } } as never,
    owner,
    {} as never,
  );

async function buildApp(agent: { id: string; roleId: string }) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agent.id, tenantId: A, role: 'AGENT', roleId: agent.roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, A);
  });
  await app.register(dataErasureRoutes, { prefix: '/api/v1/tenant/data-erasure' });
  await app.ready();
  return app;
}

const enqueued: unknown[] = [];
setEnqueueErasureJob(async (data) => {
  enqueued.push(data);
});
const eraserApp = await buildApp({ id: eraser.id, roleId: eraserRole.id });
const plainApp = await buildApp({ id: plain.id, roleId: plainRole.id });

beforeEach(() => {
  enqueued.length = 0;
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.notify.mockReset().mockResolvedValue(undefined);
});

afterAll(async () => {
  setEnqueueErasureJob(null);
  await Promise.all([eraserApp.close(), plainApp.close()]);
  for (const tenantId of [A, tenantB.id]) {
    await owner.tenantAuditLog.deleteMany({ where: { tenantId } });
    await owner.dataErasureRequest.deleteMany({ where: { tenantId } });
    await owner.portalSubmission.deleteMany({ where: { tenantId } });
    await owner.pointTransaction.deleteMany({ where: { tenantId } });
    await owner.case.deleteMany({ where: { tenantId } });
    await owner.conversation.deleteMany({ where: { tenantId } });
    await owner.contact.deleteMany({ where: { tenantId } });
    await owner.portalActivity.deleteMany({ where: { tenantId } });
    await owner.tag.deleteMany({ where: { tenantId } });
    await owner.channel.deleteMany({ where: { tenantId } });
    await owner.agent.deleteMany({ where: { tenantId } });
    await owner.role.deleteMany({ where: { tenantId } });
    await owner.tenant.delete({ where: { id: tenantId } });
  }
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

const post = (app: typeof eraserApp, payload: object) =>
  app.inject({ method: 'POST', url: '/api/v1/tenant/data-erasure', payload });

test('發起匿名化', async () => {
  const { contact } = await createSubject();
  const reason = '客人來信要求刪除';
  const res = await post(eraserApp, { contactId: contact.id, reason });
  assert.equal(res.statusCode, 200, res.body);

  const request = await owner.dataErasureRequest.findUniqueOrThrow({ where: { id: res.json().data.id } });
  assert.equal(request.mode, 'anonymize');
  assert.equal(request.status, 'pending');
  assert.equal(request.reason, reason, 'reason 存在請求上');
  assert.equal(enqueued.length, 1);
  assert.ok(!JSON.stringify(enqueued[0]).includes(reason), '佇列的工作內容不含 reason');

  const logs = await owner.tenantAuditLog.findMany({ where: { tenantId: A, action: 'data.erasure.request', targetId: contact.id } });
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].payload, { contactId: contact.id, mode: 'anonymize' });
});

test('發起刪除的稽核記錄來源 IP', async () => {
  const { contact } = await createSubject();
  const res = await eraserApp.inject({
    method: 'POST',
    url: '/api/v1/tenant/data-erasure',
    payload: { contactId: contact.id },
    remoteAddress: '203.0.113.7',
  });
  assert.equal(res.statusCode, 200, res.body);

  const logs = await owner.tenantAuditLog.findMany({ where: { tenantId: A, action: 'data.erasure.request', targetId: contact.id } });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].ip, '203.0.113.7');
});

test('其他租戶的聯絡人被拒', async () => {
  const before = await owner.dataErasureRequest.count({ where: { tenantId: A } });
  const res = await post(eraserApp, { contactId: foreignContact.id, mode: 'hard_delete' });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().error.code, 'CONTACT_NOT_FOUND');
  assert.equal(await owner.dataErasureRequest.count({ where: { tenantId: A } }), before);
  assert.equal(enqueued.length, 0);
});

test('沒有 data.erase 不能發起', async () => {
  const { contact } = await createSubject();
  const res = await post(plainApp, { contactId: contact.id });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.details.requiredPermission, 'data.erase');
  assert.equal(await owner.dataErasureRequest.count({ where: { contactId: contact.id } }), 0);
});

test('匿名化後無法從聯絡人與進站訊息識別客人', async () => {
  const { contact, conversation, kase } = await createSubject();
  await runJob(await createRequest(contact.id, 'anonymize'));

  const after = await owner.contact.findUniqueOrThrow({ where: { id: contact.id } });
  assert.equal(after.displayName, '[已刪除]');
  assert.equal(after.phone, null);
  assert.equal(after.email, null);
  assert.equal(after.avatarUrl, null);
  assert.equal(await owner.contactAttribute.count({ where: { contactId: contact.id } }), 0);
  assert.equal(await owner.channelIdentity.count({ where: { contactId: contact.id } }), 0);
  assert.equal(await owner.identityMap.count({ where: { contactId: contact.id } }), 0);
  assert.equal(await owner.longTermMemory.count({ where: { contactId: contact.id } }), 0);

  const messages = await owner.message.findMany({ where: { conversationId: conversation.id } });
  const inbound = messages.filter((m) => m.direction === 'INBOUND');
  const outbound = messages.filter((m) => m.direction === 'OUTBOUND');
  assert.deepEqual(inbound.map((m) => m.content), [{ redacted: true }]);
  assert.deepEqual(outbound.map((m) => m.content), [{ text: '收到' }], '出站訊息保留');
  assert.ok(await owner.conversation.findUnique({ where: { id: conversation.id } }), '對話保留');
  assert.ok(await owner.case.findUnique({ where: { id: kase.id } }), '工單保留');
});

test('硬刪除連帶刪除對話與工單', async () => {
  const { contact, conversation, kase, storageKey } = await createSubject();
  await runJob(await createRequest(contact.id, 'hard_delete'));

  const contactId = contact.id;
  assert.equal(await owner.contact.findUnique({ where: { id: contactId } }), null);
  assert.equal(await owner.conversation.findUnique({ where: { id: conversation.id } }), null);
  assert.equal(await owner.message.count({ where: { conversationId: conversation.id } }), 0);
  assert.equal(await owner.case.findUnique({ where: { id: kase.id } }), null);
  assert.equal(await owner.portalSubmission.count({ where: { contactId } }), 0, '活動提交');
  assert.equal(await owner.pointTransaction.count({ where: { contactId } }), 0, '積分紀錄');
  assert.equal(await owner.contactAttribute.count({ where: { contactId } }), 0, '屬性');
  assert.equal(await owner.channelIdentity.count({ where: { contactId } }), 0, '渠道身分');
  assert.equal(await owner.identityMap.count({ where: { contactId } }), 0, 'IdentityMap');
  assert.equal(await owner.longTermMemory.count({ where: { contactId } }), 0, '長期記憶');
  assert.equal(await owner.contactTag.count({ where: { contactId } }), 0, '標籤');
  assert.ok(mocks.remove.mock.calls.some(([, key]) => key === storageKey), '刪除訊息的媒體檔');
});

test('硬刪除不影響其他聯絡人', async () => {
  const target = await createSubject();
  const other = await createSubject();
  const relation = await owner.contactRelation.create({
    data: { fromContactId: target.contact.id, toContactId: other.contact.id, relationType: 'family' },
  });
  await runJob(await createRequest(target.contact.id, 'hard_delete'));

  assert.equal(await owner.contactRelation.findUnique({ where: { id: relation.id } }), null);
  const kept = await owner.contact.findUniqueOrThrow({ where: { id: other.contact.id } });
  assert.equal(kept.displayName, PII.displayName);
  assert.ok(await owner.conversation.findUnique({ where: { id: other.conversation.id } }), '另一位的對話保留');
  assert.ok(await owner.case.findUnique({ where: { id: other.kase.id } }), '另一位的工單保留');
});

test('完成稽核不含個人資料', async () => {
  const { contact } = await createSubject();
  const request = await createRequest(contact.id, 'anonymize');
  await runJob(request);

  const stored = await owner.dataErasureRequest.findUniqueOrThrow({ where: { id: request.id } });
  assert.equal(stored.status, 'completed');
  const logs = await owner.tenantAuditLog.findMany({ where: { tenantId: A, action: 'data.erasure.complete', targetId: contact.id } });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].actorId, eraser.id);
  const payload = logs[0].payload as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload).sort(), ['affected', 'contactId', 'mode']);
  assert.deepEqual(payload.affected, stored.affected);
  const text = JSON.stringify(payload);
  for (const value of [PII.displayName, PII.phone, PII.email]) assert.ok(!text.includes(value), `payload 不含 ${value}`);
  assert.equal(mocks.notify.mock.calls.length, 1);
  assert.equal(mocks.notify.mock.calls[0][0].type, 'data_erasure_done');
});

test('聯絡人已不存在時記錄失敗', async () => {
  const { contact } = await createSubject();
  const request = await createRequest(contact.id, 'hard_delete');
  await owner.case.deleteMany({ where: { contactId: contact.id } });
  await owner.conversation.deleteMany({ where: { contactId: contact.id } });
  await owner.portalSubmission.deleteMany({ where: { contactId: contact.id } });
  await owner.pointTransaction.deleteMany({ where: { contactId: contact.id } });
  await owner.contact.delete({ where: { id: contact.id } });

  await assert.rejects(runJob(request));
  const stored = await owner.dataErasureRequest.findUniqueOrThrow({ where: { id: request.id } });
  assert.equal(stored.status, 'failed');
  assert.match(stored.error ?? '', /not found/);
});
