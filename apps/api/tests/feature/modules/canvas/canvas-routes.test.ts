/**
 * 流程管理只作用在本租戶的流程（change migrate-canvas-tenant-ctx，spec interaction-canvas）。
 *
 * 搬遷前寫成，搬遷前後都要通過（執行紀錄的 404 與 VALIDATION_ERROR 在搬遷前失敗）。
 */
import assert from 'node:assert/strict';
import { afterAll, describe, test } from 'vitest';
import { call, createCanvasFixture } from './canvas-test-app.js';

const fx = await createCanvasFixture('routes');
afterAll(() => fx.cleanup());

const appA = await fx.buildApp(fx.A, 'manager');
const flowA1 = await fx.flowOf(fx.A, 'DRAFT', 'a1');
const flowA2 = await fx.flowOf(fx.A, 'ACTIVE', 'a2');
const flowB = await fx.flowOf(fx.B, 'DRAFT', 'b');
const base = '/api/v1/canvas';

describe('流程管理只作用在本租戶的流程', () => {
  test('列出流程', async () => {
    const res = await call(appA, 'GET', `${base}?limit=100`);
    assert.equal(res.status, 200);
    const ids = (res.body.data as Array<{ id: string }>).map((f) => f.id).sort();
    assert.deepEqual(ids, [flowA1.id, flowA2.id].sort());
    assert.equal(res.body.meta.total, 2);
  });

  test('讀取另一個租戶的流程', async () => {
    for (const path of [`${base}/${flowB.id}`, `${base}/${flowB.id}/analytics`, `${base}/${flowB.id}/executions`]) {
      const res = await call(appA, 'GET', path);
      assert.equal(res.status, 404, path);
    }
  });

  test('修改另一個租戶的流程', async () => {
    const patch = await call(appA, 'PATCH', `${base}/${flowB.id}`, { name: `${fx.mark}-改名` });
    assert.equal(patch.status, 404);
    const activate = await call(appA, 'POST', `${base}/${flowB.id}/activate`);
    assert.equal(activate.status, 404);

    const after = await fx.owner.interactionFlow.findUniqueOrThrow({ where: { id: flowB.id } });
    assert.equal(after.name, flowB.name);
    assert.equal(after.status, 'DRAFT');
  });

  test('流程 id 格式錯誤', async () => {
    const requests: Array<['GET' | 'POST' | 'PATCH', string, unknown?]> = [
      ['GET', `${base}/not-a-uuid`],
      ['PATCH', `${base}/not-a-uuid`, { name: 'x' }],
      ['POST', `${base}/not-a-uuid/activate`],
      ['POST', `${base}/not-a-uuid/trigger`, { contactId: '00000000-0000-4000-8000-000000000001' }],
      ['GET', `${base}/not-a-uuid/analytics`],
      ['GET', `${base}/not-a-uuid/executions`],
    ];
    for (const [method, path, payload] of requests) {
      const res = await call(appA, method, path, payload);
      assert.equal(res.status, 400, `${method} ${path}`);
      assert.equal(res.body.error?.code, 'VALIDATION_ERROR', `${method} ${path}`);
    }
  });
});

describe('執行紀錄依執行狀態篩選', () => {
  test('依執行狀態篩選', async () => {
    const contact = await fx.contactOf(fx.A, 'exec-filter');
    const execution = (status: 'COMPLETED' | 'FAILED') =>
      fx.owner.flowExecution.create({ data: { flowId: flowA2.id, contactId: contact.id, tenantId: fx.A, status } });
    const completed = await execution('COMPLETED');
    await execution('FAILED');

    const res = await call(appA, 'GET', `${base}/${flowA2.id}/executions?status=COMPLETED`);
    assert.equal(res.status, 200);
    assert.deepEqual((res.body.data as Array<{ id: string }>).map((e) => e.id), [completed.id]);
    assert.equal(res.body.meta.total, 1);
  });

  test('篩選值不是執行狀態', async () => {
    const res = await call(appA, 'GET', `${base}/${flowA2.id}/executions?status=ACTIVE`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'VALIDATION_ERROR');
    // 斷言路由的 schema 擋下 status：值送到資料庫時 Prisma 也回 400 VALIDATION_ERROR，但沒有 details
    const issues = (res.body.error as { details?: { issues?: Array<{ path: string }> } }).details?.issues ?? [];
    assert.deepEqual(issues.map((i) => i.path), ['status']);
  });
});

