/**
 * 監控 cookie 的換發與驗證（change queue-monitoring：queue-monitoring「以平台 JWT 換發監控用的 cookie」，
 * platform-auth「平台路由一律驗證平台帳號」的佇列監控例外）。
 */
import assert from 'node:assert/strict';
import { afterAll, afterEach, beforeAll, beforeEach, test, vi } from 'vitest';
import {
  buildQueueMonitoringApp,
  OFFICE_IP,
  PLATFORM_USER_ID,
  QUEUES_PATH,
  type QueueMonitoringApp,
} from '../../../support/queue-monitoring-app.js';

let ctx: QueueMonitoringApp;

beforeAll(async () => {
  ctx = await buildQueueMonitoringApp({ allowedCidrs: '60.248.142.0/24', withPlatformRoutes: true });
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(() => {
  ctx.users.set(PLATFORM_USER_ID, { id: PLATFORM_USER_ID, isActive: true, mustChangePassword: false });
});
afterEach(() => {
  vi.useRealTimers();
});

function exchange(authorization?: string) {
  return ctx.inject({
    method: 'POST',
    url: `${QUEUES_PATH}/session`,
    ip: OFFICE_IP,
    headers: authorization ? { authorization } : {},
  });
}

const errorCode = (body: string) => (JSON.parse(body) as { error?: { code?: string } }).error?.code;

// ── 換發 ──

test('換發成功', async () => {
  const res = await exchange(`Bearer ${ctx.platformToken()}`);

  assert.equal(res.statusCode, 200, res.body);
  const setCookie = String([res.headers['set-cookie']].flat()[0] ?? '');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, new RegExp(`Path=${QUEUES_PATH}(;|$)`));
  const maxAge = Number(setCookie.match(/Max-Age=(\d+)/i)?.[1]);
  assert.ok(maxAge > 0 && maxAge <= 3600, `Max-Age 是 ${maxAge}`);
});

test('以租戶 JWT 換發', async () => {
  const res = await exchange(`Bearer ${ctx.tenantToken()}`);

  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['set-cookie'], undefined);
});

test('須改密碼的平台帳號換發', async () => {
  ctx.users.set(PLATFORM_USER_ID, { id: PLATFORM_USER_ID, isActive: true, mustChangePassword: true });

  const res = await exchange(`Bearer ${ctx.platformToken()}`);

  assert.equal(res.statusCode, 403);
  assert.equal(errorCode(res.body), 'MUST_CHANGE_PASSWORD');
  assert.equal(res.headers['set-cookie'], undefined);
});

// ── 驗證 cookie ──

test('佇列監控路徑沒有 cookie', async () => {
  const res = await ctx.inject({ method: 'GET', url: QUEUES_PATH, ip: OFFICE_IP });

  assert.equal(res.statusCode, 401);
  assert.equal(errorCode(res.body), 'UNAUTHORIZED');
});

test('監控 cookie 的平台帳號已停用', async () => {
  const cookie = await ctx.sessionCookie(OFFICE_IP);
  ctx.users.set(PLATFORM_USER_ID, { id: PLATFORM_USER_ID, isActive: false, mustChangePassword: false });

  const res = await ctx.inject({ method: 'GET', url: QUEUES_PATH, ip: OFFICE_IP, cookie });

  assert.equal(res.statusCode, 401);
  assert.equal(errorCode(res.body), 'PLATFORM_USER_DISABLED');
});

test('監控 cookie 的平台帳號已不存在', async () => {
  const cookie = await ctx.sessionCookie(OFFICE_IP);
  ctx.users.delete(PLATFORM_USER_ID);

  const res = await ctx.inject({ method: 'GET', url: QUEUES_PATH, ip: OFFICE_IP, cookie });

  assert.equal(res.statusCode, 401);
  assert.equal(errorCode(res.body), 'UNAUTHORIZED');
});

test('監控 cookie 的平台帳號之後被標記須改密碼', async () => {
  const cookie = await ctx.sessionCookie(OFFICE_IP);
  ctx.users.set(PLATFORM_USER_ID, { id: PLATFORM_USER_ID, isActive: true, mustChangePassword: true });

  const res = await ctx.inject({ method: 'GET', url: QUEUES_PATH, ip: OFFICE_IP, cookie });

  assert.equal(res.statusCode, 403);
  assert.equal(errorCode(res.body), 'MUST_CHANGE_PASSWORD');
});

test('平台 JWT 不能取代監控 cookie', async () => {
  const res = await ctx.inject({
    method: 'GET',
    url: QUEUES_PATH,
    ip: OFFICE_IP,
    headers: { authorization: `Bearer ${ctx.platformToken()}` },
  });

  assert.equal(res.statusCode, 401);
  assert.equal(errorCode(res.body), 'UNAUTHORIZED');
});

test('平台 JWT 放進監控 cookie 也不通過', async () => {
  const cookie = await ctx.sessionCookie(OFFICE_IP);
  const name = cookie.split('=')[0];

  const res = await ctx.inject({ method: 'GET', url: QUEUES_PATH, ip: OFFICE_IP, cookie: `${name}=${ctx.platformToken()}` });

  assert.equal(res.statusCode, 401);
});

test('監控 cookie 不能當作平台 JWT 呼叫其他平台路由', async () => {
  const cookie = await ctx.sessionCookie(OFFICE_IP);
  const value = cookie.slice(cookie.indexOf('=') + 1);

  const res = await ctx.inject({
    method: 'GET',
    url: '/api/v1/platform/plans',
    ip: OFFICE_IP,
    headers: { authorization: `Bearer ${decodeURIComponent(value)}` },
  });

  assert.equal(res.statusCode, 401);
});

test('竄改過的監控 cookie', async () => {
  const cookie = await ctx.sessionCookie(OFFICE_IP);
  const tampered = cookie.slice(0, -2) + (cookie.endsWith('AA') ? 'BB' : 'AA');

  const res = await ctx.inject({ method: 'GET', url: QUEUES_PATH, ip: OFFICE_IP, cookie: tampered });

  assert.equal(res.statusCode, 401);
});

test('過期的監控 cookie', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const cookie = await ctx.sessionCookie(OFFICE_IP);
  vi.setSystemTime(Date.now() + 3_600_000 + 1_000);

  const res = await ctx.inject({ method: 'GET', url: QUEUES_PATH, ip: OFFICE_IP, cookie });

  assert.equal(res.statusCode, 401);
});
