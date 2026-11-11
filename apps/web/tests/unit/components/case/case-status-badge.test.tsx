// @vitest-environment jsdom
/**
 * 工單狀態徽章（S03）：API 回傳的狀態是大寫列舉（OPEN、IN_PROGRESS…），徽章要顯示中文。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { test } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CaseStatusBadge } from '#src/components/case/CaseStatusBadge.js';

const cases: Array<[string, string]> = [
  ['OPEN', '開啟'],
  ['IN_PROGRESS', '處理中'],
  ['PENDING', '待處理'],
  ['ESCALATED', '已升級'],
  ['RESOLVED', '已解決'],
  ['CLOSED', '已關閉'],
];

for (const [status, label] of cases) {
  test(`API 回傳 ${status} 時徽章顯示「${label}」`, () => {
    render(<CaseStatusBadge status={status} />);
    assert.ok(screen.queryByText(label) !== null, `應顯示 ${label}`);
    assert.ok(screen.queryByText(status) === null, `不應顯示英文代碼 ${status}`);
  });
}
