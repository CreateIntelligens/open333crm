/**
 * 營業時間的輸入檢查與已存的不合法設定（change settings-input-validation-and-credential-audit，
 * office-hours-settings「營業時間的輸入檢查」「已存的營業時間不合法時當作沒有設定」）。
 *
 * 路由走真實的 requirePermission 與 app_tenant 連線（RLS）。每次執行建立一個專用租戶，結束時整個刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import settingsRoutes from '#src/modules/settings/settings.routes.js';
import { getOutsideHoursMessage } from '#src/modules/settings/office-hours.service.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-office-hours-${Date.now()}`;

const tenant = await owner.tenant.create({ data: { name: MARK } });
const T = tenant.id;
const role = await owner.role.create({
  data: { tenantId: T, slug: MARK, name: MARK, permissions: { create: [{ permissionCode: 'settings.manage' }] } },
});
const agent = await owner.agent.create({
  data: { tenantId: T, roleId: role.id, name: 'admin', email: `${MARK}@example.test`, passwordHash: 'x' },
});

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', tenantDb);
app.decorate('prismaAdmin', owner);
app.decorate('authenticate', async (request: FastifyRequest) => {
  request.agent = { id: agent.id, tenantId: T, role: 'ADMIN', roleId: role.id } as never;
  (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, T);
});
await app.register(settingsRoutes, { prefix: '/api/v1/settings' });
await app.ready();

afterAll(async () => {
  await app.close();
  await owner.tenantAuditLog.deleteMany({ where: { tenantId: T } });
  await owner.tenantSettings.deleteMany({ where: { tenantId: T } });
  await owner.agent.deleteMany({ where: { tenantId: T } });
  await owner.role.deleteMany({ where: { tenantId: T } });
  await owner.tenant.delete({ where: { id: T } });
  await Promise.all([owner.$disconnect(), tenantDb.$disconnect()]);
});

const URL = '/api/v1/settings/office-hours';
const closed = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
const saved = {
  timezone: 'Asia/Tokyo',
  officeHours: {
    enabled: true,
    schedule: { ...closed, mon: { start: '09:00', end: '18:00' } },
    holidays: ['2026-12-25'],
    outsideHoursMessage: `${MARK} 已存的訊息`,
  },
};

async function put(payload: unknown) {
  const res = await app.inject({ method: 'PUT', url: URL, payload: payload as object });
  return { status: res.statusCode, body: res.json() };
}
async function get() {
  return (await app.inject({ method: 'GET', url: URL })).json().data;
}
const issuePaths = (body: { error?: { details?: { issues?: Array<{ path: string }> } } }) =>
  (body.error?.details?.issues ?? []).map((i) => i.path);

describe('營業時間的輸入檢查', () => {
  beforeEach(async () => {
    assert.equal((await put(saved)).status, 200);
  });

  test('合法的邊界值可以儲存', async () => {
    const input = {
      timezone: 'America/New_York',
      officeHours: {
        enabled: true,
        schedule: { ...closed, mon: { start: '00:00', end: '23:59' } },
        holidays: ['2028-02-29'],
        outsideHoursMessage: '字'.repeat(1000),
      },
    };
    const res = await put(input);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await get(), input);
  });

  test('結束時間不晚於開始時間', async () => {
    const res = await put({
      ...saved,
      officeHours: { ...saved.officeHours, schedule: { ...saved.officeHours.schedule, fri: { start: '22:00', end: '02:00' } } },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(issuePaths(res.body), ['officeHours.schedule.fri']);
    assert.deepEqual(await get(), saved, '已存的設定不變');
  });

  test('時區不合法', async () => {
    const res = await put({ ...saved, timezone: 'Mars/Base' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(issuePaths(res.body), ['timezone']);
    assert.deepEqual(await get(), saved, '已存的設定不變');
  });
});

describe('已存的營業時間不合法時當作沒有設定', () => {
  const defaults = {
    timezone: 'Asia/Taipei',
    officeHours: {
      enabled: false,
      schedule: {
        mon: { start: '09:00', end: '18:00' },
        tue: { start: '09:00', end: '18:00' },
        wed: { start: '09:00', end: '18:00' },
        thu: { start: '09:00', end: '18:00' },
        fri: { start: '09:00', end: '18:00' },
        sat: null,
        sun: null,
      },
      holidays: [],
      outsideHoursMessage: '您好！目前為非營業時間，我們將在營業時間內盡速回覆您。',
    },
  };
  /** 收訊管線呼叫的函式，與 inbound-side-effects.ts 相同，以管線的 client 組成 ctx */
  const outsideMessage = () => getOutsideHoursMessage({ tx: owner, tenantId: T });
  const stored = () => owner.tenantSettings.findUniqueOrThrow({ where: { tenantId: T }, select: { timezone: true, officeHours: true } });

  test('設定是空物件時回傳預設值', async () => {
    await owner.tenantSettings.upsert({
      where: { tenantId: T },
      create: { tenantId: T, officeHours: {} },
      update: { timezone: 'Asia/Taipei', officeHours: {} },
    });
    assert.deepEqual(await get(), defaults);
    assert.deepEqual(await stored(), { timezone: 'Asia/Taipei', officeHours: {} }, '讀取時不改寫已存的設定');
  });

  test('已存的時區不合法時不自動回覆', async () => {
    // 加上檢查之前存入的設定：啟用、每天都休息、不合法的時區
    await owner.tenantSettings.update({
      where: { tenantId: T },
      data: { timezone: 'Mars/Base', officeHours: { ...saved.officeHours, schedule: closed } },
    });
    // 原本換算時區時拋 RangeError，收訊管線接住後只記 error log
    assert.equal(await outsideMessage().catch((err: Error) => `拋出 ${err.name}`), null);
    assert.deepEqual(await get(), defaults);
    assert.equal((await stored()).timezone, 'Mars/Base', '讀取時不改寫已存的設定');
  });
});
