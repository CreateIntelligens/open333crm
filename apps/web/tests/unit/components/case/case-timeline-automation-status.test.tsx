// @vitest-environment jsdom
/**
 * 工單時間軸顯示自動化改狀態的結果（issue #469）：
 * 規則改狀態標出是哪條規則；轉換不合法被略過時寫出原因，不顯示英文代碼。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { CaseTimeline } from '#src/components/case/CaseTimeline.js';

const at = '2026-11-09T01:00:00.000Z';
const ev = (id: string, eventType: string, payload: Record<string, unknown> = {}) => ({
  id, type: eventType, eventType, actorType: 'automation', payload, createdAt: at,
});

test('自動化改狀態：標出規則名稱；被略過時寫出不能直接改的原因', () => {
  render(
    <CaseTimeline
      caseId="c-1"
      onRefresh={vi.fn()}
      events={[
        ev('e1', 'status_changed', { from: 'IN_PROGRESS', to: 'RESOLVED', source: 'automation', ruleName: '處理完自動結案' }),
        ev('e2', 'automation_status_skipped', { from: 'OPEN', to: 'RESOLVED', reason: 'invalid_transition', ruleName: '建立工單時結案' }),
        ev('e3', 'automation_status_skipped', { from: 'OPEN', to: 'FOO', reason: 'invalid_transition', ruleName: null }),
      ]}
    />,
  );

  for (const text of [
    '狀態：處理中 → 已解決（自動化規則「處理完自動結案」）',
    '自動化規則「建立工單時結案」沒有改狀態：不能從「開啟」直接改成「已解決」',
    '自動化規則沒有改狀態：不能從「開啟」直接改成「FOO」',
  ]) {
    assert.ok(screen.queryByText(text) !== null, `應顯示「${text}」`);
  }
  assert.ok(screen.queryByText('automation_status_skipped') === null, '不應顯示英文代碼');
});
