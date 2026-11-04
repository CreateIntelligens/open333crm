/**
 * 營業時間、Partner API 金鑰、CLI 連線的設定路由，以及 CLI 登入與登出
 * （#337 階段 3 第九批 settings 搬遷前的回歸測試）。追蹤設定的讀寫見 tracking-settings-route.test.ts。
 *
 * 搬遷前後都要通過。設定路由走真實的 requirePermission 與 app_tenant 連線（RLS）；
 * CLI 登入與登出走真實的 auth.plugin 與 /auth/cli/*。
 * 每次執行建立兩個專用租戶，結束時整個刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, describe, test, vi } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import authPlugin from '#src/plugins/auth.plugin.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import authRoutes from '#src/modules/auth/auth.routes.js';
import settingsRoutes from '#src/modules/settings/settings.routes.js';
import { getOutsideHoursMessage } from '#src/modules/settings/office-hours.service.js';
import { verifyPartnerApiKey } from '#src/modules/auth/partner-api-key.service.js';
import { verifyCliSession, DEFAULT_CLI_SCOPES } from '#src/modules/auth/cli-session.service.js';
import { MCP_READ_SCOPE } from '#src/modules/mcp/mcp.constants.js';
import { hashPassword } from '#src/shared/utils/password.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';

// 建立金鑰與 token 時以 bcrypt 雜湊，CLI 登入另外比對密碼
vi.setConfig({ testTimeout: 20_000 });

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-settings-${Date.now()}`;
const MISSING = '00000000-0000-4000-8000-000000000000';
const PASSWORD = 'Correct-Pass-1';
const DAY_MS = 24 * 60 * 60 * 1000;

const tenantA = await owner.tenant.create({ data: { name: `${MARK}-a` } });
const tenantB = await owner.tenant.create({ data: { name: `${MARK}-b` } });
const A = tenantA.id;
const B = tenantB.id;
/** afterAll 要刪除的租戶；併發測試另外建立的租戶也加進來 */
const tenantIds = [A, B];

type TestAgent = { id: string; tenantId: string; roleId: string; email: string };

async function makeAgent(tenantId: string, name = 'admin', codes = ['settings.manage']): Promise<TestAgent> {
  const role = await owner.role.create({
    data: {
      tenantId,
      slug: `${MARK}-${name}`,
      name,
      permissions: { create: codes.map((permissionCode) => ({ permissionCode })) },
    },
  });
  const email = `${MARK}-${name}-${tenantId}@example.test`;
  const agent = await owner.agent.create({
    data: { tenantId, roleId: role.id, name, email, passwordHash: await hashPassword(PASSWORD) },
  });
  return { id: agent.id, tenantId, roleId: role.id, email };
}

async function buildApp(agent: TestAgent) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agent.id, tenantId: agent.tenantId, role: 'ADMIN', roleId: agent.roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, agent.tenantId);
  });
  await app.register(settingsRoutes, { prefix: '/api/v1/settings' });
  await app.ready();
  return app;
}

/** CLI 登入與登出：真實的 auth.plugin，prisma 是 app_tenant（RLS），prismaAdmin 是 BYPASSRLS */
async function buildAuthApp() {
  const app = Fastify();
  app.decorate('prisma', tenantDb as never);
  app.decorate('prismaAdmin', owner as never);
  await app.register(cookie);
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(authRoutes, { prefix: '/api/v1/auth', loginAttempts: memBindingStore() });
  await app.ready();
  return app;
}

const agentA = await makeAgent(A);
const agentA2 = await makeAgent(A, 'admin-2');
const agentB = await makeAgent(B);
const appA = await buildApp(agentA);
const appA2 = await buildApp(agentA2);
const appB = await buildApp(agentB);
const appNoPerm = await buildApp(await makeAgent(A, 'inbox-only', ['inbox.view']));
// 有 settings.manage、但成員不存在：稽核的 actorId 違反外鍵，用來讓稽核寫入失敗
const appGhost = await buildApp({ ...agentA, id: MISSING });
const authApp = await buildAuthApp();
type App = typeof appA;

