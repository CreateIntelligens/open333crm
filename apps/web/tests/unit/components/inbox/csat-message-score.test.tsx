// @vitest-environment jsdom
/**
 * 評分後收件匣的問卷卡片顯示分數（issue #444，change show-csat-score-444）：
 * 有分數時卡片唯讀，標題標明客人評分或客服代評；socket 推來分數時卡片跟著更新。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

const { CsatMessage } = await import('#src/components/inbox/CsatMessage.js');

afterEach(() => {
  cleanup();
  api.post.mockReset();
});

test('有分數的問卷卡片唯讀', () => {
  render(<CsatMessage score={2} ratedBy="customer" caseId="case-1" />);

  assert.ok(screen.queryByText('客人評 2 分') !== null, '顯示客人評 2 分');
  assert.ok(screen.queryByText('請評價此次服務體驗') === null, '不再顯示未評分的標題');
  const stars = screen.getAllByRole('button');
  assert.equal(stars.length, 5);
  for (const star of stars) assert.equal((star as HTMLButtonElement).disabled, true);
  fireEvent.click(stars[4]!);
  assert.equal(api.post.mock.calls.length, 0, '點星星不送出評分');
});

test('客服代評的問卷卡片標明客服代評', () => {
  render(<CsatMessage score={4} ratedBy="agent" caseId="case-1" />);

  assert.ok(screen.queryByText('客服代評 4 分') !== null, '顯示客服代評 4 分');
});

test('socket 推來分數後卡片改成唯讀並顯示分數', () => {
  const { rerender } = render(<CsatMessage caseId="case-1" />);
  assert.ok(screen.queryByText('請評價此次服務體驗') !== null);

  rerender(<CsatMessage score={3} ratedBy="customer" caseId="case-1" />);

  assert.ok(screen.queryByText('客人評 3 分') !== null, '顯示客人評 3 分');
  for (const star of screen.getAllByRole('button')) assert.equal((star as HTMLButtonElement).disabled, true);
});
