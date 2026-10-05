/**
 * 建立規則的啟用狀態要從 HTTP 一路傳到資料庫（PR #225 審查）。
 * 原本的 bug 出在路由層：createRuleSchema 沒有 isActive，Zod 解析時就把它丟掉了，
 * 只測 createRule() 抓不到這種錯。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, test } from 'vitest';
import automationRoutes from '#src/modules/automation/automation.routes.js';

let app: FastifyInstance;
const created: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  app = Fastify();
  const prisma = {
    automationRule: {
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return { id: 'r1', ...args.data };
      },
    },
  };
  // 已登入的請求：CLI session 身分讓 requirePermission 放行，只測 schema 與路由的傳遞
  app.decorate('authenticate', async (request: never) => {
    const req = request as { agent?: unknown; tenantPrisma?: unknown };
    req.agent = { id: 'a1', tenantId: 'tenant-1', isCliSession: true };
    req.tenantPrisma = prisma;
  });
  app.decorateRequest('agent', null);
  app.decorateRequest('tenantPrisma', null);
  await app.register(automationRoutes, { prefix: '/api/v1/automation' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const body = (extra: Record<string, unknown>) => ({
  name: '新規則',
  trigger: { type: 'message.received' },
  conditions: { all: [] },
  actions: [{ type: 'add_tag', params: { tagName: 'VIP' } }],
  ...extra,
});

test('Create an inactive rule：POST isActive false 存成停用', async () => {
  created.length = 0;
  const res = await app.inject({ method: 'POST', url: '/api/v1/automation/rules', payload: body({ isActive: false }) });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(created[0]!.isActive, false);
  assert.equal(res.json().data.isActive, false);
});

test('Client that does not send the active state：POST 沒帶 isActive 存成啟用', async () => {
  created.length = 0;
  const res = await app.inject({ method: 'POST', url: '/api/v1/automation/rules', payload: body({}) });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(created[0]!.isActive, true);
});
