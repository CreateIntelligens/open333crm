// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
import { MaterialEditor, type MaterialDraft } from '#src/components/materials/MaterialEditor.js';

const draft: MaterialDraft = {
  name: '個資測試',
  channelType: 'line',
  contentType: 'line_text',
  body: { text: '客人電話 0912345678，信箱 qa@example.com' },
  variables: [],
};

beforeEach(() => api.get.mockReset());
afterEach(cleanup);

function renderEditor(onSave = vi.fn()) {
  render(
    <MaterialEditor
      draft={draft}
      saving={false}
      onChange={vi.fn()}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  );
  return onSave;
}

test('enabled material editor defaults to masked save', async () => {
  api.get.mockResolvedValue({ data: { data: { enabled: true } } });
  const onSave = renderEditor();
  await waitFor(() => assert.ok(screen.queryByRole('button', { name: '個資遮罩' })));
  fireEvent.click(screen.getByRole('button', { name: '存為素材' }));
  await waitFor(() => assert.deepEqual(onSave.mock.calls, [['mask']]));
});

test('enabled material editor can explicitly preserve original content', async () => {
  api.get.mockResolvedValue({ data: { data: { enabled: true } } });
  const onSave = renderEditor();
  await waitFor(() => assert.ok(screen.queryByRole('button', { name: '個資遮罩' })));
  fireEvent.click(screen.getByRole('button', { name: '個資遮罩' }));
  assert.ok(screen.getByRole('button', { name: '保留原文' }));
  fireEvent.click(screen.getByRole('button', { name: '存為素材' }));
  await waitFor(() => assert.deepEqual(onSave.mock.calls, [['original']]));
});

test('policy-off material editor does not show a privacy choice', async () => {
  api.get.mockResolvedValue({ data: { data: { enabled: false } } });
  const onSave = renderEditor();
  await waitFor(() => assert.equal(screen.queryByRole('button', { name: '個資遮罩' }), null));
  fireEvent.click(screen.getByRole('button', { name: '存為素材' }));
  await waitFor(() => assert.deepEqual(onSave.mock.calls, [[undefined]]));
});
