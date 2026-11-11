/**
 * 列表頁新增工單的渠道（S10）：
 * - 工單渠道必須是操作者看得到的渠道（CM-173 渠道可見範圍），看不到的渠道視為不存在（404）。
 * - 工單渠道必須是聯絡人所在的渠道，否則 400，不建立工單。
 * 屬於 feature 組：走真實路由、權限、渠道可見範圍與 app_tenant 連線（RLS）。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import caseRoutes from '#src/modules/case/case.routes.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const MARK = `ci-case-create-channel-${Date.now()}`;

const io = { to: () => ({ emit: () => {} }), of: () => ({ to: () => ({ emit: () => {} }) }) };

const role = await owner.role.create({
  data: {
    tenantId: A,
    slug: `${MARK}-role`,
    name: `${MARK}-role`,
    permissions: { create: ['case.view', 'case.create'].map((permissionCode) => ({ permissionCode })) },
  },
});
const agent = await owner.agent.create({
  data: { tenantId: A, roleId: role.id, email: `${MARK}-member@example.test`, name: MARK, passwordHash: 'x' },
});
const other = await owner.agent.create({
  data: { tenantId: A, roleId: role.id, email: `${MARK}-other@example.test`, name: MARK, passwordHash: 'x' },
});

const createChannel = (slug: string) =>
  owner.channel.create({
    data: { tenantId: A, channelType: 'WEBCHAT', isActive: true, displayName: `${MARK}-${slug}`, credentialsEncrypted: 'x' },
  });
const visible = await createChannel('visible');
const hidden = await createChannel('hidden');
const readOnly = await createChannel('read-only');
await owner.agentChannelAccess.create({ data: { channelId: visible.id, agentId: agent.id, accessLevel: 'full' } });
await owner.agentChannelAccess.create({ data: { channelId: readOnly.id, agentId: agent.id, accessLevel: 'read_only' } });
await owner.agentChannelAccess.create({ data: { channelId: hidden.id, agentId: other.id, accessLevel: 'full' } });

async function createContact(slug: string, channel?: { id: string }) {
  const contact = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-${slug}` } });
  if (channel) {
    await owner.channelIdentity.create({
      data: { contactId: contact.id, channelId: channel.id, channelType: 'WEBCHAT', uid: `${MARK}-${slug}` },
    });
  }
  return contact;
}
const onVisible = await createContact('on-visible', visible);
const onHidden = await createContact('on-hidden', hidden);
const onReadOnly = await createContact('on-read-only', readOnly);

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', tenantDb);
app.decorate('prismaAdmin', owner);
app.decorate('io', io as never);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: agent.id, tenantId: A, role: 'AGENT', roleId: role.id } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, A);
});
await app.register(caseRoutes, { prefix: '/api/v1/cases' });
await app.ready();

afterAll(async () => {
  await app.close();
  const channelIds = [visible.id, hidden.id, readOnly.id];
  await owner.message.deleteMany({ where: { conversation: { channelId: { in: channelIds } } } });
  await owner.conversation.deleteMany({ where: { channelId: { in: channelIds } } });
  await owner.case.deleteMany({ where: { channelId: { in: channelIds } } });
  await owner.channelIdentity.deleteMany({ where: { channelId: { in: channelIds } } });
  await owner.agentChannelAccess.deleteMany({ where: { channelId: { in: channelIds } } });
  await owner.channel.deleteMany({ where: { id: { in: channelIds } } });
  await owner.contact.deleteMany({ where: { displayName: { startsWith: MARK } } });
  await owner.agent.deleteMany({ where: { email: { startsWith: MARK } } });
  await owner.role.deleteMany({ where: { slug: { startsWith: MARK } } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

const create = (contactId: string, channelId: string) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/cases',
    payload: { contactId, channelId, title: `${MARK}-case`, category: '其他' },
  });

test('聯絡人在可見渠道：建立工單，渠道為聯絡人所在渠道', async () => {
  const res = await create(onVisible.id, visible.id);
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().data.channelId, visible.id);
});

test('指定看不到的渠道：回 404，不建立工單', async () => {
  const res = await create(onHidden.id, hidden.id);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(await owner.case.count({ where: { channelId: hidden.id } }), 0);
});

test('聯絡人不在指定的渠道：回 400，不建立工單', async () => {
  const res = await create(onHidden.id, visible.id);
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'CONTACT_NOT_ON_CHANNEL');
  assert.equal(await owner.case.count({ where: { contactId: onHidden.id } }), 0);
});

async function createConversation(contact: { id: string }, channel: { id: string }) {
  return owner.conversation.create({
    data: { tenantId: A, contactId: contact.id, channelId: channel.id, channelType: 'WEBCHAT' },
  });
}

const createFromConversation = (conversationId: string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/cases/from-conversation/${conversationId}`,
    payload: { title: `${MARK}-from-conv`, category: '其他' },
  });

test('從看得到的渠道的對話建立工單：回 201', async () => {
  const conv = await createConversation(onVisible, visible);
  const res = await createFromConversation(conv.id);
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().data.channelId, visible.id);
});

test('從看不到的渠道的對話建立工單：回 404，不建立工單', async () => {
  const conv = await createConversation(onHidden, hidden);
  const res = await createFromConversation(conv.id);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().error.message, '找不到此對話，可能已被刪除或您沒有存取權限');
  assert.equal(await owner.case.count({ where: { channelId: hidden.id } }), 0);
});

test('對話所屬渠道只有唯讀權限：回 403，不建立工單', async () => {
  const conv = await createConversation(onReadOnly, readOnly);
  const res = await createFromConversation(conv.id);
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(await owner.case.count({ where: { channelId: readOnly.id } }), 0);
});

test('對話不存在：回 404', async () => {
  const res = await createFromConversation('00000000-0000-4000-8000-00000000dead');
  assert.equal(res.statusCode, 404, res.body);
});

test('讀看不到的渠道的工單時間軸：回 404，錯誤訊息是中文', async () => {
  const hiddenCase = await owner.case.create({
    data: { tenantId: A, contactId: onHidden.id, channelId: hidden.id, title: `${MARK}-hidden-case`, category: '其他' },
  });
  const res = await app.inject({ method: 'GET', url: `/api/v1/cases/${hiddenCase.id}/events` });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().error.message, '找不到此案件，可能已被刪除或您沒有存取權限');
});
