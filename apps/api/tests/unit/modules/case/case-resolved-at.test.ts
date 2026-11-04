/**
 * 工單狀態轉換維護 resolvedAt（issue #417，AUDIT CASE-04）。
 * 報表以 resolvedAt 判斷「已解決」：
 * - 轉成 RESOLVED 寫入解決時間；從 RESOLVED 轉成 CLOSED 保留原本的解決時間。
 * - 直接關閉（沒有經過 RESOLVED）不算已解決，不寫解決時間。
 * - 重開（離開 RESOLVED／CLOSED 回到其他狀態）清除解決時間，重開的工單不再算已解決。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { assignCase, escalateCase, transitionCase } from '#src/modules/case/case.service.js';
import { createMockTenantCtx } from '#tests/support/mock-tenant-ctx.js';

const RESOLVED_AT = new Date('2026-01-02T00:00:00Z');

/** 回傳 mock tx 與「case.update 收到的 data」 */
function txFor(current: { status: string; resolvedAt: Date | null }) {
  const updates: Array<Record<string, unknown>> = [];
  const tx = {
    case: {
      findFirst: async () => ({ id: 'case-1', tenantId: 't', priority: 'MEDIUM', conversations: [], ...current }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return { id: 'case-1', ...current, ...data };
      },
    },
    caseEvent: { create: async () => ({}) },
    agent: { findFirst: async () => ({ id: 'agent-2', name: '客服' }) },
  };
  return { ctx: createMockTenantCtx(tx).ctx, updates };
}

test('RESOLVED → IN_PROGRESS 清除 resolvedAt', async () => {
  const { ctx, updates } = txFor({ status: 'RESOLVED', resolvedAt: RESOLVED_AT });
  await transitionCase(ctx, 'case-1', 'agent-1', 'IN_PROGRESS');
  assert.equal(updates[0].resolvedAt, null);
});

test('CLOSED → OPEN 清除 resolvedAt', async () => {
  const { ctx, updates } = txFor({ status: 'CLOSED', resolvedAt: RESOLVED_AT });
  await transitionCase(ctx, 'case-1', 'agent-1', 'OPEN');
  assert.equal(updates[0].resolvedAt, null);
});

test('直接 CLOSED 不寫 resolvedAt', async () => {
  const { ctx, updates } = txFor({ status: 'IN_PROGRESS', resolvedAt: null });
  await transitionCase(ctx, 'case-1', 'agent-1', 'CLOSED');
  assert.ok(!(updates[0].resolvedAt instanceof Date), '直接關閉不可寫入解決時間');
  assert.ok(updates[0].closedAt instanceof Date);
});

test('RESOLVED → CLOSED 保留 resolvedAt', async () => {
  const { ctx, updates } = txFor({ status: 'RESOLVED', resolvedAt: RESOLVED_AT });
  await transitionCase(ctx, 'case-1', 'agent-1', 'CLOSED');
  assert.equal('resolvedAt' in updates[0], false, '不可覆寫或清除原本的解決時間');
  assert.ok(updates[0].closedAt instanceof Date);
});

test('轉成 RESOLVED 寫入 resolvedAt', async () => {
  const { ctx, updates } = txFor({ status: 'IN_PROGRESS', resolvedAt: null });
  await transitionCase(ctx, 'case-1', 'agent-1', 'RESOLVED');
  assert.ok(updates[0].resolvedAt instanceof Date);
});

test('升級（IN_PROGRESS → ESCALATED）不寫 resolvedAt', async () => {
  const { ctx, updates } = txFor({ status: 'IN_PROGRESS', resolvedAt: null });
  await escalateCase(ctx, 'case-1', 'agent-1');
  assert.ok(!(updates[0].resolvedAt instanceof Date));
});

test('指派時 OPEN 自動改 IN_PROGRESS 不寫 resolvedAt', async () => {
  const { ctx, updates } = txFor({ status: 'OPEN', resolvedAt: null });
  await assignCase(ctx, 'case-1', 'agent-1', 'agent-2');
  assert.ok(!(updates[0].resolvedAt instanceof Date));
});
