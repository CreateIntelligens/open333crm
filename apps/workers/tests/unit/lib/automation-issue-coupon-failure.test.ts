/**
 * 自動化發券沒有發出時留下看得到的紀錄、可回覆顧客；網站客服的對話不自動發券
 * （add-coupon-system A15 15.5，design D25、D26；spec coupon-management
 * 「自動化發券沒有發出時留下看得到的紀錄」「自動化發券沒有發出時可回覆顧客」「網站客服的對話不自動發券」）。
 *
 * 原本缺券、券非進行中、已達上限、名額或序號用完、找不到渠道身分全部只寫 log 後略過，後台看不到規則有觸發卻沒發。
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

type Env = ReturnType<typeof fakeCouponDb> & ReturnType<typeof fakeLinePlugin> & ReturnType<typeof fakeRedis>;

function setup(opts: Parameters<typeof fakeCouponDb>[0] = {}, plugin: Parameters<typeof fakeLinePlugin>[0] = {}): Env {
  return { ...fakeCouponDb(opts), ...fakeLinePlugin(plugin), ...fakeRedis() };
}

function run(env: Env, params: Record<string, unknown> = { couponId: COUPON_ID }) {
  return executeWorkerAutomationActions(env.db as never, env.redis as never, [{ type: 'issue_coupon', params }], {
    tenantId: TENANT,
    eventId: crypto.randomUUID(),
    ruleId: RULE.id,
    ruleName: RULE.name,
    conversationId: 'conv-1',
    contactId: 'contact-1',
    trigger: 'keyword.matched',
    replyToken: 'reply-token-1',
    receivedAt: new Date(Date.now() - 2_000).toISOString(),
    pluginRegistry: new Map([['LINE', env.plugin]]),
  });
}

/** 已持有一張未使用的券（每人上限 1 張） */
function holdOne(env: Env) {
  env.state.instances.push({
    id: crypto.randomUUID(), tenantId: TENANT, couponId: COUPON_ID, contactId: 'contact-1', code: 'HELD-1',
    status: 'CLAIMED', deliveryPendingAt: null, expiresAt: null,
  });
}

const failureNotices = (env: Env) => env.state.messages.filter((m) => m.metadata?.couponIssueFailed);

test('顧客已達每人上限：不建立新券，對話多一則系統訊息', async () => {
  const env = setup();
  holdOne(env);

  await run(env);

  assert.equal(env.state.instances.length, 1, '不建立新券');
  assert.equal(env.sends.length, 0, '沒有呼叫渠道');
  const [notice] = failureNotices(env);
  assert.equal(notice.senderType, 'SYSTEM');
  assert.deepEqual(notice.content, { text: '規則「秋季領券」沒有發出優惠券「秋季九折」：顧客已達每人領取上限' });
  assert.deepEqual(notice.metadata.couponIssueFailed, {
    ruleId: RULE.id, ruleName: '秋季領券', couponId: COUPON_ID, reason: 'PER_CONTACT_LIMIT_REACHED',
  });
  assert.notEqual(notice.metadata.deliveryFailed, true, '沒有呼叫渠道就決定不發，是灰色提示不是紅色的送出失敗');
  assert.ok(env.events.some((e) => e.event === 'message.new' && e.room === `tenant:${TENANT}`), '即時推送到收件匣');
});

test('券已暫停：不建立新券，原因代碼為 COUPON_INACTIVE', async () => {
  const env = setup({ coupon: { status: 'PAUSED' } });

  await run(env);

  assert.equal(env.state.instances.length, 0);
  assert.equal(failureNotices(env)[0].metadata.couponIssueFailed.reason, 'COUPON_INACTIVE');
});

test('發行總量已發完：不建立新券，原因代碼為 TOTAL_LIMIT_REACHED', async () => {
  const env = setup({ coupon: { totalLimit: 1, perContactLimit: 5 } });
  env.state.instances.push({ id: crypto.randomUUID(), tenantId: TENANT, couponId: COUPON_ID, contactId: 'someone-else', code: 'X', status: 'CLAIMED', deliveryPendingAt: null });

  await run(env);

  assert.equal(env.state.instances.length, 1);
  assert.equal(failureNotices(env)[0].metadata.couponIssueFailed.reason, 'TOTAL_LIMIT_REACHED');
});

test('券已刪除或屬於其他租戶：原因代碼為 COUPON_NOT_FOUND', async () => {
  const env = setup();

  await run(env, { couponId: 'c0000000-0000-4000-8000-0000000000ff' });

  assert.equal(env.state.instances.length, 0);
  assert.equal(failureNotices(env)[0].metadata.couponIssueFailed.reason, 'COUPON_NOT_FOUND');
});

test('找不到渠道身分：原因代碼為 NO_CHANNEL_IDENTITY，不回覆顧客', async () => {
  const env = setup({ noIdentity: true });

  await run({ ...env }, { couponId: COUPON_ID, failureText: '您已經領過這張券囉' });

  assert.equal(env.state.instances.length, 0);
  assert.equal(failureNotices(env)[0].metadata.couponIssueFailed.reason, 'NO_CHANNEL_IDENTITY');
  assert.equal(env.sends.length, 0);
});

test('渠道拒收：系統訊息標示 deliveryFailed、原因代碼 DELIVERY_FAILED、deliveryError 為渠道的錯誤訊息', async () => {
  const env = setup({}, { reject: 'The user has blocked the account' });

  await run(env, { couponId: COUPON_ID, failureText: '您已經領過這張券囉' });

  const [notice] = failureNotices(env);
  assert.equal(notice.metadata.deliveryFailed, true);
  assert.equal(notice.metadata.deliveryError, 'The user has blocked the account');
  assert.equal(notice.metadata.couponIssueFailed.reason, 'DELIVERY_FAILED');
  assert.equal(notice.content.text, '規則「秋季領券」沒有發出優惠券「秋季九折」：渠道拒收');
  assert.ok(env.sends.length > 0);
  assert.ok(env.sends.every((s) => s.content.text !== '您已經領過這張券囉'), '渠道拒收時不送「發不出時回覆顧客」');
  assert.equal(env.state.instances.length, 0);
});

test('已達上限時回覆設定的文字：顧客收到文字（回覆方式），對話也留下沒有發券的系統訊息', async () => {
  const env = setup();
  holdOne(env);

  await run(env, { couponId: COUPON_ID, failureText: '您已經領過這張券囉' });

  assert.equal(env.sends.length, 1);
  assert.equal(env.sends[0].content.text, '您已經領過這張券囉');
  assert.equal(env.sends[0].content.strategy, 'reply');
  assert.equal(failureNotices(env).length, 1);
});

test('沒有設定回覆文字：發行總量已發完時顧客沒有收到任何自動化訊息', async () => {
  const env = setup({ coupon: { totalLimit: 0 } });

  await run(env);

  assert.equal(env.sends.length, 0);
  assert.equal(failureNotices(env)[0].metadata.couponIssueFailed.reason, 'TOTAL_LIMIT_REACHED');
});

test('網站客服的訪客觸發發券規則：不建立任何券，原因代碼為 CHANNEL_NOT_SUPPORTED', async () => {
  const env = setup({ channelType: 'WEBCHAT' });

  await run(env, { couponId: COUPON_ID, failureText: '您已經領過這張券囉' });

  assert.equal(env.state.instances.length, 0, '不建立任何券，已發放張數不變');
  assert.equal(failureNotices(env)[0].metadata.couponIssueFailed.reason, 'CHANNEL_NOT_SUPPORTED');
  assert.equal(env.sends.length, 0);
});
