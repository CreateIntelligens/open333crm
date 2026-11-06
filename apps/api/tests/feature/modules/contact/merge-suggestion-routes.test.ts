/**
 * 身分合併建議的路由（/api/v1/identity/suggestions）。change migrate-canvas-tenant-ctx 把它們從 canvas
 * 搬到 contact 模組，搬遷前後都要通過。主規格 identity-stitching-engine「合併建議核准須在租戶邊界內執行」。
 *
 * 每次執行建立 A、B 兩個專用租戶，結束時整個刪除。路由走真實的 requirePermission 與 app_tenant 連線（RLS）。
 */
import assert from 'node:assert/strict';
import { afterAll, describe, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import mergeSuggestionRoutes from '#src/modules/contact/merge-suggestion.routes.js';
import { createFlowLog, recordingIo } from '../../../support/flow-harness.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-merge-suggestion-${Date.now()}`;
const A = (await owner.tenant.create({ data: { name: `${MARK}-a` } })).id;
const B = (await owner.tenant.create({ data: { name: `${MARK}-b` } })).id;
const log = createFlowLog();

const role = await owner.role.create({
  data: { tenantId: A, slug: MARK, name: MARK, permissions: { create: [{ permissionCode: 'identity.review' }] } },
});
const agent = await owner.agent.create({
  data: { tenantId: A, roleId: role.id, name: MARK, email: `${MARK}@example.test`, passwordHash: 'x' },
});

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', tenantDb);
app.decorate('prismaAdmin', owner);
app.decorate('io', recordingIo(log));
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: agent.id, tenantId: A, role: 'ADMIN', roleId: role.id } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, A);
});
await app.register(mergeSuggestionRoutes, { prefix: '/api/v1/identity' });
await app.ready();

afterAll(async () => {
  await app.close();
  for (const tenantId of [A, B]) {
    await owner.mergeSuggestion.deleteMany({ where: { tenantId } });
    await owner.contactMergeLog.deleteMany({ where: { tenantId } });
    await owner.contact.deleteMany({ where: { tenantId } });
    await owner.agent.deleteMany({ where: { tenantId } });
    await owner.role.deleteMany({ where: { tenantId } });
    await owner.tenant.delete({ where: { id: tenantId } });
  }
  await Promise.all([owner.$disconnect(), tenantDb.$disconnect()]);
});

let n = 0;
async function suggestion(tenantId: string, status: 'PENDING' | 'REJECTED' = 'PENDING') {
  n += 1;
  const primary = await owner.contact.create({ data: { tenantId, displayName: `${MARK}-p${n}` } });
  const secondary = await owner.contact.create({ data: { tenantId, displayName: `${MARK}-s${n}` } });
  const row = await owner.mergeSuggestion.create({
    data: { tenantId, primaryContactId: primary.id, secondaryContactId: secondary.id, reason: MARK, confidence: 0.9, status },
  });
  return { ...row, primary, secondary };
}

async function call(method: 'GET' | 'POST', url: string) {
  const res = await app.inject({ method, url });
  return { status: res.statusCode, body: res.json() as { data: any; error?: { code: string; message: string } } };
}

const base = '/api/v1/identity/suggestions';

describe('合併建議的路由', () => {
  test('列出本租戶的待處理建議', async () => {
    const pendingA = await suggestion(A);
    await suggestion(A, 'REJECTED');
    await suggestion(B);

    const res = await call('GET', `${base}?limit=100`);
    assert.equal(res.status, 200);
    assert.deepEqual((res.body.data as Array<{ id: string }>).map((s) => s.id), [pendingA.id]);
  });

  test('核准後兩位聯絡人合併，並推播 contact.merged', async () => {
    const s = await suggestion(A);
    log.pushes.length = 0;

    const res = await call('POST', `${base}/${s.id}/approve`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.merged, true);

    const after = await owner.mergeSuggestion.findUniqueOrThrow({ where: { id: s.id } });
    assert.equal(after.status, 'APPROVED');
    const merged = await owner.contact.findUniqueOrThrow({ where: { id: s.secondary.id } });
    assert.equal(merged.isArchived, true);
    assert.deepEqual(log.pushes, [
      {
        room: `tenant:${A}`,
        event: 'contact.merged',
        data: {
          primaryContactId: s.primary.id,
          secondaryContactId: s.secondary.id,
          primaryName: s.primary.displayName,
          secondaryName: s.secondary.displayName,
        },
      },
    ]);
  });

  test('駁回後建議是 REJECTED', async () => {
    const s = await suggestion(A);
    const res = await call('POST', `${base}/${s.id}/reject`);
    assert.equal(res.status, 200);
    const after = await owner.mergeSuggestion.findUniqueOrThrow({ where: { id: s.id } });
    assert.equal(after.status, 'REJECTED');
  });

  test('核准他租戶的建議', async () => {
    const s = await suggestion(B);
    log.pushes.length = 0;

    const res = await call('POST', `${base}/${s.id}/approve`);
    assert.equal(res.status, 404);
    // 斷言建議檢查自己的訊息：合併引擎找不到聯絡人也回 404，只看狀態碼分不出是哪一層擋下
    assert.equal(res.body.error?.message, '找不到此合併建議');

    const after = await owner.mergeSuggestion.findUniqueOrThrow({ where: { id: s.id } });
    assert.equal(after.status, 'PENDING');
    const secondary = await owner.contact.findUniqueOrThrow({ where: { id: s.secondary.id } });
    assert.equal(secondary.isArchived, false);
    assert.deepEqual(log.pushes, []);
  });

  test('已處理的建議回 409', async () => {
    const s = await suggestion(A, 'REJECTED');
    for (const action of ['approve', 'reject']) {
      const res = await call('POST', `${base}/${s.id}/${action}`);
      assert.equal(res.status, 409, action);
      assert.equal(res.body.error?.code, 'CONFLICT', action);
    }
  });
});
