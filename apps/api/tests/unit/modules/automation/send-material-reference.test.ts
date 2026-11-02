/**
 * 自動化規則的「傳送素材」動作要指向同租戶、啟用中的素材（change fix-w6-marketing-validation，
 * spec automation-engine「Send Material Action References An Existing Material」；UAT E2E CM-W6-04）。
 *
 * 原本 materialId 只檢查非空字串：非 UUID 或不存在的素材都能存，規則建起來卻永遠發不出訊息。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createRule, updateRule } from '#src/modules/automation/automation.service.js';
import { createMockTenantCtx } from '#tests/support/mock-tenant-ctx.js';

const T = 'tenant-a';
const MAT_OK = '11111111-1111-4111-8111-111111111111';
const MAT_OFF = '22222222-2222-4222-8222-222222222222';
const MAT_OTHER_TENANT = '33333333-3333-4333-8333-333333333333';
const MAT_MISSING = '44444444-4444-4444-8444-444444444444';

const materials = [
  { id: MAT_OK, tenantId: T, isActive: true },
  { id: MAT_OFF, tenantId: T, isActive: false },
  { id: MAT_OTHER_TENANT, tenantId: 'tenant-b', isActive: true },
];

function fakeDb(existingMaterialId = MAT_OK) {
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    material: {
      async findMany({ where }: { where: { tenantId: string; isActive?: boolean; id: { in: string[] } } }) {
        return materials
          .filter((m) => m.tenantId === where.tenantId && where.id.in.includes(m.id))
          .filter((m) => where.isActive === undefined || m.isActive === where.isActive)
          .map((m) => ({ id: m.id }));
      },
    },
    automationRule: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { id: 'r1', ...data };
      },
      findFirst: async () => ({
        id: 'r1',
        tenantId: T,
        enabled: true,
        eventType: 'keyword.matched',
        trigger: { type: 'keyword.matched', keywords: ['hi'], match_mode: 'any' },
        conditions: { all: [] },
        actions: [{ type: 'send_material', params: { materialId: existingMaterialId } }],
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { id: 'r1', ...data };
      },
    },
  };
  return { db: db as never, writes };
}

const rule = (materialId: string) => ({
  name: 'kw',
  trigger: { type: 'keyword.matched', keywords: ['hi'], match_mode: 'any' },
  conditions: { all: [] },
  actions: [{ type: 'send_material', params: { materialId } }],
});

const is400 = (e: { statusCode?: number }) => e.statusCode === 400;

test('Material ID is not a UUID：回 400，不建立規則', async () => {
  const { db, writes } = fakeDb();
  await assert.rejects(createRule(createMockTenantCtx(db, T).ctx, rule('not-a-uuid')), is400);
  assert.equal(writes.length, 0);
});

test('Material does not exist：回 400，不建立規則', async () => {
  const { db, writes } = fakeDb();
  await assert.rejects(createRule(createMockTenantCtx(db, T).ctx, rule(MAT_MISSING)), is400);
  assert.equal(writes.length, 0);
});

test('Material of another tenant：回 400', async () => {
  const { db } = fakeDb();
  await assert.rejects(createRule(createMockTenantCtx(db, T).ctx, rule(MAT_OTHER_TENANT)), is400);
});

test('停用中的素材：回 400', async () => {
  const { db } = fakeDb();
  await assert.rejects(createRule(createMockTenantCtx(db, T).ctx, rule(MAT_OFF)), is400);
});

test('Existing active material：建立成功', async () => {
  const { db, writes } = fakeDb();
  await createRule(createMockTenantCtx(db, T).ctx, rule(MAT_OK));
  assert.equal(writes.length, 1);
});

test('更新動作時同樣檢查', async () => {
  const { db, writes } = fakeDb();
  await assert.rejects(updateRule(createMockTenantCtx(db, T).ctx, 'r1', { actions: rule(MAT_MISSING).actions }), is400);
  assert.equal(writes.length, 0);
});

test('沒有送 actions 時不檢查：既有規則指向已停用的素材，只改名稱或啟用狀態仍可成功', async () => {
  // 管理員要能停用或改名一條指向已停用素材的規則（關鍵字回覆頁編輯時會送完整 actions，會被檢查）
  const { db, writes } = fakeDb(MAT_OFF);
  await updateRule(createMockTenantCtx(db, T).ctx, 'r1', { name: '改名' });
  await updateRule(createMockTenantCtx(db, T).ctx, 'r1', { isActive: false });
  assert.equal(writes.length, 2);
});
