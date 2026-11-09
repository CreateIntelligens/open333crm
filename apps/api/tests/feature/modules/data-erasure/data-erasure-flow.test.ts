/**
 * 主規格 tenant-data-erasure 的路由與 worker 情境（change restore-tenant-audit-gdpr-specs）：
 * 發起匿名化、其他租戶的聯絡人被拒、沒有 data.erase 不能發起、匿名化、硬刪除、完成稽核與失敗紀錄。
 * 測試資料涵蓋規格列出的每一類資料，逐類檢查匿名化與硬刪除的結果。
 *
 * 路由走真實的 requirePermission 與 app_tenant 連線（RLS）。刪除工作寫進真的 outbox，commit 後不送進 Redis；
 * worker 直接呼叫 apps/workers 的 handler，資料庫是真的。物件儲存與通知佇列以 mock 取代。
 * 每次執行建立兩個專用租戶，結束時整個刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test, vi } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

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
const { createOutboxPublisher } = await import('#src/events/outbox-publisher.js');
type EventPublisher = import('#src/events/outbox-publisher.js').EventPublisher;
const { handleDataErasureJob } = await import('../../../../../workers/src/handlers/data-erasure.handler.js');
const { purgeAgentFlow } = await import('#src/modules/agent/agent.flow.js');

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
// 永久刪除成員的操作者：權限包含刪除者的權限，才能刪除刪除者（RBAC-09）
const purgerRole = await owner.role.create({
  data: {
    tenantId: A,
    slug: `${MARK}-purger`,
    name: 'purger',
    permissions: { create: [{ permissionCode: 'data.erase' }, { permissionCode: 'contact.view' }, { permissionCode: 'agent.purge' }] },
  },
});
const purger = await owner.agent.create({
  data: { tenantId: A, roleId: purgerRole.id, email: `${MARK}-purger@example.test`, name: '管理者', passwordHash: 'x' },
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
async function createSubject(avatars: { contact?: string; identity?: string } = {}) {
  seq += 1;
  const uid = `${MARK}-uid-${seq}`;
  const contact = await owner.contact.create({
    data: { tenantId: A, ...PII, ...(avatars.contact ? { avatarUrl: avatars.contact } : {}) },
  });
  await owner.channelIdentity.create({
    data: { contactId: contact.id, channelId: channel.id, channelType: 'LINE', uid, profilePic: avatars.identity ?? null },
  });
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
  // 格式與進站媒體上傳時相同：{tenantId}/media/{conversationId}/{uuid}.{ext}
  const storageKey = mediaKey(A, conversation.id);
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

/** 訊息媒體檔的 key（storage.service buildStorageKey 的格式） */
function mediaKey(tenantId: string, conversationId: string, ext = '.jpg') {
  return `${tenantId}/media/${conversationId}/${randomUUID()}${ext}`;
}

/** 在對話裡加一則帶媒體檔的訊息 */
function addMediaMessage(conversationId: string, direction: 'INBOUND' | 'OUTBOUND', storageKey: string) {
  return owner.message.create({
    data: {
      conversationId,
      senderType: direction === 'INBOUND' ? 'CONTACT' : 'AGENT',
      direction,
      contentType: 'image',
      content: { url: `https://files.example.test/x/${storageKey}`, storageKey },
    },
  });
}

/** 物件儲存裡頭像檔的 key 與公開網址（網址格式同 S3 provider：{publicUrl}/{bucket}/{key}） */
const BUCKET = process.env.S3_BUCKET || 'open333crm';
// workers 以 S3_PUBLIC_URL 確認頭像網址是自己物件儲存的檔案
process.env.S3_PUBLIC_URL = 'https://files.example.test';
function storedAvatar(tenantId: string, name: string) {
  // key 的格式與 avatar-mirror 上傳時相同：{tenantId}/avatars/{uuid}.{ext}
  const key = `${tenantId}/avatars/${randomUUID()}.jpg`;
  return { key, url: `https://files.example.test/${BUCKET}/${key}` };
}
const removedKeys = () => mocks.remove.mock.calls.map(([, key]) => key);