afterAll(async () => {
  await Promise.all([appA.close(), appA2.close(), appB.close(), appNoPerm.close(), appGhost.close(), authApp.close()]);
  for (const tenantId of tenantIds) {
    await owner.cliSession.deleteMany({ where: { tenantId } });
    await owner.partnerApiKey.deleteMany({ where: { tenantId } });
    await owner.tenantAuditLog.deleteMany({ where: { tenantId } });
    await owner.tenantSettings.deleteMany({ where: { tenantId } });
    await owner.agent.deleteMany({ where: { tenantId } });
    await owner.role.deleteMany({ where: { tenantId } });
    await owner.tenant.delete({ where: { id: tenantId } });
  }
  await Promise.all([owner.$disconnect(), tenantDb.$disconnect()]);
});

async function call(app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });
  return { status: res.statusCode, body: res.json() as { data: any; error?: { code: string; message: string; details?: any } } };
}

const S = '/api/v1/settings';
const closedAllWeek = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
const officeHoursBody = (enabled: boolean) => ({
  timezone: 'Asia/Tokyo',
  officeHours: {
    enabled,
    schedule: { ...closedAllWeek, mon: { start: '10:00', end: '17:30' } },
    holidays: ['2026-12-25'],
    outsideHoursMessage: `${MARK} 非營業時間`,
  },
});

/** 收訊管線呼叫的函式：非營業時間的自動回覆訊息。與 inbound-side-effects.ts 相同，以管線的 client 組成 ctx */
const outsideMessage = (tenantId: string) => getOutsideHoursMessage({ tx: owner, tenantId });

describe('權限', () => {
  const routes: Array<['GET' | 'POST' | 'PUT' | 'DELETE', string, unknown?]> = [
    ['GET', `${S}/office-hours`],
    ['PUT', `${S}/office-hours`, officeHoursBody(false)],
    ['GET', `${S}/tracking`],
    ['PUT', `${S}/tracking`, { gaId: null, metaPixelId: null }],
    ['GET', `${S}/api-keys`],
    ['POST', `${S}/api-keys`, { name: 'x' }],
    ['DELETE', `${S}/api-keys/${MISSING}`],
    ['GET', `${S}/cli-sessions`],
    ['POST', `${S}/cli-sessions`, { name: 'x' }],
    ['DELETE', `${S}/cli-sessions/${MISSING}`],
  ];
  for (const [method, url, payload] of routes) {
    test(`沒有 settings.manage 時 ${method} ${url.slice(S.length)} 回 403`, async () => {
      const res = await call(appNoPerm, method, url, payload);
      assert.equal(res.status, 403);
      assert.equal(res.body.error?.details?.requiredPermission, 'settings.manage');
    });
  }

  test('沒有 settings.manage 的請求不寫入任何資料', async () => {
    assert.equal(await owner.partnerApiKey.count({ where: { tenantId: A, name: 'x' } }), 0);
    assert.equal(await owner.cliSession.count({ where: { tenantId: A, name: 'x' } }), 0);
  });
});

describe('營業時間', () => {
  test('租戶還沒有設定時，讀取回傳預設值並建立設定列', async () => {
    assert.equal(await owner.tenantSettings.count({ where: { tenantId: A } }), 0);
    const res = await call(appA, 'GET', `${S}/office-hours`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.timezone, 'Asia/Taipei');
    assert.equal(res.body.data.officeHours.enabled, false);
    assert.deepEqual(res.body.data.officeHours.schedule.mon, { start: '09:00', end: '18:00' });
    assert.equal(res.body.data.officeHours.schedule.sat, null);
    assert.equal(await owner.tenantSettings.count({ where: { tenantId: A } }), 1);
  });

  test('停用時收訊不回非營業時間訊息', async () => {
    assert.equal(await outsideMessage(A), null);
  });

  test('儲存後讀回相同的設定，並寫一筆稽核', async () => {
    const put = await call(appA, 'PUT', `${S}/office-hours`, officeHoursBody(true));
    assert.equal(put.status, 200);
    assert.equal(put.body.data.timezone, 'Asia/Tokyo');
    assert.deepEqual(put.body.data.officeHours, officeHoursBody(true).officeHours);

    const get = await call(appA, 'GET', `${S}/office-hours`);
    assert.deepEqual(get.body.data, put.body.data);

    const audits = await owner.tenantAuditLog.findMany({ where: { tenantId: A, action: 'settings.update' } });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actorId, agentA.id);
    assert.equal(audits[0].targetType, 'settings');
    assert.deepEqual(audits[0].payload, { section: 'office-hours' });
  });

  test('啟用且今天不營業時，收訊回傳設定的訊息', async () => {
    await call(appA, 'PUT', `${S}/office-hours`, {
      ...officeHoursBody(true),
      officeHours: { ...officeHoursBody(true).officeHours, schedule: closedAllWeek },
    });
    assert.equal(await outsideMessage(A), `${MARK} 非營業時間`);
  });

  test('另一個租戶讀不到這個租戶的設定', async () => {
    const res = await call(appB, 'GET', `${S}/office-hours`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.timezone, 'Asia/Taipei');
    assert.equal(res.body.data.officeHours.enabled, false);
    assert.equal(await outsideMessage(B), null);
  });
});

