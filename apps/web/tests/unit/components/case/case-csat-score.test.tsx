// @vitest-environment jsdom
/**
 * 評分寫入工單時間軸、工單詳情頁顯示分數（issue #444，change show-csat-score-444）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(async () => ({ data: { data: [] } })), post: vi.fn(), patch: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/components/contact/TagManager.js', () => ({ TagManager: () => null }));

const { CaseTimeline } = await import('#src/components/case/CaseTimeline.js');
const { CaseDetail } = await import('#src/components/case/CaseDetail.js');

afterEach(cleanup);

const at = '2026-11-04T04:38:00.000Z';

test('時間軸以中文顯示評分與自動關閉', () => {
  render(
    <CaseTimeline
      caseId="c-1"
      onRefresh={vi.fn()}
      events={[
        { id: 'e1', type: 'csat_rated', eventType: 'csat_rated', actorType: 'contact', createdBy: 'c0ffee00-0000-4000-8000-000000000001', payload: { score: 2, source: 'customer' }, createdAt: at },
        { id: 'e2', type: 'csat_rated', eventType: 'csat_rated', actorType: 'agent', actor: { id: 'a-1', name: '王小明' }, payload: { score: 4, source: 'agent' }, createdAt: at },
        { id: 'e3', type: 'status_changed', eventType: 'status_changed', actorType: 'system', payload: { from: 'RESOLVED', to: 'CLOSED', reason: 'csat_rated' }, createdAt: at },
      ]}
    />,
  );

  for (const text of ['客人評分：2 分（不滿意）', '客服代評滿意度：4 分（滿意）', '狀態：已解決 → 已關閉（評分後自動關閉）']) {
    assert.ok(screen.queryByText(text) !== null, `應顯示「${text}」`);
  }
  assert.ok(screen.queryByText('csat_rated') === null, '不顯示英文代碼');
  assert.ok(screen.queryByText('客人') !== null, '客人評分的紀錄作者是客人');
  assert.ok(screen.queryByText('王小明') !== null, '客服代評的紀錄作者是客服');
});

test('工單詳情頁顯示滿意度分數', () => {
  render(
    <CaseDetail
      onRefresh={vi.fn()}
      caseData={{
        id: 'c-1',
        title: '冷氣不冷',
        status: 'CLOSED',
        priority: 'MEDIUM',
        csatScore: 2,
        csatRespondedAt: at,
        createdAt: at,
        updatedAt: at,
      }}
    />,
  );

  const block = screen.getByTestId('case-csat');
  assert.match(block.textContent ?? '', /2 分/);
  assert.match(block.textContent ?? '', /不滿意/);
});

// issue #339 決定 8（csat-survey「工單記錄評分來源」）
test('工單詳情標明客服代評', () => {
  render(
    <CaseDetail
      onRefresh={vi.fn()}
      caseData={{
        id: 'c-1',
        title: '冷氣不冷',
        status: 'CLOSED',
        priority: 'MEDIUM',
        csatScore: 4,
        csatRatedBy: 'agent',
        csatRespondedAt: at,
        createdAt: at,
        updatedAt: at,
      }}
    />,
  );

  const block = screen.getByTestId('case-csat');
  assert.match(block.textContent ?? '', /4 分/);
  assert.match(block.textContent ?? '', /客服代評/);
});

test('客人自評的工單不標客服代評', () => {
  render(
    <CaseDetail
      onRefresh={vi.fn()}
      caseData={{ id: 'c-1', title: '冷氣不冷', status: 'CLOSED', priority: 'MEDIUM', csatScore: 4, csatRatedBy: 'customer', createdAt: at, updatedAt: at }}
    />,
  );

  assert.doesNotMatch(screen.getByTestId('case-csat').textContent ?? '', /客服代評/);
});

// issue #339（csat-survey「低分只通知負責工單的成員」）：低分通知送不出時時間軸以中文說明
test('時間軸以中文顯示低分通知沒有送出', () => {
  render(
    <CaseTimeline
      caseId="c-1"
      onRefresh={vi.fn()}
      events={[
        { id: 'e1', type: 'csat_low_score_notify_failed', eventType: 'csat_low_score_notify_failed', actorType: 'system', payload: { score: 2, reason: '低分通知沒有送出，請手動通知負責的成員' }, createdAt: at },
      ]}
    />,
  );

  assert.ok(screen.queryByText(/低分（2 分）通知沒有送出/) !== null, '顯示中文說明');
  assert.ok(screen.queryByText('csat_low_score_notify_failed') === null, '不顯示英文代碼');
});
