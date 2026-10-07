// @vitest-environment jsdom
/**
 * 平台後台的方案設定頁（openspec/specs/tenant-plan「方案管理 API」的「平台後台不能取消 core」）。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { platformApi } = vi.hoisted(() => ({
  platformApi: {
    get: vi.fn(async (url: string) => {
      if (url === '/registry') {
        return {
          data: {
            data: {
              features: [
                { slug: 'inbox', label: '客服收發', core: false, perms: [] },
                { slug: 'core', label: '帳號 · 角色 · 設定', core: true, perms: [] },
              ],
              channelTypes: [],
            },
          },
        };
      }
      return {
        data: {
          data: [
            { id: 'plan-light', slug: 'light', name: '輕量版', features: ['inbox', 'core'], limits: {}, allowedChannelTypes: [], permissionOverrides: {}, priceMonthly: 1000, isActive: true },
            { id: 'plan-custom', slug: 'custom', name: '自訂版', features: ['inbox'], limits: {}, allowedChannelTypes: [], permissionOverrides: {}, priceMonthly: 2000, isActive: true },
          ],
        },
      };
    }),
    patch: vi.fn(),
  },
}));
vi.mock('#src/app/admin/lib/platform-api.js', () => ({ platformApi }));

import PlansPage from '#src/app/admin/plans/page.js';

test('平台後台不能取消 core：每個方案的 core 勾選框都停用，其他功能可以操作', async () => {
  render(<PlansPage />);

  const coreBoxes = await screen.findAllByRole('checkbox', { name: '帳號 · 角色 · 設定' });
  const inboxBoxes = screen.getAllByRole('checkbox', { name: '客服收發' });

  assert.equal(coreBoxes.length, 2);
  assert.ok(coreBoxes.every((box) => (box as HTMLInputElement).disabled));
  assert.equal(inboxBoxes.length, 2);
  assert.ok(inboxBoxes.every((box) => !(box as HTMLInputElement).disabled));
});
