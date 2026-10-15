// @vitest-environment jsdom
/**
 * 工單列表的建立時間（S04）：不顯示英文月份（Jul 14），改用 yyyy/MM/dd HH:mm。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { CaseList } from '#src/components/case/CaseList.js';

test('建立時間以數字日期顯示，不出現英文月份', () => {
  const createdAt = new Date(2026, 6, 14, 9, 5).toISOString(); // 本地時間 2026/07/14 09:05
  render(
    <CaseList
      isLoading={false}
      cases={[{ id: 'c0000000-0000-0000-0000-000000000001', title: '測試工單', status: 'OPEN', priority: 'MEDIUM', createdAt }]}
    />,
  );
  assert.ok(screen.queryByText('2026/07/14 09:05') !== null, '應顯示 2026/07/14 09:05');
  assert.ok(screen.queryByText(/Jul/) === null, '不應顯示英文月份');
});
