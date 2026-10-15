/**
 * 有資料的渠道改用停用（change fix-admin-settings-safeguards，channel-management）。
 * G15／AUDIT CHAN-01：收過對話的渠道刪除被外鍵擋下（P2003），前端只看到泛用的伺服器錯誤。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { deleteChannel } from '#src/modules/channel/channel.service.js';

function prismaWithDeleteError(err: unknown) {
  return {
    channel: {
      findFirst: vi.fn(async () => ({ id: 'ch1', tenantId: 't1', channelType: 'LINE', credentialsEncrypted: 'x' })),
      delete: vi.fn(async () => {
        throw err;
      }),
    },
  };
}

test('收過對話的渠道刪除被拒', async () => {
  const fkError = Object.assign(new Error('Foreign key constraint violated'), {
    code: 'P2003',
    meta: { field_name: 'conversations_channelId_fkey (index)' },
  });
  await assert.rejects(deleteChannel(prismaWithDeleteError(fkError) as never, 'ch1', 't1'), (err: unknown) => {
    const e = err as { code?: string; statusCode?: number; message?: string };
    assert.equal(e.code, 'CHANNEL_IN_USE');
    assert.equal(e.statusCode, 409);
    assert.match(e.message ?? '', /停用/);
    return true;
  });
});

test('其他錯誤照原樣拋出', async () => {
  const other = new Error('connection lost');
  await assert.rejects(deleteChannel(prismaWithDeleteError(other) as never, 'ch1', 't1'), (err) => err === other);
});
