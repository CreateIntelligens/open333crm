/**
 * 工單狀態轉換時要寫入或清除的時間欄位（issue #417）。API 的 transitionCase() 與 workers 的
 * update_case_status 共用 caseTransitionTimestamps()，報表以 resolvedAt 判斷「已解決」。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { caseStatusOutcomeEvent, caseTransitionTimestamps } from '#src/constants/case-transitions.js';

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

// ── caseStatusOutcomeEvent（issue #469）：API 與 workers 共用的 case.resolved／case.closed 內容 ──
const SOURCE = {
  caseId: 'case-1',
  contactId: 'contact-1',
  channelId: 'channel-1',
  assigneeId: null,
  title: '退貨',
  conversationId: 'conv-1',
};

test('轉成 RESOLVED：發 case.resolved，內容含工單、聯絡人、渠道、負責人、標題與對話', () => {
  assert.deepEqual(caseStatusOutcomeEvent('RESOLVED', SOURCE), {
    name: 'case.resolved',
    payload: { caseId: 'case-1', contactId: 'contact-1', channelId: 'channel-1', assigneeId: null, title: '退貨', conversationId: 'conv-1' },
  });
});

test('轉成 CLOSED：發 case.closed；沒有對話時不帶 conversationId', () => {
  assert.deepEqual(caseStatusOutcomeEvent('CLOSED', { ...SOURCE, assigneeId: 'agent-1', conversationId: null }), {
    name: 'case.closed',
    payload: { caseId: 'case-1', contactId: 'contact-1', channelId: 'channel-1', assigneeId: 'agent-1', title: '退貨' },
  });
});

test('轉成其他狀態：不發事件', () => {
  for (const to of ['OPEN', 'IN_PROGRESS', 'PENDING', 'ESCALATED'] as const) {
    assert.equal(caseStatusOutcomeEvent(to, SOURCE), null, to);
  }
});
