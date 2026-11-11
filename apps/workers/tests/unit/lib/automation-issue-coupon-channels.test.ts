/**
 * Facebook 與 Instagram 的關鍵字發券（change add-fb-ig-keyword-coupon；spec coupon-management
 * 「關鍵字回覆可以同時發券」的「Facebook 的關鍵字回覆發券」「Instagram 的關鍵字回覆只發券」，
 * 「自動化發券沒有發出時可回覆顧客」的「Facebook 顧客已達上限時回覆設定的文字」）。
 *
 * workers 的發券流程本來就支援 FB 與 Instagram（THREADS），這些測試寫下時就通過，以突變驗證：
 * 從 AUTOMATION_DELIVERY_CHANNEL_TYPES 拿掉 FB／THREADS 時，發券改記 CHANNEL_NOT_SUPPORTED，測試失敗。
 * FB／IG 的入站訊息沒有回覆權杖：送出策略為 push。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { COUPON_ID, RULE, TENANT, fakeCouponDb, fakeLinePlugin, fakeRedis } from '../support/fake-coupon-db.js';

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add() {
      return {};
    }
  },
}));

const { executeWorkerAutomationActions } = await import('#src/lib/automation-actions.js');

/** 指定渠道類型的假外掛：與 fakeLinePlugin 相同，只換 channelType */
function fakePlugin(channelType: string) {
  const { plugin, sends } = fakeLinePlugin();
  return { plugin: { ...plugin, channelType }, sends };
}

function run(
  channelType: string,
  env: { db: unknown; redis: unknown; plugin: unknown },
  params: Record<string, unknown> = { couponId: COUPON_ID },
) {
  return executeWorkerAutomationActions(env.db as never, env.redis as never, [{ type: 'issue_coupon', params }], {
    tenantId: TENANT,
    eventId: crypto.randomUUID(),
    ruleId: RULE.id,
    ruleName: RULE.name,
    conversationId: 'conv-1',
    contactId: 'contact-1',
    trigger: 'keyword.matched',
    // FB／IG 的入站訊息沒有回覆權杖
    replyToken: null,
    receivedAt: new Date(Date.now() - 2_000).toISOString(),
    pluginRegistry: new Map([[channelType, env.plugin as never]]),
  });
}

for (const [channelType, scenario] of [
  ['FB', 'Facebook 的關鍵字回覆發券'],
  ['THREADS', 'Instagram 的關鍵字回覆只發券'],
] as const) {
  test(`${scenario}：顧客收到發券訊息與票券連結（push），券確認、發放方式為關鍵字`, async () => {
    const { db, state } = fakeCouponDb({ channelType });
    const { plugin, sends } = fakePlugin(channelType);
    const { redis } = fakeRedis();

    await run(channelType, { db, redis, plugin });

    assert.equal(sends.length, 1, '呼叫渠道外掛送出發券訊息');
    assert.equal(sends[0].contentType, 'text');
    assert.match(String(sends[0].content.text), /為您準備了一張優惠券：秋季九折[\s\S]*https?:\/\//);
    assert.equal(sends[0].content.strategy, 'push', '沒有回覆權杖時以一般傳送送出');
    assert.equal(state.instances.length, 1);
    assert.equal(state.instances[0].deliveryPendingAt, null, '送出成功後確認，不再是發送中');
    assert.equal(state.instances[0].issuedVia, 'keyword');
    assert.equal(state.messages.filter((m) => m.metadata?.couponIssueFailed).length, 0, '沒有發券失敗的紀錄');
    assert.ok(state.messages.some((m) => m.content?.coupon?.instanceId === state.instances[0].id), '對話留下券卡');
  });
}

test('Facebook 顧客已達上限時回覆設定的文字：顧客在 Messenger 收到文字，對話留下 PER_CONTACT_LIMIT_REACHED', async () => {
  const { db, state } = fakeCouponDb({ channelType: 'FB' });
  state.instances.push({
    id: crypto.randomUUID(), tenantId: TENANT, couponId: COUPON_ID, contactId: 'contact-1', code: 'HELD-1',
    status: 'CLAIMED', deliveryPendingAt: null, expiresAt: null,
  });
  const { plugin, sends } = fakePlugin('FB');
  const { redis } = fakeRedis();

  await run('FB', { db, redis, plugin }, { couponId: COUPON_ID, failureText: '您已經領過這張券囉' });

  assert.equal(state.instances.length, 1, '不建立新券');
  assert.deepEqual(sends.map((s) => s.content.text), ['您已經領過這張券囉']);
  assert.equal(sends[0].content.strategy, 'push');
  const notice = state.messages.find((m) => m.metadata?.couponIssueFailed);
  assert.equal(notice?.metadata.couponIssueFailed.reason, 'PER_CONTACT_LIMIT_REACHED');
});
