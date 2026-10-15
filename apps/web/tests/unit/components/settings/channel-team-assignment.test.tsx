// @vitest-environment jsdom
/**
 * 「指派團隊」說明（G16）：沒有指派任何團隊或成員的渠道只有「總店」看得到
 * （openspec/specs/channel-visibility-defaults「Unbound Channel Is Not Visible」），說明原本寫成全租戶公開。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(async (..._args: unknown[]) => ({ data: { data: [] } })), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { ChannelTeamAssignment } from '#src/components/settings/ChannelTeamAssignment.js';

test('說明未指派時只有總店看得到', () => {
  render(<ChannelTeamAssignment channelId="ch1" />);
  assert.equal(screen.queryAllByText(/全租戶公開/).length, 0);
  assert.ok(screen.queryAllByText(/未指派任何團隊或成員時，只有具「總店」權限/).length > 0);
});
