// @vitest-environment jsdom
/**
 * 共用空狀態：列表沒有資料時顯示圖示、標題、說明與（選填）操作按鈕。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EmptyState } from '#src/components/shared/EmptyState.js';

afterEach(cleanup);

test('顯示標題、說明與操作按鈕', () => {
  let clicked = 0;
  render(
    <EmptyState
      title="尚未建立標籤"
      description="建立標籤後可分類聯繫人與工單"
      action={<button type="button" onClick={() => { clicked += 1; }}>新增標籤</button>}
    />,
  );
  assert.ok(screen.getByRole('heading', { name: '尚未建立標籤' }));
  assert.ok(screen.queryByText('建立標籤後可分類聯繫人與工單') !== null);
  fireEvent.click(screen.getByRole('button', { name: '新增標籤' }));
  assert.equal(clicked, 1);
});

test('沒有說明與操作時只顯示標題，並有預設圖示', () => {
  const { container } = render(<EmptyState title="沒有通知" />);
  assert.ok(screen.getByRole('heading', { name: '沒有通知' }));
  assert.ok(screen.queryByRole('button') === null);
  assert.ok(container.querySelector('svg') !== null, '沒傳 icon 時有預設圖示');
});

test('圖示只是裝飾，不讀給螢幕閱讀器', () => {
  const { container } = render(<EmptyState title="沒有通知" />);
  const svg = container.querySelector('svg') as SVGElement;
  assert.ok(svg.closest('[aria-hidden="true"]') !== null);
});
