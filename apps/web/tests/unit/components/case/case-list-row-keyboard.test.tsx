// @vitest-environment jsdom
/**
 * 工單列表的列鍵盤操作：焦點在列上按 Enter 開啟工單；
 * 焦點在列內的「刪除」按鈕按 Enter 時不可冒泡到列而導頁（PR #539 bot 審查）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { CaseList } from '#src/components/case/CaseList.js';

const CASE = {
  id: 'c0000000-0000-0000-0000-000000000001',
  title: '測試工單',
  status: 'OPEN',
  priority: 'MEDIUM',
  createdAt: new Date(2026, 6, 14, 9, 5).toISOString(),
};

afterEach(() => {
  cleanup();
  push.mockReset();
});

test('焦點在列上按 Enter 開啟工單', () => {
  render(<CaseList isLoading={false} cases={[CASE]} onDelete={vi.fn()} />);
  const row = screen.getAllByRole('row').find((r) => r.getAttribute('tabindex') === '0');
  assert.ok(row);
  fireEvent.keyDown(row, { key: 'Enter' });
  assert.deepEqual(push.mock.calls, [[`/dashboard/cases/${CASE.id}`]]);
});

test('在刪除按鈕上按 Enter 不會開啟工單', () => {
  render(<CaseList isLoading={false} cases={[CASE]} onDelete={vi.fn()} />);
  fireEvent.keyDown(screen.getByRole('button', { name: `刪除工單 ${CASE.title}` }), { key: 'Enter' });
  assert.equal(push.mock.calls.length, 0);
});
