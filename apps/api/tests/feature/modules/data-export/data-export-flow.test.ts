/**
 * 主規格 tenant-data-export 的路由與 worker 情境（change restore-tenant-audit-gdpr-specs）：
 * 發起匯出、沒有 data.export 不能發起、匯出只含本租戶的資料、上傳失敗時記錄原因、保留期內下載、清理後的匯出不能下載、
 * 清理過期的匯出；以及 change migrate-data-export-tenant-ctx 的「發起匯出的寫入一起成立」。
 *
 * 路由走真實的 requirePermission 與 app_tenant 連線（RLS）。匯出工作寫進真的 outbox，commit 後不送進 Redis；
 * worker 直接呼叫 apps/workers 的 handler，資料庫是真的。物件儲存、下載連結與通知佇列以 mock 取代。
 * 每次執行建立兩個專用租戶，結束時整個刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test, vi } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(async (_bucket: string, _key: string, _data: Buffer, _type: string) => undefined),
  remove: vi.fn(async (_bucket: string, _key: string) => undefined),
  notify: vi.fn(async (_input: { agentId: string; type: string }) => undefined),
}));

vi.mock('@open333crm/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@open333crm/core')>()),
  MinioStorageProvider: class {
    upload = mocks.upload;
    delete = mocks.remove;
  },
}));
vi.mock('../../../../../workers/src/lib/notification-queue.js', () => ({ enqueueNotification: mocks.notify }));
vi.mock('#src/modules/storage/storage.service.js', () => ({
  getFileUrl: async (key: string) => `https://storage.example.test/${key}?signed=1`,
}));

const { loadEnvConfig } = await import('#src/config/env.js');
const { tenantScopedClient } = await import('#src/lib/tenant-db.js');
const { default: errorHandlerPlugin } = await import('#src/plugins/error-handler.plugin.js');
const { default: dataExportRoutes } = await import('#src/modules/data-export/data-export.routes.js');
const { createOutboxPublisher } = await import('#src/events/outbox-publisher.js');
type EventPublisher = import('#src/events/outbox-publisher.js').EventPublisher;
const { handleDataExportJob, handleDataExportCleanup } = await import(
  '../../../../../workers/src/handlers/data-export.handler.js'
);
const { purgeAgentFlow } = await import('#src/modules/agent/agent.flow.js');
const { createCommentReplyFixtures } = await import('../../../support/comment-reply-fixtures.js');

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-export-flow-${Date.now()}`;

const tenantA = await owner.tenant.create({ data: { name: `${MARK}-a` } });
const tenantB = await owner.tenant.create({ data: { name: `${MARK}-b` } });
const A = tenantA.id;

// 匯出是全租戶資料：發起、查詢與下載都要同時有 data.export 與 channel.view_all（#428）
const exporterRole = await owner.role.create({
  data: {
    tenantId: A,
    slug: `${MARK}-exporter`,
    name: 'exporter',
    permissions: {
      create: [{ permissionCode: 'data.export' }, { permissionCode: 'channel.view' }, { permissionCode: 'channel.view_all' }],
    },
  },
});
// 只有 data.export、沒有 channel.view_all 的成員（例如只看得到某家分店的自訂角色）
const branchExporterRole = await owner.role.create({
  data: {
    tenantId: A,
    slug: `${MARK}-branch-exporter`,
    name: 'branch exporter',
    permissions: { create: [{ permissionCode: 'data.export' }, { permissionCode: 'channel.view' }] },
  },
});
const plainRole = await owner.role.create({
  data: { tenantId: A, slug: `${MARK}-plain`, name: 'plain', permissions: { create: [{ permissionCode: 'contact.view' }] } },
});
const exporter = await owner.agent.create({
  data: { tenantId: A, roleId: exporterRole.id, email: `${MARK}-exporter@example.test`, name: '匯出者', passwordHash: 'x' },
});
const branchExporter = await owner.agent.create({
  data: {
    tenantId: A,
    roleId: branchExporterRole.id,
    email: `${MARK}-branch-exporter@example.test`,
    name: '分店匯出者',
    passwordHash: 'x',
  },
});
// 永久刪除成員的操作者：權限包含匯出者的權限，才能刪除匯出者（RBAC-09）
const purgerRole = await owner.role.create({
  data: {
    tenantId: A,
    slug: `${MARK}-purger`,
    name: 'purger',
    permissions: {
      create: [
        { permissionCode: 'data.export' },
        { permissionCode: 'channel.view' },
        { permissionCode: 'channel.view_all' },
        { permissionCode: 'agent.purge' },
      ],
    },
  },
});
const purger = await owner.agent.create({
  data: { tenantId: A, roleId: purgerRole.id, email: `${MARK}-purger@example.test`, name: '管理者', passwordHash: 'x' },
});
const plain = await owner.agent.create({
  data: { tenantId: A, roleId: plainRole.id, email: `${MARK}-plain@example.test`, name: '一般成員', passwordHash: 'x' },
});

// 租戶 A：一位聯絡人（含渠道身分、屬性、標籤）、一則對話（含標籤）、一則訊息、一張工單（含備註、事件、標籤）；
// 租戶 B：一位聯絡人
const channelA = await owner.channel.create({
  data: { tenantId: A, channelType: 'WEBCHAT', displayName: `${MARK}-ch`, credentialsEncrypted: 'x' },
});
const tagA = await owner.tag.create({ data: { tenantId: A, name: `${MARK}-tag` } });
const contactA = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-客人A` } });
await owner.channelIdentity.create({
  data: { contactId: contactA.id, channelId: channelA.id, channelType: 'WEBCHAT', uid: `${MARK}-uid` },
});
await owner.contactAttribute.create({ data: { contactId: contactA.id, key: 'birthday', value: '1990-01-01' } });
await owner.contactTag.create({ data: { contactId: contactA.id, tagId: tagA.id } });
const conversationA = await owner.conversation.create({
  data: { tenantId: A, contactId: contactA.id, channelId: channelA.id, channelType: 'WEBCHAT' },
});
await owner.conversationTag.create({ data: { conversationId: conversationA.id, tagId: tagA.id } });
await owner.message.create({
  data: { conversationId: conversationA.id, senderType: 'CONTACT', contentType: 'text', content: { text: '你好' } },
});
const caseA = await owner.case.create({
  data: { tenantId: A, contactId: contactA.id, channelId: channelA.id, title: `${MARK}-工單` },
});
await owner.caseNote.create({ data: { caseId: caseA.id, agentId: exporter.id, content: '備註內容' } });
await owner.caseEvent.create({ data: { caseId: caseA.id, actorType: 'agent', eventType: 'created' } });
await owner.caseTag.create({ data: { caseId: caseA.id, tagId: tagA.id } });
await owner.contact.create({ data: { tenantId: tenantB.id, displayName: `${MARK}-客人B` } });

const crFx = createCommentReplyFixtures(owner, MARK);

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
  await app.register(dataExportRoutes, { prefix: '/api/v1/tenant/data-export', events });
  await app.ready();
  return app;
}

/** outbox 裡送往 data-export 佇列的匯出工作 */
const exportJobs = () => owner.outbox.findMany({ where: { tenantId: A, kind: 'job', queueName: 'data-export' } });
const requestAudits = () => owner.tenantAuditLog.findMany({ where: { tenantId: A, action: 'data.export.request' } });
const exporterApp = await buildApp({ id: exporter.id, roleId: exporterRole.id });
const plainApp = await buildApp({ id: plain.id, roleId: plainRole.id });
const branchExporterApp = await buildApp({ id: branchExporter.id, roleId: branchExporterRole.id });

