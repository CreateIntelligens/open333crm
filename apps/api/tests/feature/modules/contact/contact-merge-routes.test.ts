/**
 * 客服手動合併與解除合併的路由（#337 階段 3）：回應、資料、稽核紀錄與推播。
 * - 合併成功：被合併方封存，寫 contact.merge 稽核，推播 contact.merged。
 * - 合併失敗：不推播，不寫稽核。
 * - 解除合併：被合併方還原，寫 contact.merge_revert 稽核，推播 contact.merge_reverted。
 * 屬於 feature 組：走真實路由、權限與 app_tenant 連線（RLS）。本檔建立的資料以 MARK 標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import contactRoutes from '#src/modules/contact/contact.routes.js';
import { createFlowLog, recordingIo } from '../../../support/flow-harness.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const MARK = `ci-contact-merge-routes-${Date.now()}`;

const role = await owner.role.create({
  data: {
    tenantId: T,
    slug: `${MARK}-role`,
    name: `${MARK}-role`,
    permissions: { create: ['contact.view', 'contact.merge'].map((permissionCode) => ({ permissionCode })) },
  },
});
const agent = await owner.agent.create({
  data: { tenantId: T, roleId: role.id, email: `${MARK}@example.test`, name: MARK, passwordHash: 'x' },
});
const channel = await owner.channel.create({
  data: { tenantId: T, channelType: 'LINE', displayName: `${MARK}-line`, credentialsEncrypted: 'x', isActive: true },
});

let log = createFlowLog();
const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', tenantDb);
app.decorate('prismaAdmin', owner);
app.decorate('io', {
  to: (room: string) => ({ emit: (event: string, data: unknown) => recordingIo(log).to(room).emit(event, data) }),
} as never);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: agent.id, tenantId: T, role: 'AGENT', roleId: role.id } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, T);
});
await app.register(contactRoutes, { prefix: '/api/v1/contacts' });
await app.ready();

beforeEach(() => {
  log = createFlowLog();
});

afterAll(async () => {
  await app.close();
  const contacts = (await owner.contact.findMany({ where: { tenantId: T, displayName: { startsWith: MARK } }, select: { id: true } })).map((c) => c.id);
  await owner.tenantAuditLog.deleteMany({ where: { actorId: agent.id } });
  await owner.contactMergeLog.deleteMany({ where: { tenantId: T, OR: [{ survivorId: { in: contacts } }, { mergedId: { in: contacts } }] } });
  await owner.channelIdentity.deleteMany({ where: { contactId: { in: contacts } } });
  await owner.contact.deleteMany({ where: { id: { in: contacts } } });
  await owner.channel.deleteMany({ where: { id: channel.id } });
  await owner.agent.deleteMany({ where: { id: agent.id } });
  await owner.role.deleteMany({ where: { id: role.id } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

async function contact(name: string, withLineIdentity = false) {
  return owner.contact.create({
    data: {
      tenantId: T,
      displayName: `${MARK}-${name}`,
      ...(withLineIdentity
        ? { channelIdentities: { create: { channelId: channel.id, channelType: 'LINE', uid: `${MARK}-${name}` } } }
        : {}),
    },
  });
}

const audits = (action: string) =>
  owner.tenantAuditLog.findMany({ where: { tenantId: T, actorId: agent.id, action }, orderBy: { createdAt: 'asc' } });

test('合併成功：被合併方封存，寫 contact.merge 稽核，推播 contact.merged', async () => {
  const primary = await contact('P1');
  const secondary = await contact('S1');

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts/merge',
    payload: { primaryContactId: primary.id, secondaryContactId: secondary.id },
  });

  assert.equal(res.statusCode, 200);
  const data = res.json().data;
  assert.equal(data.primaryContactId, primary.id);
  assert.equal(data.secondaryContactId, secondary.id);
  assert.equal(data.primaryName, primary.displayName);
  assert.equal(data.secondaryName, secondary.displayName);
  assert.ok(data.mergeLogId);

  const after = await owner.contact.findUnique({ where: { id: secondary.id } });
  assert.equal(after?.isArchived, true);
  assert.equal(after?.mergedIntoId, primary.id);

  const rows = (await audits('contact.merge')).filter((a) => a.targetId === primary.id);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].payload, { primaryContactId: primary.id, secondaryContactId: secondary.id });

  assert.deepEqual(log.pushes, [
    {
      room: `tenant:${T}`,
      event: 'contact.merged',
      data: {
        primaryContactId: primary.id,
        secondaryContactId: secondary.id,
        primaryName: primary.displayName,
        secondaryName: secondary.displayName,
      },
    },
  ]);
});

test('合併失敗（兩位聯絡人在同一個渠道都有身分）：回 409，不推播，不寫稽核', async () => {
  const primary = await contact('P2', true);
  const secondary = await contact('S2', true);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts/merge',
    payload: { primaryContactId: primary.id, secondaryContactId: secondary.id },
  });

  assert.equal(res.statusCode, 409);
  assert.deepEqual(log.pushes, []);
  assert.equal((await audits('contact.merge')).filter((a) => a.targetId === primary.id).length, 0);
});

test('解除合併：被合併方還原，寫 contact.merge_revert 稽核，推播 contact.merge_reverted；合併紀錄列出這筆', async () => {
  const primary = await contact('P3');
  const secondary = await contact('S3');
  const merged = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts/merge',
    payload: { primaryContactId: primary.id, secondaryContactId: secondary.id },
  });
  const { mergeLogId } = merged.json().data;

  const logs = await app.inject({ method: 'GET', url: `/api/v1/contacts/${primary.id}/merge-logs` });
  assert.equal(logs.statusCode, 200);
  assert.deepEqual(
    (logs.json().data as Array<{ id: string }>).map((l) => l.id),
    [mergeLogId],
  );

  log = createFlowLog();
  const res = await app.inject({ method: 'POST', url: `/api/v1/contacts/merge-logs/${mergeLogId}/revert` });

  assert.equal(res.statusCode, 200);
  const restored = await owner.contact.findUnique({ where: { id: secondary.id } });
  assert.equal(restored?.isArchived, false);
  assert.equal(restored?.mergedIntoId, null);

  const rows = (await audits('contact.merge_revert')).filter((a) => a.targetId === secondary.id);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].payload, { mergeLogId, survivorId: primary.id, source: 'MANUAL' });

  assert.deepEqual(log.pushes, [
    {
      room: `tenant:${T}`,
      event: 'contact.merge_reverted',
      data: { mergeLogId, survivorId: primary.id, restoredContactId: secondary.id },
    },
  ]);
});

test('解除已解除過的合併：回 409，不推播，不寫稽核', async () => {
  const primary = await contact('P4');
  const secondary = await contact('S4');
  const merged = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts/merge',
    payload: { primaryContactId: primary.id, secondaryContactId: secondary.id },
  });
  const { mergeLogId } = merged.json().data;
  await app.inject({ method: 'POST', url: `/api/v1/contacts/merge-logs/${mergeLogId}/revert` });

  log = createFlowLog();
  const res = await app.inject({ method: 'POST', url: `/api/v1/contacts/merge-logs/${mergeLogId}/revert` });

  assert.equal(res.statusCode, 409);
  assert.deepEqual(log.pushes, []);
  assert.equal((await audits('contact.merge_revert')).filter((a) => a.targetId === secondary.id).length, 1);
});
