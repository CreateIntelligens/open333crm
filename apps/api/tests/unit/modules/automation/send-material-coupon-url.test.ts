/**
 * 傳送素材動作不可使用含顧客專屬券連結的素材（change improve-coupon-url-insert-ux，
 * spec automation-engine「傳送素材動作不可使用含顧客專屬券連結的素材」）。
 *
 * 自動化規則不會發券；workers 會把沒代入的 {{coupon.url}} 拿掉，顧客收到少了連結的訊息。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createRule, updateRule } from '#src/modules/automation/automation.service.js';

const T = 'tenant-a';
const MAT_COUPON_URL = '11111111-1111-4111-8111-111111111111';
const MAT_PLAIN = '22222222-2222-4222-8222-222222222222';

const materials = [
  { id: MAT_COUPON_URL, tenantId: T, isActive: true, body: { text: '領券：{{coupon.url}}' } },
  { id: MAT_PLAIN, tenantId: T, isActive: true, body: { text: '營業時間 10:00-20:00' } },
];

function fakeDb(existingMaterialId = MAT_PLAIN) {
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    material: {
      async findMany({ where, select }: { where: { tenantId: string; isActive?: boolean; id: { in: string[] } }; select: Record<string, boolean> }) {
        return materials
          .filter((m) => m.tenantId === where.tenantId && where.id.in.includes(m.id) && m.isActive)
          .map((m) => (select.body ? { id: m.id, body: m.body } : { id: m.id }));
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
      findMany: async () => [],
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

const rejectsCouponUrl = (e: { statusCode?: number; message?: string }) =>
  e.statusCode === 400 && /顧客專屬券連結/.test(e.message ?? '');

test('建立關鍵字回覆時選了含券連結的素材：回 400，不建立規則', async () => {
  const { db, writes } = fakeDb();
  await assert.rejects(createRule(db, T, rule(MAT_COUPON_URL)), rejectsCouponUrl);
  assert.equal(writes.length, 0);
});

test('不含券連結的素材：建立成功', async () => {
  const { db, writes } = fakeDb();
  await createRule(db, T, rule(MAT_PLAIN));
  assert.equal(writes.length, 1);
});

test('更新動作時同樣檢查', async () => {
  const { db, writes } = fakeDb();
  await assert.rejects(updateRule(db, 'r1', T, { actions: rule(MAT_COUPON_URL).actions }), rejectsCouponUrl);
  assert.equal(writes.length, 0);
});

test('只改啟用狀態不檢查：既有規則的素材含券連結，停用或改名仍成功', async () => {
  const { db, writes } = fakeDb(MAT_COUPON_URL);
  await updateRule(db, 'r1', T, { isActive: false });
  await updateRule(db, 'r1', T, { name: '改名' });
  assert.equal(writes.length, 2);
});