/** 建一筆匯出請求，模擬 POST 之後、worker 處理之前的狀態 */
const createRequest = (data: Record<string, unknown> = {}) =>
  owner.dataExportRequest.create({ data: { tenantId: A, requestedBy: exporter.id, status: 'pending', ...data } });
/** 工作內容與發起時寫進 outbox 的相同：requestedBy 是發起的成員 ID，成員被永久刪除後仍是這個值 */
const runJob = (requestId: string, requestedBy = exporter.id) =>
  handleDataExportJob({ data: { requestId, tenantId: A, requestedBy } } as never, owner, {} as never);

let seq = 0;
/** 建立一位可以匯出的成員，以他發起一筆匯出請求，再以永久刪除成員的正式流程刪除他 */
async function requestThenPurgeRequester() {
  seq += 1;
  const requester = await owner.agent.create({
    data: { tenantId: A, roleId: exporterRole.id, email: `${MARK}-requester-${seq}@example.test`, name: `發起者${seq}`, passwordHash: 'x' },
  });
  const req = await createRequest({ requestedBy: requester.id });
  await purgeAgentFlow({ prisma: tenantDb }, { tenantId: A, agentId: purger.id, roleId: purgerRole.id, ip: '127.0.0.1' }, requester.id);
  assert.equal(await owner.agent.count({ where: { id: requester.id } }), 0, '發起的成員已被永久刪除');
  return { requester, req };
}

