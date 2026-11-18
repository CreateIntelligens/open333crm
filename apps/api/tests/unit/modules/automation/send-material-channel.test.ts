/**
 * 規則條件限定對話渠道時，「傳送素材」的素材要是同一個渠道的素材（#362 D8，
 * spec automation-engine「Send Material Action References An Existing Material」）。
 *
 * 原本只有關鍵字回覆頁在前端擋；API、CLI、MCP 可以存「對話渠道等於 FB」卻送 LINE 素材的規則，
 * workers 執行時永遠略過素材，規則看起來有效卻從不送出。
 * 比對的是資料值（條件值與素材的 channelType，不分大小寫），不寫死渠道。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createRule, updateRule } from '#src/modules/automation/automation.service.js';
import { createMockTenantCtx } from '#tests/support/mock-tenant-ctx.js';

const T = 'tenant-a';
const MAT_LINE = '11111111-1111-4111-8111-111111111111';
const MAT_FB = '22222222-2222-4222-8222-222222222222';
const MAT_LINE_OFF = '33333333-3333-4333-8333-333333333333';

const materials = [
  { id: MAT_LINE, tenantId: T, isActive: true, channelType: 'line', name: 'LINE 歡迎', body: { text: 'hi' } },
  { id: MAT_FB, tenantId: T, isActive: true, channelType: 'fb', name: 'FB 歡迎', body: { text: 'hi' } },
  { id: MAT_LINE_OFF, tenantId: T, isActive: false, channelType: 'line', name: '舊素材', body: { text: 'hi' } },
];

const channelIs = (value: string) => ({ all: [{ fact: 'conversation.channelType', operator: 'equal', value }] });

function fakeDb(existing: { conditions?: unknown; materialId?: string } = {}) {
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    material: {
      async findMany({ where }: { where: { tenantId: string; isActive?: boolean; id: { in: string[] } } }) {
        return materials
          .filter((m) => m.tenantId === where.tenantId && where.id.in.includes(m.id))
          .filter((m) => where.isActive === undefined || m.isActive === where.isActive);
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
        conditions: existing.conditions ?? channelIs('LINE'),
        actions: [{ type: 'send_material', params: { materialId: existing.materialId ?? MAT_LINE } }],
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { id: 'r1', ...data };
      },
    },
  };
  return { db: db as never, writes };
}

const rule = (conditions: unknown, materialId: string) => ({
  name: 'kw',
  trigger: { type: 'keyword.matched', keywords: ['hi'], match_mode: 'any' },
  conditions: conditions as Record<string, unknown>,
  actions: [{ type: 'send_material', params: { materialId } }],
});

type AppErr = { statusCode?: number; code?: string; message?: string; details?: { issues?: Array<{ path: string; message: string }> } };

function channelMismatch(e: AppErr) {
  assert.equal(e.statusCode, 400);
  assert.equal(e.code, 'VALIDATION_ERROR');
  assert.match(e.message ?? '', /Facebook/);
  assert.match(e.message ?? '', /LINE/);
  assert.equal(e.details?.issues?.[0]?.path, 'actions');
  assert.equal(e.details?.issues?.[0]?.message, e.message);
  return true;
}

test('條件限定 LINE、素材是 Facebook：回 400，不建立規則', async () => {
  const { db, writes } = fakeDb();
  await assert.rejects(createRule(createMockTenantCtx(db, T).ctx, rule(channelIs('LINE'), MAT_FB)), channelMismatch);
  assert.equal(writes.length, 0);
});

test('條件限定 LINE、素材是 LINE：建立成功（大小寫不同視為同一渠道）', async () => {
  const { db, writes } = fakeDb();
  await createRule(createMockTenantCtx(db, T).ctx, rule(channelIs('LINE'), MAT_LINE));
  assert.equal(writes.length, 1);
});

test('沒有渠道條件：不比對素材渠道', async () => {
  const { db, writes } = fakeDb();
  await createRule(createMockTenantCtx(db, T).ctx, rule({ all: [] }, MAT_FB));
  assert.equal(writes.length, 1);
});

test('渠道條件放在 any 裡不是必要條件：不比對', async () => {
  const { db, writes } = fakeDb();
  const conditions = { any: [{ fact: 'conversation.channelType', operator: 'equal', value: 'LINE' }, { fact: 'message.text', operator: 'contains', value: 'x' }] };
  await createRule(createMockTenantCtx(db, T).ctx, rule(conditions, MAT_FB));
  assert.equal(writes.length, 1);
});

test('巢狀 all 裡的渠道條件也是必要條件：回 400', async () => {
  const { db, writes } = fakeDb();
  const conditions = { all: [{ all: [{ fact: 'conversation.channelType', operator: 'equal', value: 'LINE' }] }] };
  await assert.rejects(createRule(createMockTenantCtx(db, T).ctx, rule(conditions, MAT_FB)), channelMismatch);
  assert.equal(writes.length, 0);
});

test('更新動作改用其他渠道的素材：回 400', async () => {
  const { db, writes } = fakeDb();
  await assert.rejects(
    updateRule(createMockTenantCtx(db, T).ctx, 'r1', { actions: rule(null, MAT_FB).actions }),
    channelMismatch,
  );
  assert.equal(writes.length, 0);
});

test('只改條件、讓既有素材與渠道不符：回 400', async () => {
  const { db, writes } = fakeDb({ conditions: channelIs('FB'), materialId: MAT_LINE });
  await assert.rejects(
    updateRule(createMockTenantCtx(db, T).ctx, 'r1', { conditions: channelIs('FB') }),
    (e: AppErr) => e.statusCode === 400 && /LINE/.test(e.message ?? '') && /Facebook/.test(e.message ?? ''),
  );
  assert.equal(writes.length, 0);
});

test('只改條件、既有素材已停用但渠道相符：不擋（停用素材只在更換動作時檢查）', async () => {
  const { db, writes } = fakeDb({ materialId: MAT_LINE_OFF });
  await updateRule(createMockTenantCtx(db, T).ctx, 'r1', { conditions: channelIs('LINE') });
  assert.equal(writes.length, 1);
});

test('只改名稱、停用或重新啟用：不比對素材渠道（既有規則要能照常開關）', async () => {
  const { db, writes } = fakeDb({ conditions: channelIs('FB'), materialId: MAT_LINE });
  await updateRule(createMockTenantCtx(db, T).ctx, 'r1', { name: '改名' });
  await updateRule(createMockTenantCtx(db, T).ctx, 'r1', { isActive: false });
  await updateRule(createMockTenantCtx(db, T).ctx, 'r1', { isActive: true });
  assert.equal(writes.length, 3);
});
