/**
 * 工單狀態轉換時要寫入或清除的時間欄位（issue #417）。API 的 transitionCase() 與 workers 的
 * update_case_status 共用 caseTransitionTimestamps()，報表以 resolvedAt 判斷「已解決」。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { caseTransitionTimestamps } from '#src/constants/case-transitions.js';

const NOW = new Date('2026-11-04T00:00:00Z');

test('轉成 RESOLVED：寫入 resolvedAt', () => {
  assert.deepEqual(caseTransitionTimestamps('IN_PROGRESS', 'RESOLVED', NOW), { resolvedAt: NOW });
});

test('RESOLVED → CLOSED：寫入 closedAt，保留 resolvedAt', () => {
  assert.deepEqual(caseTransitionTimestamps('RESOLVED', 'CLOSED', NOW), { closedAt: NOW });
});

test('直接關閉：寫入 closedAt，不算已解決', () => {
  for (const from of ['OPEN', 'IN_PROGRESS', 'PENDING', 'ESCALATED'] as const) {
    assert.deepEqual(caseTransitionTimestamps(from, 'CLOSED', NOW), { closedAt: NOW, resolvedAt: null }, from);
  }
});

test('重開：RESOLVED → IN_PROGRESS、CLOSED → OPEN 清除 resolvedAt', () => {
  assert.deepEqual(caseTransitionTimestamps('RESOLVED', 'IN_PROGRESS', NOW), { resolvedAt: null });
  assert.deepEqual(caseTransitionTimestamps('CLOSED', 'OPEN', NOW), { resolvedAt: null });
});

test('狀態沒有改變：不動任何時間欄位', () => {
  assert.deepEqual(caseTransitionTimestamps('RESOLVED', 'RESOLVED', NOW), {});
  assert.deepEqual(caseTransitionTimestamps('CLOSED', 'CLOSED', NOW), {});
});