/** SimpleZip 只用 store（不壓縮）：依本地檔頭逐一讀出檔名與內容 */
function readZip(buffer: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    files.set(buffer.toString('utf8', offset + 30, offset + 30 + nameLength), buffer.toString('utf8', start, start + size));
    offset = start + size;
  }
  return files;
}

beforeEach(async () => {
  await owner.outbox.deleteMany({ where: { tenantId: A } });
  mocks.upload.mockReset().mockResolvedValue(undefined);
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.notify.mockReset().mockResolvedValue(undefined);
});

afterAll(async () => {
  await Promise.all([exporterApp.close(), plainApp.close(), branchExporterApp.close()]);
  await crFx.deleteCommentData([A, tenantB.id]);
  for (const tenantId of [A, tenantB.id]) {
    await owner.tenantAuditLog.deleteMany({ where: { tenantId } });
    await owner.outbox.deleteMany({ where: { tenantId } });
    await owner.dataExportRequest.deleteMany({ where: { tenantId } });
    await owner.case.deleteMany({ where: { tenantId } });
    await owner.conversation.deleteMany({ where: { tenantId } });
    await owner.contact.deleteMany({ where: { tenantId } });
    await owner.tag.deleteMany({ where: { tenantId } });
    await owner.channel.deleteMany({ where: { tenantId } });
    await owner.agent.deleteMany({ where: { tenantId } });
    await owner.role.deleteMany({ where: { tenantId } });
    await owner.tenant.delete({ where: { id: tenantId } });
  }
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

const post = (app: typeof exporterApp, payload: object = {}) =>
  app.inject({ method: 'POST', url: '/api/v1/tenant/data-export', payload });

test('發起匯出', async () => {
  const res = await post(exporterApp, { scope: ['contacts'] });
  assert.equal(res.statusCode, 200, res.body);

  const request = await owner.dataExportRequest.findUniqueOrThrow({ where: { id: res.json().data.id } });
  assert.equal(request.status, 'pending');
  assert.equal(request.requestedBy, exporter.id);
  assert.equal(res.json().data.status, 'pending');

  const jobs = await exportJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].name, 'data-export:generate');
  assert.deepEqual(jobs[0].payload, { requestId: request.id, tenantId: A, requestedBy: exporter.id });

  const logs = (await requestAudits()).filter((log) => log.targetId === request.id);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].actorId, exporter.id);
  assert.deepEqual(logs[0].payload, { scope: ['contacts'] });
});

test('發起匯出的稽核記錄來源 IP', async () => {
  const res = await exporterApp.inject({
    method: 'POST',
    url: '/api/v1/tenant/data-export',
    payload: {},
    remoteAddress: '203.0.113.7',
  });
  assert.equal(res.statusCode, 200, res.body);

  const logs = (await requestAudits()).filter((log) => log.targetId === res.json().data.id);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].ip, '203.0.113.7');
});

test('匯出工作寫不進 outbox 時不留下請求與稽核', async () => {
  const requestsBefore = await owner.dataExportRequest.count({ where: { tenantId: A } });
  const auditsBefore = (await requestAudits()).length;
  const failing: EventPublisher = {
    write: async () => {
      throw new Error('outbox write failed');
    },
    dispatch: async () => {},
  };
  const app = await buildApp({ id: exporter.id, roleId: exporterRole.id }, failing);
  try {
    const res = await post(app);
    assert.equal(res.statusCode, 500, res.body);
  } finally {
    await app.close();
  }
  assert.equal(await owner.dataExportRequest.count({ where: { tenantId: A } }), requestsBefore);
  assert.equal((await requestAudits()).length, auditsBefore);
});