async function createRequest(contactId: string, mode: 'anonymize' | 'hard_delete', requestedBy = eraser.id) {
  return owner.dataErasureRequest.create({ data: { tenantId: A, requestedBy, contactId, mode, status: 'pending' } });
}
/** 工作內容與發起時寫進 outbox 的相同：requestedBy 是發起的成員 ID，成員被永久刪除後仍是這個值 */
const runJob = (request: { id: string; contactId: string; mode: string }, requestedBy = eraser.id) =>
  handleDataErasureJob(
    { data: { requestId: request.id, tenantId: A, contactId: request.contactId, mode: request.mode, requestedBy } } as never,
    owner,
    {} as never,
  );

/** 建立一位有 data.erase 的成員（之後會被永久刪除） */
async function createRequester() {
  seq += 1;
  return owner.agent.create({
    data: { tenantId: A, roleId: eraserRole.id, email: `${MARK}-requester-${seq}@example.test`, name: `發起者${seq}`, passwordHash: 'x' },
  });
}
/** 以永久刪除成員的正式流程刪除（會先把名稱與 email 寫進他發起的請求） */
const purge = (agentId: string) =>
  purgeAgentFlow({ prisma: tenantDb }, { tenantId: A, agentId: purger.id, roleId: purgerRole.id, ip: '127.0.0.1' }, agentId);

/** 寫進真的 outbox，commit 後不送進 Redis */
const outboxOnly: EventPublisher = { write: createOutboxPublisher(tenantDb).write, dispatch: async () => {} };

async function buildApp(agent: { id: string; roleId: string }, events: EventPublisher = outboxOnly) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agent.id, tenantId: A, role: 'AGENT', roleId: agent.roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, A);
  });
  await app.register(dataErasureRoutes, { prefix: '/api/v1/tenant/data-erasure', events });
  await app.ready();
  return app;
}

/** outbox 裡送往 data-erasure 佇列的刪除工作 */
const erasureJobs = () => owner.outbox.findMany({ where: { tenantId: A, kind: 'job', queueName: 'data-erasure' } });
const eraserApp = await buildApp({ id: eraser.id, roleId: eraserRole.id });
const plainApp = await buildApp({ id: plain.id, roleId: plainRole.id });

beforeEach(async () => {
  await owner.outbox.deleteMany({ where: { tenantId: A } });
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.notify.mockReset().mockResolvedValue(undefined);
});

afterAll(async () => {
  await Promise.all([eraserApp.close(), plainApp.close()]);
  for (const tenantId of [A, tenantB.id]) {
    await owner.tenantAuditLog.deleteMany({ where: { tenantId } });
    await owner.outbox.deleteMany({ where: { tenantId } });
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
  const jobs = await erasureJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].name, 'data-erasure:process');
  assert.deepEqual(jobs[0].payload, {
    requestId: request.id,
    tenantId: A,
    contactId: contact.id,
    mode: 'anonymize',
    requestedBy: eraser.id,
  });
  assert.ok(!JSON.stringify(jobs[0].payload).includes(reason), '佇列的工作內容不含 reason');

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
  assert.equal((await erasureJobs()).length, 0);
});

test('刪除工作寫不進 outbox 時不留下請求與稽核', async () => {
  const { contact } = await createSubject();
  const failing: EventPublisher = {
    write: async () => {
      throw new Error('outbox write failed');
    },
    dispatch: async () => {},
  };
  const app = await buildApp({ id: eraser.id, roleId: eraserRole.id }, failing);
  try {
    const res = await post(app, { contactId: contact.id });
    assert.equal(res.statusCode, 500, res.body);
  } finally {
    await app.close();
  }
  assert.equal(await owner.dataErasureRequest.count({ where: { contactId: contact.id } }), 0);
  assert.equal(await owner.tenantAuditLog.count({ where: { tenantId: A, action: 'data.erasure.request', targetId: contact.id } }), 0);
});

