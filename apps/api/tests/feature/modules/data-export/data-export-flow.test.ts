/**
 * 主規格 tenant-data-export 的路由與 worker 情境（change restore-tenant-audit-gdpr-specs）：
 * 沒有 data.export 不能發起、匯出只含本租戶的資料、上傳失敗時記錄原因、保留期內下載、清理過期的匯出。
 *
 * 路由走真實的 requirePermission 與 app_tenant 連線（RLS）；worker 直接呼叫
 * apps/workers 的 handler，資料庫是真的。物件儲存、下載連結與通知佇列以 mock 取代。
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
const { handleDataExportJob, handleDataExportCleanup } = await import(
  '../../../../../workers/src/handlers/data-export.handler.js'
);

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-export-flow-${Date.now()}`;

const tenantA = await owner.tenant.create({ data: { name: `${MARK}-a` } });
const tenantB = await owner.tenant.create({ data: { name: `${MARK}-b` } });
const A = tenantA.id;

const exporterRole = await owner.role.create({
  data: { tenantId: A, slug: `${MARK}-exporter`, name: 'exporter', permissions: { create: [{ permissionCode: 'data.export' }] } },
});
const plainRole = await owner.role.create({
  data: { tenantId: A, slug: `${MARK}-plain`, name: 'plain', permissions: { create: [{ permissionCode: 'contact.view' }] } },
});
const exporter = await owner.agent.create({
  data: { tenantId: A, roleId: exporterRole.id, email: `${MARK}-exporter@example.test`, name: '匯出者', passwordHash: 'x' },
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

async function buildApp(agent: { id: string; roleId: string }) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agent.id, tenantId: A, role: 'AGENT', roleId: agent.roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, A);
  });
  await app.register(dataExportRoutes, { prefix: '/api/v1/tenant/data-export' });
  await app.ready();
  return app;
}

const exporterApp = await buildApp({ id: exporter.id, roleId: exporterRole.id });
const plainApp = await buildApp({ id: plain.id, roleId: plainRole.id });

/** 建一筆匯出請求，模擬 POST 之後、worker 處理之前的狀態 */
const createRequest = (data: Record<string, unknown> = {}) =>
  owner.dataExportRequest.create({ data: { tenantId: A, requestedBy: exporter.id, status: 'pending', ...data } });
const runJob = (requestId: string) =>
  handleDataExportJob({ data: { requestId, tenantId: A, requestedBy: exporter.id } } as never, owner, {} as never);

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

beforeEach(() => {
  mocks.upload.mockReset().mockResolvedValue(undefined);
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.notify.mockReset().mockResolvedValue(undefined);
});

afterAll(async () => {
  await Promise.all([exporterApp.close(), plainApp.close()]);
  for (const tenantId of [A, tenantB.id]) {
    await owner.tenantAuditLog.deleteMany({ where: { tenantId } });
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

test('沒有 data.export 不能發起', async () => {
  const res = await plainApp.inject({ method: 'POST', url: '/api/v1/tenant/data-export', payload: {} });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.details.requiredPermission, 'data.export');
  assert.equal(await owner.dataExportRequest.count({ where: { tenantId: A } }), 0);
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
  assert.deepEqual(manifest.counts, { contacts: 1, conversations: 1, messages: 1, cases: 1 });
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
