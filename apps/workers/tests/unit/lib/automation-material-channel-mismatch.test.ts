/**
 * 素材渠道不符時留下看得到的紀錄（change fix-keyword-yield-ig-delivery，
 * spec automation-engine「素材渠道不符時留下看得到的紀錄」）。
 *
 * 背景（2026-10-14）：IG 對話命中只送 LINE 素材的關鍵字規則，素材被略過只寫 log，收件匣看不出任何事。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { ChannelPlugin } from '@open333crm/channel-plugins';
import { executeWorkerAutomationActions } from '#src/lib/automation-actions';

test('LINE 素材遇到 IG 對話', async () => {
  let sent = 0;
  const plugin = {
    channelType: 'THREADS',
    sendMessage: async () => {
      sent++;
      return { success: true };
    },
  } as unknown as ChannelPlugin;
  const created: Array<{ data: Record<string, any> }> = [];
  const prisma = {
    material: {
      findFirst: async () => ({ contentType: 'line_text', body: { text: '歡迎' }, channelType: 'line' }),
    },
    conversation: {
      findFirst: async () => ({ id: 'conv-1', tenantId: 'tenant-1', channel: { channelType: 'THREADS' } }),
    },
    message: {
      create: async (args: { data: Record<string, any> }) => {
        created.push(args);
        return { id: 'msg-1', createdAt: new Date(), ...args.data };
      },
    },
  };
  const redis = { publish: async () => 1 };

  await executeWorkerAutomationActions(
    prisma as any,
    redis as any,
    [{ type: 'send_material', params: { materialId: 'm-line' } }],
    { tenantId: 'tenant-1', conversationId: 'conv-1', trigger: 'keyword.matched', pluginRegistry: new Map([['THREADS', plugin]]) },
  );

  assert.equal(sent, 0, '不送出別的渠道的素材');
  assert.equal(created.length, 1, '對話留下一則紀錄');
  const { metadata } = created[0].data;
  assert.equal(metadata.deliveryFailed, true);
  assert.match(metadata.deliveryError, /LINE/);
  assert.match(metadata.deliveryError, /Instagram/);
});