test('commit 之後送不進佇列時，請求仍然成立', async () => {
  const { contact } = await createSubject();
  const redisDown: EventPublisher = {
    write: outboxOnly.write,
    dispatch: async () => {
      throw new Error('redis down');
    },
  };
  const app = await buildApp({ id: eraser.id, roleId: eraserRole.id }, redisDown);
  let requestId: string;
  try {
    const res = await post(app, { contactId: contact.id });
    assert.equal(res.statusCode, 200, res.body);
    requestId = res.json().data.id;
  } finally {
    await app.close();
  }
  const request = await owner.dataErasureRequest.findUniqueOrThrow({ where: { id: requestId } });
  assert.equal(request.status, 'pending');
  const jobs = await erasureJobs();
  assert.equal(jobs.length, 1, '刪除工作留在 outbox，由 outbox-relay 補送');
  assert.equal(jobs[0].dispatchedAt, null);
  assert.equal((jobs[0].payload as { requestId: string }).requestId, requestId);
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

const affectedOf = async (requestId: string) =>
  (await owner.dataErasureRequest.findUniqueOrThrow({ where: { id: requestId } })).affected as Record<string, number>;

test('匿名化刪除進站訊息的媒體檔', async () => {
  const { contact, storageKey } = await createSubject();
  const request = await createRequest(contact.id, 'anonymize');
  await runJob(request);

  assert.ok(removedKeys().includes(storageKey), '刪除進站訊息的媒體檔');
  assert.equal((await affectedOf(request.id)).mediaObjects, 1);
});

test('匿名化保留出站訊息的媒體檔', async () => {
  const { contact, conversation, storageKey } = await createSubject();
  const agentKey = mediaKey(A, conversation.id, '.png');
  const outbound = await addMediaMessage(conversation.id, 'OUTBOUND', agentKey);
  await runJob(await createRequest(contact.id, 'anonymize'));

  assert.ok(!removedKeys().includes(agentKey), '客服上傳的媒體檔保留');
  assert.ok(removedKeys().includes(storageKey), '進站的照樣刪');
  const after = await owner.message.findUniqueOrThrow({ where: { id: outbound.id } });
  assert.deepEqual(after.content, outbound.content, '出站訊息的內容不變');
});

for (const mode of ['anonymize', 'hard_delete'] as const) {
  test(`不刪本租戶媒體目錄以外的檔案（${mode}）`, async () => {
    const { contact, conversation, storageKey } = await createSubject();
    const other = await createSubject();
    const outside = [
      mediaKey(tenantB.id, conversation.id), // 其他租戶
      mediaKey(A, other.conversation.id), // 本租戶其他聯絡人的對話
      `${A}/avatars/${randomUUID()}.jpg`, // media 以外的目錄
      `${A}/media/${conversation.id}/report.csv`, // 檔名不是 uuid
      `${A}/media/${conversation.id}/${randomUUID()}.jpg/../../${other.conversation.id}/x.jpg`, // 多層路徑
    ];
    for (const key of outside) await addMediaMessage(conversation.id, 'INBOUND', key);
    const request = await createRequest(contact.id, mode);
    await runJob(request);

    for (const key of outside) assert.ok(!removedKeys().includes(key), `不刪 ${key}`);
    assert.ok(removedKeys().includes(storageKey), '格式符合的照樣刪');
    const affected = await affectedOf(request.id);
    assert.equal(affected.mediaObjectsSkipped, outside.length);
    assert.equal(affected.mediaObjects, 1);
  });
}

test('仍被保留訊息引用的媒體檔保留', async () => {
  // 客服把客人傳來的圖片轉傳回去時，出站訊息帶同一個 storageKey
  const { contact, conversation, storageKey } = await createSubject();
  await addMediaMessage(conversation.id, 'OUTBOUND', storageKey);
  const request = await createRequest(contact.id, 'anonymize');
  await runJob(request);

  assert.ok(!removedKeys().includes(storageKey), '出站訊息還在用，不刪');
  const affected = await affectedOf(request.id);
  assert.equal(affected.mediaObjectsShared, 1);
  assert.equal(affected.mediaObjects, 0);
});

test('物件刪除失敗時請求仍然完成', async () => {
  const { contact, storageKey } = await createSubject();
  mocks.remove.mockRejectedValue(new Error('minio down'));
  const request = await createRequest(contact.id, 'anonymize');
  await runJob(request);

  assert.equal(mocks.remove.mock.calls.filter(([, key]) => key === storageKey).length, 1, '最多刪一次，不重試');
  const stored = await owner.dataErasureRequest.findUniqueOrThrow({ where: { id: request.id } });
  assert.equal(stored.status, 'completed');
  assert.equal((stored.affected as Record<string, number>).mediaObjectsFailed, 1);
  const logs = await owner.tenantAuditLog.findMany({ where: { tenantId: A, action: 'data.erasure.complete', targetId: contact.id } });
  assert.equal(logs.length, 1);
  assert.deepEqual((logs[0].payload as { affected: unknown }).affected, stored.affected, '稽核與請求的 affected 相同');
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

for (const mode of ['anonymize', 'hard_delete'] as const) {
  test(mode === 'anonymize' ? '匿名化刪除頭像檔' : '硬刪除刪除頭像檔', async () => {
    const contactAvatar = storedAvatar(A, `${mode}-contact`);
    const identityAvatar = storedAvatar(A, `${mode}-identity`);
    const { contact } = await createSubject({ contact: contactAvatar.url, identity: identityAvatar.url });
    await runJob(await createRequest(contact.id, mode));

    assert.ok(removedKeys().includes(contactAvatar.key), '刪除聯絡人的頭像檔');
    assert.ok(removedKeys().includes(identityAvatar.key), '刪除渠道身分的頭像檔');
  });
}

for (const mode of ['anonymize', 'hard_delete'] as const) {
  test(`刪除期間並行寫入的進站訊息也會被處理（${mode}）`, async () => {
    // 模擬收訊：刪除開始時，另一個交易正在這位客人的對話插入一則帶媒體檔、尚未 commit 的進站訊息
    const { contact, conversation } = await createSubject();
    const lateKey = mediaKey(A, conversation.id);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let inserted!: (id: string) => void;
    const insertedId = new Promise<string>((resolve) => (inserted = resolve));
    const ingest = owner.$transaction(
      async (tx) => {
        const message = await tx.message.create({
          data: {
            conversationId: conversation.id,
            senderType: 'CONTACT',
            direction: 'INBOUND',
            contentType: 'image',
            content: { text: '剛傳來的照片', storageKey: lateKey },
          },
        });
        inserted(message.id);
        await gate;
      },
      { timeout: 10_000 },
    );
    const messageId = await insertedId;

    const job = runJob(await createRequest(contact.id, mode));
    await new Promise((resolve) => setTimeout(resolve, 300)); // 讓刪除先開始
    release();
    await ingest;
    await job;

    assert.ok(removedKeys().includes(lateKey), '並行寫入的進站訊息的媒體檔也刪除');
    const late = await owner.message.findUnique({ where: { id: messageId } });
    if (mode === 'anonymize') {
      assert.deepEqual(late?.content, { redacted: true }, '並行寫入的進站訊息也改寫');
    } else {
      assert.equal(late, null);
    }
  }, 20_000);
}

test('刪除期間才寫回的頭像檔也會刪除', async () => {
  // 模擬背景補存：刪除開始時，另一個交易正要把渠道身分的頭像改成剛上傳的檔案
  const { contact } = await createSubject({
    identity: 'https://platform-lookaside.fbsbx.com/platform/profilepic/?psid=race',
  });
  const identity = await owner.channelIdentity.findFirstOrThrow({ where: { contactId: contact.id } });
  const mirrored = storedAvatar(A, 'race');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let written!: () => void;
  const updated = new Promise<void>((resolve) => (written = resolve));
  const refresh = owner.$transaction(
    async (tx) => {
      await tx.channelIdentity.update({ where: { id: identity.id }, data: { profilePic: mirrored.url } });
      written();
      await gate;
    },
    { timeout: 10_000 },
  );
  await updated;

  const job = runJob(await createRequest(contact.id, 'anonymize'));
  await new Promise((resolve) => setTimeout(resolve, 500)); // 讓刪除先讀到頭像
  release();
  await refresh;
  await job;

  assert.ok(removedKeys().includes(mirrored.key), '刪除要等補存寫完，再刪掉新的頭像檔');
});

test('不刪物件儲存以外或其他租戶的檔案', async () => {
  const foreign = storedAvatar(tenantB.id, 'foreign');
  const own = storedAvatar(A, 'crafted');
  const subject = await createSubject({
    // 網址的路徑不是 avatars 檔案、只在查詢字串帶到本租戶的 key，也不算
    contact: `https://platform-lookaside.fbsbx.com/platform/profilepic/?x=/${BUCKET}/${own.key}`,
    identity: foreign.url,
  });
  // 在 avatars 目錄、但不是補存產生的檔名格式（{uuid}.{圖片副檔名}）
  const odd = await createSubject({ identity: `https://files.example.test/${BUCKET}/${A}/avatars/exports/report.csv` });
  // 路徑與 key 都對，但主機不是物件儲存，或 bucket 不在路徑開頭
  const elsewhere = await createSubject({
    contact: `https://attacker.example/${BUCKET}/${own.key}`,
    identity: `https://files.example.test/x/${BUCKET}/${own.key}`,
  });
  const before = mocks.remove.mock.calls.length;
  await runJob(await createRequest(subject.contact.id, 'anonymize'));
  await runJob(await createRequest(odd.contact.id, 'anonymize'));
  await runJob(await createRequest(elsewhere.contact.id, 'anonymize'));

  // 匿名化會刪進站訊息的媒體檔（#329），頭像檔一個都不刪
  assert.deepEqual(
    removedKeys().slice(before).sort(),
    [subject.storageKey, odd.storageKey, elsewhere.storageKey].sort(),
    '平台網址、其他租戶與不符格式的頭像檔都不刪',
  );
});

for (const mode of ['anonymize', 'hard_delete'] as const) {
  test(`其他聯絡人仍在用的頭像檔保留（${mode}）`, async () => {
    // 合併時主聯絡人沒有頭像，會沿用被併入那位的 avatarUrl，兩位共用同一個檔案
    const shared = storedAvatar(A, `${mode}-shared`);
    const own = storedAvatar(A, `${mode}-own`);
    const { contact } = await createSubject({ contact: shared.url, identity: own.url });
    const other = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-共用`, avatarUrl: shared.url } });
    const request = await createRequest(contact.id, mode);
    await runJob(request);

    assert.ok(!removedKeys().includes(shared.key), '另一位聯絡人還在用，不刪');
    assert.ok(removedKeys().includes(own.key), '只有這位在用的照樣刪');
    const stored = await owner.dataErasureRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal((stored.affected as Record<string, number>).avatarObjectsShared, 1, '保留的筆數記在 affected');
    assert.equal((await owner.contact.findUniqueOrThrow({ where: { id: other.id } })).avatarUrl, shared.url);
  });
}

test('沒有設定 S3_PUBLIC_URL 時不刪頭像檔，筆數記在 affected', async () => {
  const avatar = storedAvatar(A, 'no-public-url');
  const { contact } = await createSubject({ identity: avatar.url });
  const request = await createRequest(contact.id, 'anonymize');
  const saved = process.env.S3_PUBLIC_URL;
  delete process.env.S3_PUBLIC_URL;
  try {
    await runJob(request);
  } finally {
    process.env.S3_PUBLIC_URL = saved;
  }

  assert.ok(!removedKeys().includes(avatar.key), '無法確認是自己的物件儲存，不刪');
  const stored = await owner.dataErasureRequest.findUniqueOrThrow({ where: { id: request.id } });
  assert.equal(stored.status, 'completed');
  assert.equal((stored.affected as Record<string, number>).avatarObjectsSkipped, 1);
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

test('發起的成員還在時記下他並通知他', async () => {
  const requester = await createRequester();
  const { contact } = await createSubject();
  const request = await createRequest(contact.id, 'anonymize', requester.id);
  await runJob(request, requester.id);

  const logs = await owner.tenantAuditLog.findMany({ where: { tenantId: A, action: 'data.erasure.complete', targetId: contact.id } });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].actorId, requester.id);
  assert.equal(logs[0].actorName, null);
  assert.equal(logs[0].actorEmail, null);
  assert.deepEqual(
    mocks.notify.mock.calls.map(([input]) => [input.agentId, input.type]),
    [[requester.id, 'data_erasure_done']],
  );
});

test('發起的成員已被永久刪除時，完成稽核記下快照、不送通知', async () => {
  const requester = await createRequester();
  const { contact } = await createSubject();
  const request = await createRequest(contact.id, 'hard_delete', requester.id);
  await purge(requester.id);
  assert.equal(await owner.agent.count({ where: { id: requester.id } }), 0, '發起的成員已被永久刪除');

  await runJob(request, requester.id);

  const stored = await owner.dataErasureRequest.findUniqueOrThrow({ where: { id: request.id } });
  assert.equal(stored.status, 'completed', stored.error ?? '');
  assert.equal(stored.requestedBy, null);
  const logs = await owner.tenantAuditLog.findMany({ where: { tenantId: A, action: 'data.erasure.complete', targetId: contact.id } });
  assert.equal(logs.length, 1, '完成稽核要寫入');
  assert.equal(logs[0].actorId, null);
  assert.equal(logs[0].actorName, requester.name);
  assert.equal(logs[0].actorEmail, requester.email);
  assert.deepEqual((logs[0].payload as { affected: unknown }).affected, stored.affected);
  assert.equal(mocks.notify.mock.calls.length, 0, '沒有收件人，不送通知');
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