test('commit 之後送不進佇列時，請求仍然成立', async () => {
  const redisDown: EventPublisher = {
    write: outboxOnly.write,
    dispatch: async () => {
      throw new Error('redis down');
    },
  };
  const app = await buildApp({ id: exporter.id, roleId: exporterRole.id }, redisDown);
  let requestId: string;
  try {
    const res = await post(app);
    assert.equal(res.statusCode, 200, res.body);
    requestId = res.json().data.id;
  } finally {
    await app.close();
  }
  const request = await owner.dataExportRequest.findUniqueOrThrow({ where: { id: requestId } });
  assert.equal(request.status, 'pending');
  const jobs = await exportJobs();
  assert.equal(jobs.length, 1, '匯出工作留在 outbox，由 outbox-relay 補送');
  assert.equal(jobs[0].dispatchedAt, null);
  assert.equal((jobs[0].payload as { requestId: string }).requestId, requestId);
});

test('沒有 data.export 不能發起', async () => {
  const before = await owner.dataExportRequest.count({ where: { tenantId: A } });
  const res = await post(plainApp);
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.details.requiredPermission, 'data.export');
  assert.equal(await owner.dataExportRequest.count({ where: { tenantId: A } }), before);
  assert.equal((await exportJobs()).length, 0);
});

test('沒有 channel.view_all 不能發起匯出', async () => {
  const before = await owner.dataExportRequest.count({ where: { tenantId: A } });
  const auditsBefore = (await requestAudits()).length;
  const res = await post(branchExporterApp);
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.details.requiredPermission, 'channel.view_all');
  assert.equal(await owner.dataExportRequest.count({ where: { tenantId: A } }), before);
  assert.equal((await requestAudits()).length, auditsBefore);
  assert.equal((await exportJobs()).length, 0);
});

