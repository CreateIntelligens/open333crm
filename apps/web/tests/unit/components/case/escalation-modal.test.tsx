// @vitest-environment jsdom
/**
 * 升級對話框的通知對象（change remove-escalation-notify-team，spec case-management
 * 「Escalation Notify Targets Are Validated」）：系統沒有實作通知團隊，對話框不提供這個選項。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { EscalationModal } from '#src/components/case/EscalationModal.js';

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ data: { data: [] } });
  api.post.mockReset().mockResolvedValue({ data: { data: {} } });
});
afterEach(cleanup);

test('Escalation dialog offers no team option：只能勾主管與原負責客服，送出不含 team', async () => {
  render(
    <EscalationModal
      open
      onOpenChange={vi.fn()}
      onSuccess={vi.fn()}
      caseData={{ id: 'c0000000-0000-0000-0000-000000000001', title: '測試案件', priority: 'MEDIUM', status: 'IN_PROGRESS' }}
    />,
  );

  const dialog = await screen.findByRole('dialog');
  const checkboxes = within(dialog).getAllByRole('checkbox') as HTMLInputElement[];
  assert.equal(checkboxes.length, 2, '通知對象只有兩個勾選');
  assert.ok(within(dialog).queryByText(/團隊/) === null, '不顯示團隊通知選項');
  for (const box of checkboxes) if (!box.checked) fireEvent.click(box);

  fireEvent.click(within(dialog).getByText('客戶多次催促', { selector: 'button' }));
  fireEvent.click(within(dialog).getByText('確認升級'));

  await waitFor(() => assert.equal(api.post.mock.calls.length, 1));
  const [path, body] = api.post.mock.calls[0];
  assert.equal(path, '/cases/c0000000-0000-0000-0000-000000000001/escalate');
  assert.deepEqual(body.notifyTargets, ['supervisor', 'original_assignee']);
});
