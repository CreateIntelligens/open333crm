/**
 * 主規格 channel-team-access 的「Channel Multi-Team Authorization」
 * （change restore-channel-scoped-visibility-spec）。
 *
 * 路由層整合測試：走真實的 requirePermission 與 app_tenant 連線（RLS）。
 * 測試名稱以「情境名稱：說明」開頭。
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import channelRoutes from '#src/modules/channel/channel.routes.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const B = process.env.RLS_TEST_TENANT_B ?? 'b0000000-0000-0000-0000-000000000002';
const MARK = `ci-team-access-${Date.now()}`;

async function createRole(slug: string, permissions: string[]) {
  return owner.role.create({
    data: {
      tenantId: A,
      slug: `${MARK}-${slug}`,
      name: `${MARK}-${slug}`,
      permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
    },
  });
}

async function buildApp(agentId: string, roleId: string) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', owner);
  app.decorate('prismaAdmin', owner);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agentId, tenantId: A, role: 'AGENT', roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, A);
  });
  await app.register(channelRoutes, { prefix: '/api/v1/channels' });
  await app.ready();
  return app;
}

// ── fixture ──
const assigner = await createRole('assigner', ['channel.assign_team']);
const plain = await createRole('plain', ['channel.view']);
const admin = await owner.agent.create({
  data: { tenantId: A, roleId: assigner.id, email: `${MARK}-admin@example.test`, name: MARK, passwordHash: 'x' },
});
const member = await owner.agent.create({
  data: { tenantId: A, roleId: plain.id, email: `${MARK}-member@example.test`, name: MARK, passwordHash: 'x' },
});
const channel = await owner.channel.create({
  data: { tenantId: A, channelType: 'WEBCHAT', displayName: `${MARK}-channel`, credentialsEncrypted: 'x' },
});
const team = await owner.team.create({ data: { tenantId: A, name: `${MARK}-team` } });
const foreignTeam = await owner.team.create({ data: { tenantId: B, name: `${MARK}-foreign-team` } });
const foreignChannel = await owner.channel.create({
  data: { tenantId: B, channelType: 'WEBCHAT', displayName: `${MARK}-foreign-channel`, credentialsEncrypted: 'x' },
});

const adminApp = await buildApp(admin.id, assigner.id);
const memberApp = await buildApp(member.id, plain.id);

const grants = (channelId: string) => owner.channelTeamAccess.findMany({ where: { channelId } });
const grant = (app: typeof adminApp, accessLevel: string, teamId = team.id, channelId = channel.id) =>
  app.inject({ method: 'POST', url: `/api/v1/channels/${channelId}/teams`, payload: { teamId, accessLevel } });

beforeEach(async () => {
  await owner.channelTeamAccess.deleteMany({ where: { channelId: { in: [channel.id, foreignChannel.id] } } });
});

afterAll(async () => {
  await adminApp.close();
  await memberApp.close();
  await owner.tenantAuditLog.deleteMany({ where: { targetId: { in: [channel.id, foreignChannel.id] } } });
  await owner.channel.deleteMany({ where: { displayName: { startsWith: MARK } } });
  await owner.team.deleteMany({ where: { name: { startsWith: MARK } } });
  await owner.agent.deleteMany({ where: { email: { startsWith: MARK } } });
  await owner.role.deleteMany({ where: { slug: { startsWith: MARK } } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

test('Grant Channel to Team：建立授權並帶指定的層級，回 201', async () => {
  const res = await grant(adminApp, 'reply_only');
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual(
    (await grants(channel.id)).map((g) => [g.teamId, g.accessLevel]),
    [[team.id, 'reply_only']],
  );
});

test('Channel Already Granted：再授權一次會更新層級，不會多一筆', async () => {
  await grant(adminApp, 'read_only');
  const res = await grant(adminApp, 'full');
  assert.ok(res.statusCode < 300, res.body);
  assert.deepEqual(
    (await grants(channel.id)).map((g) => [g.teamId, g.accessLevel]),
    [[team.id, 'full']],
  );
});

test('Revoke Channel Access：撤銷授權，回 204', async () => {
  await grant(adminApp, 'full');
  const res = await adminApp.inject({ method: 'DELETE', url: `/api/v1/channels/${channel.id}/teams/${team.id}` });
  assert.equal(res.statusCode, 204, res.body);
  assert.deepEqual(await grants(channel.id), []);
});

test('List Teams for Channel：列出有授權的團隊與層級', async () => {
  await grant(adminApp, 'reply_only');
  const res = await adminApp.inject({ method: 'GET', url: `/api/v1/channels/${channel.id}/teams` });
  assert.equal(res.statusCode, 200, res.body);
  const rows = res.json().data as Array<{ teamId: string; accessLevel: string }>;
  assert.deepEqual(rows.map((r) => [r.teamId, r.accessLevel]), [[team.id, 'reply_only']]);
});

test('List Channels for Team：列出團隊被授權的渠道與層級', async () => {
  await grant(adminApp, 'read_only');
  const res = await adminApp.inject({ method: 'GET', url: `/api/v1/channels/teams/${team.id}/channels` });
  assert.equal(res.statusCode, 200, res.body);
  const rows = res.json().data as Array<{ channelId: string; accessLevel: string }>;
  assert.deepEqual(rows.map((r) => [r.channelId, r.accessLevel]), [[channel.id, 'read_only']]);
});

test('Team of another tenant：團隊或渠道屬於其他租戶時回 404，不建立授權', async () => {
  const foreignTeamRes = await grant(adminApp, 'full', foreignTeam.id);
  assert.equal(foreignTeamRes.statusCode, 404, foreignTeamRes.body);
  const foreignChannelRes = await grant(adminApp, 'full', team.id, foreignChannel.id);
  assert.equal(foreignChannelRes.statusCode, 404, foreignChannelRes.body);
  assert.deepEqual(await grants(channel.id), []);
  assert.deepEqual(await grants(foreignChannel.id), []);
});

test('Revoke a grant that does not exist：沒有授權的團隊，撤銷回 404', async () => {
  const res = await adminApp.inject({ method: 'DELETE', url: `/api/v1/channels/${channel.id}/teams/${team.id}` });
  assert.equal(res.statusCode, 404, res.body);
});

test('Missing permission：沒有 channel.assign_team 時各端點都回 403，授權不變', async () => {
  await grant(adminApp, 'reply_only');
  const calls = [
    grant(memberApp, 'full'),
    memberApp.inject({ method: 'DELETE', url: `/api/v1/channels/${channel.id}/teams/${team.id}` }),
    memberApp.inject({ method: 'GET', url: `/api/v1/channels/${channel.id}/teams` }),
    memberApp.inject({ method: 'GET', url: `/api/v1/channels/teams/${team.id}/channels` }),
  ];
  for (const res of await Promise.all(calls)) assert.equal(res.statusCode, 403, res.body);
  assert.deepEqual(
    (await grants(channel.id)).map((g) => [g.teamId, g.accessLevel]),
    [[team.id, 'reply_only']],
  );
});
