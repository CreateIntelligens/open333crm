// @vitest-environment jsdom
/**
 * 工單列表的短欄位不換行（#293）：1440 寬時「開啟」「未指派」與 SLA 倒數被擠成兩行。
 * jsdom 量不到實際寬度，這裡檢查這些欄位的儲存格有設定不換行。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { CaseList } from '#src/components/case/CaseList.js';

test('優先級、狀態、負責人、SLA、建立時間欄位不換行', () => {
  const slaDueAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  render(
    <CaseList
      isLoading={false}
      cases={[{
        id: 'c0000000-0000-0000-0000-000000000001',
        title: '測試工單',
        status: 'OPEN',
        priority: 'MEDIUM',
        slaDueAt,
        createdAt: new Date(2026, 6, 14, 9, 5).toISOString(),
      }]}
    />,
  );
  const cells = {
    優先級: screen.getByText('中'),
    狀態: screen.getByText('開啟'),
    負責人: screen.getByText('未指派'),
    SLA: screen.getByText(/^剩 /),
    建立時間: screen.getByText('2026/07/14 09:05'),
  };
  for (const [name, el] of Object.entries(cells)) {
    const td = el.closest('td');
    assert.ok(td !== null, `${name} 應在表格儲存格內`);
    assert.ok(td.classList.contains('whitespace-nowrap'), `${name} 欄位應設定不換行`);
  }
});