describe('Partner API 金鑰', () => {
  let created: { key: string; id: string };

  test('建立後回傳一次完整金鑰，資料庫只存雜湊', async () => {
    const before = Date.now();
    const res = await call(appA, 'POST', `${S}/api-keys`, { name: `${MARK}-k1`, expiresInDays: 30 });
    assert.equal(res.status, 201);
    const data = res.body.data;
    assert.match(data.key, /^pk_[0-9a-f]{64}$/);
    assert.equal(data.name, `${MARK}-k1`);
    assert.equal(data.masked, `${data.key.slice(0, 8)}…${data.key.slice(-4)}`);
    const expiresAt = new Date(data.expiresAt).getTime();
    assert.ok(expiresAt >= before + 30 * DAY_MS && expiresAt <= Date.now() + 30 * DAY_MS);

    const row = await owner.partnerApiKey.findUniqueOrThrow({ where: { id: data.id } });
    assert.equal(row.tenantId, A);
    assert.equal(row.createdById, agentA.id);
    assert.equal(row.isActive, true);
    assert.notEqual(row.keyHash, data.key);
    assert.ok(!row.keyHash.includes(data.key.slice(3)));

    const verified = await verifyPartnerApiKey(owner, data.key);
    assert.equal(verified.ok, true);
    created = { key: data.key, id: data.id };
  });

  test('沒有指定期限時永不過期', async () => {
    const res = await call(appA, 'POST', `${S}/api-keys`, { name: `${MARK}-k2` });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.expiresAt, null);
  });

  test('名稱空白回 400，不建立金鑰', async () => {
    const res = await call(appA, 'POST', `${S}/api-keys`, { name: '' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'VALIDATION_ERROR');
  });

  test('列表由新到舊，只有遮罩，不含另一個租戶的金鑰', async () => {
    await call(appB, 'POST', `${S}/api-keys`, { name: `${MARK}-kb` });
    const res = await call(appA, 'GET', `${S}/api-keys`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((k: { name: string }) => k.name), [`${MARK}-k2`, `${MARK}-k1`]);
    for (const k of res.body.data) {
      assert.deepEqual(Object.keys(k).sort(), ['createdAt', 'expiresAt', 'id', 'isActive', 'lastUsedAt', 'masked', 'name']);
    }
  });

  test('另一個租戶不能撤銷這把金鑰', async () => {
    const res = await call(appB, 'DELETE', `${S}/api-keys/${created.id}`);
    assert.equal(res.status, 404);
    assert.equal((await owner.partnerApiKey.findUniqueOrThrow({ where: { id: created.id } })).isActive, true);
  });

  test('撤銷不存在的金鑰回 404', async () => {
    const res = await call(appA, 'DELETE', `${S}/api-keys/${MISSING}`);
    assert.equal(res.status, 404);
  });

  test('撤銷後列表顯示停用，金鑰不能再使用', async () => {
    const res = await call(appA, 'DELETE', `${S}/api-keys/${created.id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { revoked: true });
    const list = await call(appA, 'GET', `${S}/api-keys`);
    assert.equal(list.body.data.find((k: { id: string }) => k.id === created.id).isActive, false);
    const verified = await verifyPartnerApiKey(owner, created.key);
    assert.equal(verified.ok, false);
  });
});

describe('CLI 連線', () => {
  let created: { token: string; id: string };

  test('建立時使用預設 scope 與 30 天期限，token 屬於建立者', async () => {
    const before = Date.now();
    const res = await call(appA, 'POST', `${S}/cli-sessions`, { name: `${MARK}-c1` });
    assert.equal(res.status, 201);
    const { token, session } = res.body.data;
    assert.match(token, /^cli_[0-9a-f]{64}$/);
    assert.deepEqual(session.scopes, [...DEFAULT_CLI_SCOPES]);
    assert.equal(session.tokenPrefix, token.slice(0, 9));
    assert.equal(session.tokenSuffix, token.slice(-4));
    const expiresAt = new Date(session.expiresAt).getTime();
    assert.ok(expiresAt >= before + 30 * DAY_MS && expiresAt <= Date.now() + 30 * DAY_MS);

    const row = await owner.cliSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(row.tenantId, A);
    assert.equal(row.agentId, agentA.id);
    assert.notEqual(row.tokenHash, token);

    const verified = await verifyCliSession(owner, token);
    assert.equal(verified.ok, true);
    created = { token, id: session.id };
  });

  test('勾選 MCP 唯讀時加上 mcp:read，並套用指定的期限', async () => {
    const before = Date.now();
    const res = await call(appA, 'POST', `${S}/cli-sessions`, { name: `${MARK}-c2`, mcpRead: true, expiresInDays: 7 });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.data.session.scopes, [...DEFAULT_CLI_SCOPES, MCP_READ_SCOPE]);
    const expiresAt = new Date(res.body.data.session.expiresAt).getTime();
    assert.ok(expiresAt >= before + 7 * DAY_MS && expiresAt <= Date.now() + 7 * DAY_MS);
  });

  test('列表列出租戶內所有成員未撤銷的 token，由新到舊，不含另一個租戶的', async () => {
    await call(appA2, 'POST', `${S}/cli-sessions`, { name: `${MARK}-c3` });
    await call(appB, 'POST', `${S}/cli-sessions`, { name: `${MARK}-cb` });
    const res = await call(appA, 'GET', `${S}/cli-sessions`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((s: { name: string }) => s.name), [`${MARK}-c3`, `${MARK}-c2`, `${MARK}-c1`]);
    const c3 = res.body.data[0];
    assert.deepEqual(c3.agent, { id: agentA2.id, name: 'admin-2', email: agentA2.email });
    assert.deepEqual(Object.keys(c3).sort(), [
      'agent', 'createdAt', 'expiresAt', 'id', 'lastUsedAt', 'name', 'scopes', 'tokenPrefix', 'tokenSuffix',
    ]);
  });

  test('另一個租戶不能撤銷這個 token', async () => {
    await call(appB, 'DELETE', `${S}/cli-sessions/${created.id}`);
    assert.equal((await owner.cliSession.findUniqueOrThrow({ where: { id: created.id } })).revokedAt, null);
  });

  test('撤銷後列表不再列出，token 不能再使用', async () => {
    const res = await call(appA, 'DELETE', `${S}/cli-sessions/${created.id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { revoked: true });
    const list = await call(appA, 'GET', `${S}/cli-sessions`);
    assert.ok(!list.body.data.some((s: { id: string }) => s.id === created.id));
    const verified = await verifyCliSession(owner, created.token);
    assert.deepEqual(verified, { ok: false, reason: 'CLI 權杖已被撤銷，請重新執行 open333 login' });
  });
});

describe('CLI 登入與登出', () => {
  let token: string;

  test('登入建立一個預設 scope 的 token', async () => {
    const res = await authApp.inject({
      method: 'POST',
      url: '/api/v1/auth/cli/login',
      payload: { email: agentB.email, password: PASSWORD, name: `${MARK}-login` },
    });
    assert.equal(res.statusCode, 200, res.body);
    const data = res.json().data;
    assert.match(data.token, /^cli_[0-9a-f]{64}$/);
    assert.deepEqual(data.session.scopes, [...DEFAULT_CLI_SCOPES]);
    assert.equal(data.agent.id, agentB.id);

    const row = await owner.cliSession.findUniqueOrThrow({ where: { id: data.session.id } });
    assert.equal(row.tenantId, B);
    assert.equal(row.agentId, agentB.id);
    assert.equal(row.name, `${MARK}-login`);
    token = data.token;
  });

  test('密碼錯誤時不建立 token', async () => {
    const before = await owner.cliSession.count({ where: { tenantId: B } });
    const res = await authApp.inject({
      method: 'POST',
      url: '/api/v1/auth/cli/login',
      payload: { email: agentB.email, password: 'wrong-password' },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(await owner.cliSession.count({ where: { tenantId: B } }), before);
  });

  test('登出撤銷目前的 token', async () => {
    const res = await authApp.inject({
      method: 'POST',
      url: '/api/v1/auth/cli/logout',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data, { loggedOut: true });
    const verified = await verifyCliSession(owner, token);
    assert.equal(verified.ok, false);
  });
});

// 主規格 tenant-audit-log「交易內的稽核與主操作一起 commit」（#337 階段 3 第九批搬遷後）
describe('稽核寫入失敗時，修改一起 rollback', () => {
  test('營業時間', async () => {
    const before = (await call(appA, 'GET', `${S}/office-hours`)).body.data;
    const res = await call(appGhost, 'PUT', `${S}/office-hours`, {
      ...officeHoursBody(false),
      timezone: 'Europe/London',
    });
    // error handler 把 Prisma 的外鍵錯誤轉成 400 DATABASE_ERROR
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error?.code, 'DATABASE_ERROR');
    assert.deepEqual((await call(appA, 'GET', `${S}/office-hours`)).body.data, before, '設定沒有寫入');
  });

  test('追蹤設定', async () => {
    await call(appA, 'PUT', `${S}/tracking`, { gaId: 'G-ROLLBACK1', metaPixelId: null });
    const res = await call(appGhost, 'PUT', `${S}/tracking`, { gaId: 'G-ROLLBACK2', metaPixelId: '12345' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error?.code, 'DATABASE_ERROR');
    assert.deepEqual((await call(appA, 'GET', `${S}/tracking`)).body.data, { gaId: 'G-ROLLBACK1', metaPixelId: null });
  });
});

// HC-SETTINGS-11：路徑的 id 不是 UUID 時，原本送到資料庫才失敗，回 400 DATABASE_ERROR
describe('撤銷時 id 不是 UUID', () => {
  test.each([`${S}/api-keys/abc`, `${S}/cli-sessions/abc`])('DELETE %s：回 400 VALIDATION_ERROR，指出 id', async (url) => {
    const res = await call(appA, 'DELETE', url);
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'VALIDATION_ERROR');
    assert.deepEqual(
      (res.body.error?.details.issues as Array<{ path: string }>).map((i) => i.path),
      ['id'],
    );
  });
});

// 同一個租戶第一次讀取設定時，GET 會建立 TenantSettings。兩個請求同時第一次讀取時，
// 原本後寫入的請求撞到 tenantId 的唯一約束，回 409 CONFLICT
describe('同時第一次讀取設定', () => {
  test('營業時間與追蹤設定的讀取都成功，只建立一列設定', async () => {
    for (let round = 0; round < 5; round++) {
      const tenant = await owner.tenant.create({ data: { name: `${MARK}-concurrent-${round}` } });
      tenantIds.push(tenant.id);
      const app = await buildApp(await makeAgent(tenant.id, `concurrent-${round}`));
      try {
        const results = await Promise.all(
          Array.from({ length: 6 }, (_, i) => call(app, 'GET', `${S}/${i % 2 === 0 ? 'office-hours' : 'tracking'}`)),
        );
        assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200, 200, 200], `第 ${round + 1} 回合：${JSON.stringify(results.map((r) => r.body.error))}`);
        assert.equal(await owner.tenantSettings.count({ where: { tenantId: tenant.id } }), 1);
      } finally {
        await app.close();
      }
    }
  });
});