test('沒有 channel.view_all 不能查詢或下載別人發起的匯出', async () => {
  const req = await createRequest({
    status: 'completed',
    fileKey: `export/${A}/${MARK}-branch.zip`,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  for (const url of [`/api/v1/tenant/data-export/${req.id}`, `/api/v1/tenant/data-export/${req.id}/download`]) {
    const res = await branchExporterApp.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 403, `${url} ${res.body}`);
    assert.equal(res.json().error.details.requiredPermission, 'channel.view_all');
    assert.equal(res.json().data, undefined, '不回傳請求內容或下載連結');
  }
  const stored = await owner.dataExportRequest.findUniqueOrThrow({ where: { id: req.id } });
  assert.equal(stored.downloadCount, 0, '被拒的下載不累計次數');
});

test('有 data.export 與 channel.view_all 的成員可以查詢與下載別人發起的匯出', async () => {
  const req = await owner.dataExportRequest.create({
    data: {
      tenantId: A,
      requestedBy: branchExporter.id,
      status: 'completed',
      fileKey: `export/${A}/${MARK}-other.zip`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const status = await exporterApp.inject({ method: 'GET', url: `/api/v1/tenant/data-export/${req.id}` });
  assert.equal(status.statusCode, 200, status.body);
  assert.equal(status.json().data.status, 'completed');
  const res = await exporterApp.inject({ method: 'GET', url: `/api/v1/tenant/data-export/${req.id}/download` });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().data.url, `https://storage.example.test/export/${A}/${MARK}-other.zip?signed=1`);
});

test('匯出只含本租戶的資料', async () => {
  const req = await createRequest();
  await runJob(req.id);

  const stored = await owner.dataExportRequest.findUniqueOrThrow({ where: { id: req.id } });
  assert.equal(stored.status, 'completed', stored.error ?? '');
  assert.equal(stored.fileKey, `export/${A}/${req.id}.zip`);
  assert.ok(stored.expiresAt && stored.expiresAt.getTime() > Date.now());

  assert.equal(mocks.upload.mock.calls.length, 1);
  const [, key, buffer] = mocks.upload.mock.calls[0];
  assert.equal(key, stored.fileKey);
  assert.equal(stored.fileSizeBytes, buffer.length);

  const files = readZip(buffer);
  type Tagged = { tags: Array<{ tag: { name: string } }> };
  const contacts = JSON.parse(files.get('json/contacts.json')!) as Array<
    Tagged & { id: string; channelIdentities: Array<{ uid: string }>; attributes: Array<{ key: string }> }
  >;
  assert.deepEqual(contacts.map((c) => c.id), [contactA.id]);
  assert.deepEqual(contacts[0].channelIdentities.map((i) => i.uid), [`${MARK}-uid`], '聯絡人含渠道身分');
  assert.deepEqual(contacts[0].attributes.map((a) => a.key), ['birthday'], '聯絡人含屬性');
  assert.deepEqual(contacts[0].tags.map((t) => t.tag.name), [`${MARK}-tag`], '聯絡人含標籤');
  const [conversation] = JSON.parse(files.get('json/conversations.json')!) as Tagged[];
  assert.deepEqual(conversation.tags.map((t) => t.tag.name), [`${MARK}-tag`], '對話含標籤');
  const [kase] = JSON.parse(files.get('json/cases.json')!) as Array<
    Tagged & { notes: Array<{ content: string }>; events: Array<{ eventType: string }> }
  >;
  assert.deepEqual(kase.notes.map((n) => n.content), ['備註內容'], '工單含備註');
  assert.deepEqual(kase.events.map((e) => e.eventType), ['created'], '工單含事件');
  assert.deepEqual(kase.tags.map((t) => t.tag.name), [`${MARK}-tag`], '工單含標籤');
  const manifest = JSON.parse(files.get('manifest.json')!);
  // manifest 另有留言自動私訊三類的筆數，由「匯出含留言自動私訊資料」檢查
  const { contacts: c, conversations: cv, messages: m, cases: cs } = manifest.counts;
  assert.deepEqual({ contacts: c, conversations: cv, messages: m, cases: cs }, { contacts: 1, conversations: 1, messages: 1, cases: 1 });
  assert.ok(files.has('csv/contacts.csv') && files.has('csv/messages.csv'));

  assert.equal(mocks.notify.mock.calls.length, 1);
  assert.equal(mocks.notify.mock.calls[0][0].agentId, exporter.id);
  assert.equal(mocks.notify.mock.calls[0][0].type, 'data_export_ready');
});

test('上傳失敗時記錄原因', async () => {
  mocks.upload.mockRejectedValueOnce(new Error('storage unavailable'));
  const req = await createRequest();
  await runJob(req.id);

  const stored = await owner.dataExportRequest.findUniqueOrThrow({ where: { id: req.id } });
  assert.equal(stored.status, 'failed');
  assert.equal(stored.error, 'storage unavailable');
  assert.equal(mocks.notify.mock.calls.length, 1);
  assert.equal(mocks.notify.mock.calls[0][0].type, 'data_export_failed');
});

test('發起的成員已被永久刪除時完成匯出、不送通知', async () => {
  const { requester, req } = await requestThenPurgeRequester();
  await runJob(req.id, requester.id);

  const stored = await owner.dataExportRequest.findUniqueOrThrow({ where: { id: req.id } });
  assert.equal(stored.status, 'completed', stored.error ?? '');
  assert.equal(stored.fileKey, `export/${A}/${req.id}.zip`);
  assert.equal(stored.requestedByName, requester.name);
  assert.equal(mocks.notify.mock.calls.length, 0, '沒有收件人，不送通知');
});

test('發起的成員已被永久刪除時匯出失敗、不送通知', async () => {
  const { requester, req } = await requestThenPurgeRequester();
  mocks.upload.mockRejectedValueOnce(new Error('storage unavailable'));
  await runJob(req.id, requester.id);

  const stored = await owner.dataExportRequest.findUniqueOrThrow({ where: { id: req.id } });
  assert.equal(stored.status, 'failed');
  assert.equal(stored.error, 'storage unavailable');
  assert.equal(mocks.notify.mock.calls.length, 0, '沒有收件人，不送通知');
});

test('保留期內下載', async () => {
  const req = await createRequest({
    status: 'completed',
    fileKey: `export/${A}/${MARK}.zip`,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  for (const expected of [1, 2]) {
    const res = await exporterApp.inject({ method: 'GET', url: `/api/v1/tenant/data-export/${req.id}/download` });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.url, `https://storage.example.test/export/${A}/${MARK}.zip?signed=1`);
    const stored = await owner.dataExportRequest.findUniqueOrThrow({ where: { id: req.id } });
    assert.equal(stored.downloadCount, expected, '保留期內可以重複下載，每次加 1');
  }
});

test('清理後的匯出不能下載', async () => {
  const req = await createRequest({ status: 'expired', fileKey: null, expiresAt: new Date(Date.now() - 1000) });
  const res = await exporterApp.inject({ method: 'GET', url: `/api/v1/tenant/data-export/${req.id}/download` });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'EXPORT_NOT_READY');
  assert.equal(res.json().data, undefined);
});

test('清理過期的匯出', async () => {
  const fileKey = `export/${A}/${MARK}-expired.zip`;
  const expired = await createRequest({ status: 'completed', fileKey, expiresAt: new Date(Date.now() - 1000) });
  const fresh = await createRequest({
    status: 'completed',
    fileKey: `export/${A}/${MARK}-fresh.zip`,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  await handleDataExportCleanup(owner);

  assert.ok(mocks.remove.mock.calls.some(([, key]) => key === fileKey), '刪除過期的檔案');
  const after = await owner.dataExportRequest.findUniqueOrThrow({ where: { id: expired.id } });
  assert.equal(after.status, 'expired');
  assert.equal(after.fileKey, null);
  const untouched = await owner.dataExportRequest.findUniqueOrThrow({ where: { id: fresh.id } });
  assert.equal(untouched.status, 'completed', '未過期的不受影響');
});

test('匯出含留言自動私訊資料', async () => {
  // 租戶 A：1 條規則、1 位留言者、3 筆紀錄；租戶 B 也有紀錄
  const fbA = await crFx.fbChannel(A, { pageAccessToken: `${MARK}-page-token-a` });
  const ruleA = await crFx.rule(A, fbA.id);
  const authorA = await crFx.author(A, fbA.id, contactA.id, { psid: `${MARK}-psid-a` });
  const logsA = [];
  for (let i = 0; i < 3; i++) {
    logsA.push(await crFx.log(ruleA, authorA, { sentContentSnapshot: { type: 'text', text: `${MARK}-快照原文` } }));
  }
  const fbB = await crFx.fbChannel(tenantB.id);
  const ruleB = await crFx.rule(tenantB.id, fbB.id);
  const contactB = await owner.contact.create({ data: { tenantId: tenantB.id, displayName: `${MARK}-留言者B` } });
  const authorB = await crFx.author(tenantB.id, fbB.id, contactB.id);
  const logB = await crFx.log(ruleB, authorB);

  const req = await createRequest();
  await runJob(req.id);
  const stored = await owner.dataExportRequest.findUniqueOrThrow({ where: { id: req.id } });
  assert.equal(stored.status, 'completed', stored.error ?? '');
  const files = readZip(mocks.upload.mock.calls[0][2]);
  for (const name of ['comment_reply_rules', 'comment_reply_logs', 'comment_authors']) {
    assert.ok(files.has(`json/${name}.json`) && files.has(`csv/${name}.csv`), `有 ${name} 的 JSON 與 CSV`);
  }

  const rules = JSON.parse(files.get('json/comment_reply_rules.json')!) as Array<{ id: string }>;
  const logs = JSON.parse(files.get('json/comment_reply_logs.json')!) as Array<Record<string, unknown>>;
  const authors = JSON.parse(files.get('json/comment_authors.json')!) as Array<{ id: string }>;
  assert.deepEqual(rules.map((r) => r.id), [ruleA.id]);
  assert.deepEqual(logs.map((l) => l.id).sort(), logsA.map((l) => l.id).sort());
  assert.deepEqual(authors.map((a) => a.id), [authorA.id]);
  const manifest = JSON.parse(files.get('manifest.json')!);
  assert.equal(manifest.counts.commentReplyRules, 1);
  assert.equal(manifest.counts.commentReplyLogs, 3);
  assert.equal(manifest.counts.commentAuthors, 1);

  // 只含租戶 A；不含送出內容快照的原文與渠道權杖
  const all = [...files.values()].join('\n');
  assert.ok(!all.includes(logB.id) && !all.includes(ruleB.id) && !all.includes(authorB.id), '沒有租戶 B 的資料');
  assert.ok(logs.every((l) => !('sentContentSnapshot' in l)), '紀錄不含 sentContentSnapshot');
  assert.ok(!all.includes(`${MARK}-快照原文`), '不含快照原文');
  const channel = await owner.channel.findUniqueOrThrow({ where: { id: fbA.id } });
  assert.ok(!all.includes(`${MARK}-page-token-a`) && !all.includes(channel.credentialsEncrypted), '不含渠道權杖');
  assert.ok(!all.includes('credentialsEncrypted'), '不含憑證欄位');
});
