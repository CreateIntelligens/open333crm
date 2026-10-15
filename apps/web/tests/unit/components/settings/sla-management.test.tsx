// @vitest-environment jsdom
/**
 * SLA 政策刪除被擋時顯示原因（change fix-admin-settings-safeguards，sla-policy-selection「使用中的政策不能刪除」）。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { SlaManagement } from '#src/components/settings/SlaManagement.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('刪除使用中的政策時顯示後端的原因', async () => {
  api.get.mockResolvedValue({
    data: { data: [{ id: 'p1', name: '標準', priority: 'HIGH', firstResponseMinutes: 30, resolutionMinutes: 240, warningBeforeMinutes: 30, isDefault: false }] },
  });
  api.delete.mockRejectedValueOnce({
    response: { status: 409, data: { error: { code: 'SLA_POLICY_IN_USE', message: '仍有 2 張未結案的工單使用此政策' } } },
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  render(<SlaManagement />);
  await screen.findByText('標準');
  const deleteButton = document.querySelector('button.text-destructive') as HTMLButtonElement;
  fireEvent.click(deleteButton);
  await waitFor(() => assert.equal(alertSpy.mock.calls.length, 1));
  assert.match(String(alertSpy.mock.calls[0][0]), /仍有 2 張未結案的工單/);
});
