// @vitest-environment jsdom
/**
 * IG 渠道的憑證欄位要對應 Meta「含有 Instagram 登入的 API 設定」頁的名稱。
 * 驗簽要用 Instagram 應用程式密鑰，填成「應用程式設定 → 基本資料」的 App Secret 會收不到任何訊息。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(async () => ({ data: { data: [] } })), post: vi.fn(), patch: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({ usePermission: () => false }));

import { ChannelFormDialog } from '#src/components/settings/ChannelFormDialog.js';

afterEach(cleanup);

test('IG 渠道的欄位名稱與提示對應 Instagram 登入的 API 設定頁', async () => {
  render(
    <ChannelFormDialog
      open
      onOpenChange={() => {}}
      channel={{ id: 'ch1', channelType: 'THREADS', displayName: 'IG' }}
      onSaved={() => {}}
    />,
  );
  assert.ok(await screen.findByText('Instagram 應用程式編號'));
  assert.ok(screen.getByText('Instagram 應用程式密鑰'));
  assert.ok(screen.getByText('Instagram 存取權杖'));
  assert.ok(screen.getByText(/不是「應用程式設定 → 基本資料」的 App Secret/));
  assert.ok(screen.getByText(/產生存取權杖/));
  assert.ok(screen.queryByText(/Settings → Basic/) === null, '不再指向基本資料頁');
});

test('新增渠道精靈的 IG 欄位也用相同名稱', async () => {
  const { ChannelWizard } = await import('#src/components/settings/ChannelWizard.js');
  const { fireEvent } = await import('@testing-library/react');
  render(<ChannelWizard open onOpenChange={() => {}} onComplete={() => {}} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'THREADS' } });
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  assert.ok(await screen.findByText('Instagram 應用程式編號'));
  assert.ok(screen.getByText('Instagram 應用程式密鑰'));
  assert.ok(screen.getByText('Instagram 存取權杖'));
  assert.ok(screen.getByText(/不是「應用程式設定 → 基本資料」的 App Secret/));
});
