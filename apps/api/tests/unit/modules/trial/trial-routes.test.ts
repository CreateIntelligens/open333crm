/**
 * 試用申請路由的輸入驗證（主規格 trial-application，change trial-set-password-after-verify）。
 * 服務層換成 mock，只檢查路由交給服務的內容與 Zod 驗證。
 */
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { beforeEach, test, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  request: [] as Array<Record<string, unknown>>,
  verify: [] as Array<Record<string, unknown>>,
  status: [] as string[],
}));
vi.mock('#src/modules/trial/trial.service.js', () => ({
  requestTrial: async (_prisma: unknown, input: Record<string, unknown>) => {
    calls.request.push(input);
  },
  resendTrial: async () => undefined,
  getVerifyStatus: async (_prisma: unknown, token: string) => {
    calls.status.push(token);
    return { email: 'a@example.test', siteName: '甲', status: 'pending', loginUrl: 'http://x/login' };
  },
  verifyAndProvision: async (_prisma: unknown, input: Record<string, unknown>) => {
    calls.verify.push(input);
    return { siteName: '甲', loginUrl: 'http://x/login', alreadyProvisioned: false };
  },
}));

import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import trialRoutes from '#src/modules/trial/trial.routes.js';

beforeEach(() => {
  calls.request.length = 0;
  calls.verify.length = 0;
  calls.status.length = 0;
});

async function request(method: 'GET' | 'POST', url: string, payload?: unknown) {
  const app = Fastify();
  app.decorate('prismaAdmin', {} as never);
  await app.register(errorHandlerPlugin);
  await app.register(trialRoutes, { prefix: '/api/v1/trial' });
  const res = await app.inject({ method, url: `/api/v1/trial${url}`, payload: payload as never });
  await app.close();
  return res;
}

test('申請時送出的密碼被忽略：202，服務收不到 password', async () => {
  const res = await request('POST', '/signups', { email: 'a@example.test', siteName: '甲', password: 'Old-Frontend-1' });

  assert.equal(res.statusCode, 202);
  assert.equal(calls.request.length, 1);
  assert.equal('password' in calls.request[0]!, false);
});

test('申請不需要密碼：只送 email 與站台名稱也是 202', async () => {
  const res = await request('POST', '/signups', { email: 'a@example.test', siteName: '甲' });

  assert.equal(res.statusCode, 202);
  assert.equal(calls.request.length, 1);
});

test('查詢連結：GET /verify 只查詢，不開通', async () => {
  const token = 'a'.repeat(64);
  const res = await request('GET', `/verify?token=${token}`);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.status, [token]);
  assert.equal(calls.verify.length, 0);
  assert.equal(res.json().data.status, 'pending');
});

test('密碼太短：POST /verify 回 400，服務未被呼叫', async () => {
  const res = await request('POST', '/verify', { token: 'a'.repeat(64), password: '1234567', siteName: '甲' });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  assert.equal(calls.verify.length, 0);
});

test('站台名稱超過 100 字：POST /verify 回 400', async () => {
  const res = await request('POST', '/verify', { token: 'a'.repeat(64), password: 'Password-OK-1', siteName: 'x'.repeat(101) });

  assert.equal(res.statusCode, 400);
  assert.equal(calls.verify.length, 0);
});

test('設定密碼：POST /verify 把 token、密碼、站台名稱交給服務', async () => {
  const res = await request('POST', '/verify', { token: 'a'.repeat(64), password: 'Password-OK-1', siteName: '乙' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.verify, [{ token: 'a'.repeat(64), password: 'Password-OK-1', siteName: '乙' }]);
});
