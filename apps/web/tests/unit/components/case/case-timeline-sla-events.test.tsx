// @vitest-environment jsdom
/**
 * 工單時間軸的系統事件（S01）：SLA 與自動指派事件顯示中文，不顯示英文代碼與「System」。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { CaseTimeline } from '#src/components/case/CaseTimeline.js';

const at = '2026-10-15T01:00:00.000Z';
const ev = (id: string, eventType: string, payload: Record<string, unknown> = {}) => ({
  id, type: eventType, eventType, payload, createdAt: at,
});

test('SLA、自動指派、關聯對話事件顯示中文文案', () => {
  render(
    <CaseTimeline
      caseId="c-1"
      onRefresh={vi.fn()}
      events={[
        ev('e1', 'sla_breached', { previousPriority: 'MEDIUM', newPriority: 'HIGH' }),
        ev('e2', 'sla_warning'),
        ev('e3', 'first_response_breached'),
        ev('e4', 'first_response_warning'),
        ev('e5', 'customer_waiting_breached'),
        ev('e6', 'auto_assigned', { assigneeName: '王小明' }),
        ev('e7', 'conversation_linked'),
      ]}
    />,
  );

  for (const text of [
    '解決期限已逾期，優先級 中 → 高',
    '解決期限即將逾期',
    '首次回應已逾期',
    '首次回應即將逾期',
    '客戶等待過久，有多則訊息尚未回覆',
    '自動指派給 王小明',
    '關聯了一個對話',
  ]) {
    assert.ok(screen.queryByText(text) !== null, `應顯示「${text}」`);
  }
  for (const code of ['sla_breached', 'sla_warning', 'first_response_breached', 'customer_waiting_breached', 'auto_assigned', 'conversation_linked']) {
    assert.ok(screen.queryByText(code) === null, `不應顯示英文代碼 ${code}`);
  }
  assert.ok(screen.queryAllByText('System').length === 0, '系統事件作者不應顯示英文 System');
});
