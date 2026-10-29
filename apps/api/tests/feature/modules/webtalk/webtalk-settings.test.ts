/**
 * WebTalk 租戶設定與房間代號（change webtalk-multi-tenant，spec webtalk-collaboration）。
 * 以真實資料庫驗證：migration 的預設值、租戶設定只影響自己租戶（app_tenant 連線，RLS 生效）、
 * 重新產生房間代號。認證以注入的成員取代，權限由真實的 requirePermission 依角色計算。
 * 結束時還原兩個租戶原本的 WebTalk 設定。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient, withTenant } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import webtalkRoutes from '#src/modules/webtalk/webtalk.routes.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantClient = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT! } } });
const stamp = Date.now();

async function makeAgent(tenantId: string, permissions: string[]) {
  const role = await owner.role.create({
    data: {
      tenantId,
      slug: `ci-webtalk-${stamp}-${permissions.length}-${tenantId.slice(0, 1)}`,
      name: 'CI WebTalk',
      permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
    },
  });
  const agent = await owner.agent.create({
    data: { tenantId, email: `ci-webtalk-${stamp}-${role.id}@example.test`, name: 'CI WebTalk', passwordHash: 'x', roleId: role.id },
  });
  return { tenantId, roleId: role.id, agentId: agent.id };
}

const adminA = await makeAgent(TENANT_A, ['settings.manage']);
const memberA = await makeAgent(TENANT_A, []);
const memberB = await makeAgent(TENANT_B, []);
// 有 settings.manage、但成員不存在：稽核的 actorId 違反外鍵，用來模擬稽核寫入失敗
const ghostAdminA = { tenantId: TENANT_A, roleId: adminA.roleId, agentId: randomUUID() };
const actors = [adminA, memberA, memberB, ghostAdminA];

const settingsSelect = { webtalkEnabled: true, webtalkAiEnabled: true, webtalkRoomVersion: true } as const;
const originals = new Map(
  await Promise.all(
    [TENANT_A, TENANT_B].map(async (t) => [
      t,
      await withTenant(owner, t, (tx) => tx.tenantSettings.findFirst({ where: { tenantId: t }, select: settingsSelect })),
    ] as const),
  ),
);

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', tenantClient);
app.decorate('prismaAdmin', owner);
app.decorate('authenticate', async (request: FastifyRequest) => {
  const actor = actors.find((a) => a.agentId === request.headers['x-test-agent'])!;
  request.agent = { id: actor.agentId, tenantId: actor.tenantId, role: 'AGENT', roleId: actor.roleId } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantClient, actor.tenantId);
});
await app.register(webtalkRoutes, {
  prefix: '/api/v1/webtalk',
  resolveConfig: () => ({
    roomSecret: 'feature-test-webtalk-room-secret-0123456789',
    siteId: 'open333crm-feature',
    sdkUrl: 'https://sdk.example.test/webtalk.js',
    sdkIntegrity: null,
    aiEndpoint: null,
  }),
});
await app.ready();

const call = (actor: { agentId: string }, method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1/webtalk${url}`, headers: { 'x-test-agent': actor.agentId }, payload });

/** 把 WebTalk 欄位重設為 migration 預設值（列不存在時不建立） */
const resetWebTalk = (t: string) =>
  withTenant(owner, t, (tx) =>
    tx.tenantSettings.updateMany({ where: { tenantId: t }, data: { webtalkEnabled: true, webtalkAiEnabled: false, webtalkRoomVersion: 0 } }),
  );

beforeEach(async () => {
  await resetWebTalk(TENANT_A);
  await resetWebTalk(TENANT_B);
});

afterAll(async () => {
  await app.close();
  for (const [t, original] of originals) {
    await withTenant(owner, t, (tx) =>
      original
        ? tx.tenantSettings.updateMany({ where: { tenantId: t }, data: original })
        : tx.tenantSettings.updateMany({ where: { tenantId: t }, data: { webtalkEnabled: true, webtalkAiEnabled: false, webtalkRoomVersion: 0 } }),
    );
  }
  const agentIds = actors.map((a) => a.agentId);
  await owner.tenantAuditLog.deleteMany({ where: { actorId: { in: agentIds } } }).catch(() => {});
  await owner.agent.deleteMany({ where: { id: { in: agentIds } } });
  await owner.role.deleteMany({ where: { id: { in: actors.map((a) => a.roleId) } } });
  await owner.$disconnect();
  await tenantClient.$disconnect();
});

test('migration 預設值：WebTalk 開啟、AI 摘要關閉', async () => {
  const res = await call(adminA, 'GET', '/settings');
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().data, { enabled: true, aiEnabled: false });
});

test('Different tenants never share a room（真實資料庫）', async () => {
  const a = (await call(memberA, 'GET', '/session')).json().data;
  const b = (await call(memberB, 'GET', '/session')).json().data;
  assert.equal(a.enabled, true, JSON.stringify(a));
  assert.equal(b.enabled, true, JSON.stringify(b));
  assert.notEqual(a.roomId, b.roomId);
  assert.equal(a.roomId, (await call(adminA, 'GET', '/session')).json().data.roomId, '同租戶同房');
});

test('Tenant disables WebTalk（RLS 連線，只影響自己租戶）', async () => {
  const res = await call(adminA, 'PUT', '/settings', { enabled: false });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual((await call(memberA, 'GET', '/session')).json().data, { enabled: false, reason: 'TENANT_DISABLED' });
  assert.equal((await call(memberB, 'GET', '/session')).json().data.enabled, true, '其他租戶不受影響');
  const audit = await owner.tenantAuditLog.findFirst({ where: { actorId: adminA.agentId }, orderBy: { createdAt: 'desc' } });
  assert.deepEqual(audit?.payload, { section: 'webtalk', enabled: false, aiEnabled: false });
});

test('Settings change requires permission（真實權限計算）', async () => {
  const res = await call(memberA, 'PUT', '/settings', { enabled: false });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.details.requiredPermission, 'settings.manage');
  assert.equal((await call(memberA, 'GET', '/session')).json().data.enabled, true);
});

test('Rotation changes the room ID（真實資料庫）', async () => {
  const beforeA = (await call(memberA, 'GET', '/session')).json().data.roomId;
  const beforeB = (await call(memberB, 'GET', '/session')).json().data.roomId;
  const res = await call(adminA, 'POST', '/settings/rotate-room');
  assert.equal(res.statusCode, 200, res.body);
  assert.notEqual((await call(memberA, 'GET', '/session')).json().data.roomId, beforeA);
  assert.equal((await call(memberB, 'GET', '/session')).json().data.roomId, beforeB);
});

// 主規格 tenant-audit-log「交易內的稽核與主操作一起 commit」（#337 階段 3）
test('稽核寫入失敗時，設定的修改一起 rollback', async () => {
  const res = await call(ghostAdminA, 'PUT', '/settings', { enabled: false });
  // error handler 把 Prisma 的外鍵錯誤轉成 400 DATABASE_ERROR
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'DATABASE_ERROR');
  assert.equal((await call(memberA, 'GET', '/session')).json().data.enabled, true, '設定沒有寫入');
});

test('稽核寫入失敗時，房間版本不變', async () => {
  const before = (await call(memberA, 'GET', '/session')).json().data.roomId;
  const res = await call(ghostAdminA, 'POST', '/settings/rotate-room');
  // error handler 把 Prisma 的外鍵錯誤轉成 400 DATABASE_ERROR
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'DATABASE_ERROR');
  assert.equal((await call(memberA, 'GET', '/session')).json().data.roomId, before, '房間版本沒有加一');
});
