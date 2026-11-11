/**
 * 自動化規則動作參數的型別（change validate-bot-config-and-action-params，automation-contract-composer
 * 「Contract Compatibility Validation」；issue #405）。
 *
 * 路由的 params 是 z.record(z.unknown())，型別由契約驗證檢查。這裡走 HTTP → 路由 → flow → service，
 * 確認壞值回 400 且不寫入，規則編輯器送出的完整內容照常建立。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import automationRoutes from '#src/modules/automation/automation.routes.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import { MOCK_TENANT_ID } from '#tests/support/mock-tenant-ctx.js';

let app: FastifyInstance;
const created: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  app = Fastify();
  const tx = {
    $executeRaw: async () => 0,
    automationRule: {
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return { id: 'r1', ...args.data };
      },
    },
  };
  app.decorate('prisma', { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as never);
  // CLI session 身分讓 requirePermission 放行，只測驗證與傳遞
  app.decorate('authenticate', async (request: never) => {
    const req = request as { agent?: unknown };
    req.agent = { id: 'a1', tenantId: MOCK_TENANT_ID, isCliSession: true };
  });
  app.decorateRequest('agent', null);
  await app.register(errorHandlerPlugin);
  await app.register(automationRoutes, { prefix: '/api/v1/automation' });
  await app.ready();
});

beforeEach(() => {
  created.length = 0;
});

afterAll(async () => {
  await app.close();
});

const rule = (actions: unknown[]) => ({
  name: '新規則',
  trigger: { type: 'message.received' },
  conditions: { all: [] },
  actions,
});

test('Text parameter that is not a string rejected：訊息內容是物件回 400，不寫入', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/automation/rules',
    payload: rule([{ type: 'send_message', params: { text: { a: 1 } } }]),
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.match(res.json().error.message, /「傳送訊息」的「訊息內容」必須是文字/);
  assert.equal(created.length, 0);
});

test('Text parameter that is not a string rejected：標籤名稱是數字回 400，不寫入', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/automation/rules',
    payload: rule([{ type: 'add_tag', params: { tagName: 123 } }]),
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(created.length, 0);
});

test('Parameters sent by the rule editor accepted：規則編輯器送出的完整內容建立成功', async () => {
  // automation/[ruleId]/page.tsx 的 handleSave：actions.map((a) => ({ type: a.type, params: a.payload }))
  const actions = [
    { type: 'send_message', params: { text: '您好，請稍候' } },
    { type: 'create_case', params: { title: '客訴', priority: 'HIGH', category: '退換貨' } },
    { type: 'add_tag', params: { tagName: 'VIP' } },
    { type: 'notify', params: { message: '有新訊息', agentId: '2b1c2d3e-4f50-4a6b-8c7d-8e9f0a1b2c3d' } },
    { type: 'notify_supervisor', params: { message: '請主管處理' } },
  ];
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/automation/rules',
    payload: { ...rule(actions), description: '', priority: 0, stopOnMatch: false, isActive: true },
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(created.length, 1);
  assert.deepEqual(created[0]!.actions, actions);
});
