/**
 * Bot 最大回覆次數的範圍（change fix-admin-settings-safeguards，channel-management）。
 * G04：畫面限制 1～50，後端不驗證，實際存進 9999。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createChannelSchema, updateChannelSchema } from '#src/modules/channel/channel.routes.js';

const withMax = (maxBotReplies: unknown) => ({ settings: { botConfig: { botMode: 'keyword_then_llm', maxBotReplies } } });

test('範圍內的值可以儲存', () => {
  assert.equal(updateChannelSchema.safeParse(withMax(10)).success, true);
  assert.equal(updateChannelSchema.safeParse(withMax(1)).success, true);
  assert.equal(updateChannelSchema.safeParse(withMax(50)).success, true);
  assert.equal(updateChannelSchema.safeParse({ settings: { botConfig: { botMode: 'off' } } }).success, true, '沒有這個欄位時不檢查');
});

test('超出範圍的值被拒', () => {
  for (const v of [9999, 0, -1, 2.5, '5']) {
    const r = updateChannelSchema.safeParse(withMax(v));
    assert.equal(r.success, false, `${v} 應被拒`);
    assert.deepEqual(r.error?.issues[0].path, ['settings', 'botConfig', 'maxBotReplies']);
  }
  const created = createChannelSchema.safeParse({
    channelType: 'WEBCHAT',
    displayName: 'w',
    credentials: {},
    ...withMax(9999),
  });
  assert.equal(created.success, false);
});
