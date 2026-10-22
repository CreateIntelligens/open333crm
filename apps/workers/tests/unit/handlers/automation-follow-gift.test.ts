/**
 * 加好友禮（add-coupon-system A15 15.14；design D28；spec coupon-management「加好友禮」、
 * automation-engine「加入好友事件」）。
 *
 * 走真正的 handleAutomationJob → 規則評估 → executeWorkerAutomationActions → issueCouponForRule，
 * 資料庫是記憶體版（fake-coupon-db），渠道外掛記錄送出的內容。
 * 加好友禮頁存的規則：事件 contact.followed、條件「第一次加入等於是」與「對話渠道等於 LINE」、動作 issue_coupon。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { COUPON_ID, TENANT, fakeCouponDb, fakeLinePlugin, fakeRedis } from '../support/fake-coupon-db.js';

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add() {
      return {};
    }
  },
}));

const { handleAutomationJob } = await import('#src/handlers/automation.handler.js');

const FOLLOW_GIFT_RULE = {
  id: 'r0000000-0000-4000-8000-0000000000f1',
  name: '加好友禮',
  priority: 0,
  stopOnMatch: false,
  eventType: 'contact.followed',
  trigger: { type: 'contact.followed' },
  conditions: {
    all: [
      { fact: 'follow.isFirst', operator: 'equal', value: true },
      { fact: 'conversation.channelType', operator: 'equal', value: 'LINE' },
    ],
  },
  actions: [{ type: 'issue_coupon', params: { couponId: COUPON_ID } }],
};

function setup(rules: Array<Record<string, unknown>> = [FOLLOW_GIFT_RULE]) {
  const { db, state } = fakeCouponDb();
  db.automationRule = {
    findMany: async ({ where }: { where: { tenantId: string; eventType: string } }) =>
      where.tenantId === TENANT ? rules.filter((r) => r.eventType === where.eventType) : [],
  };
  db.contact.findFirst = async () => ({ displayName: '新朋友', language: 'zh-TW', tags: [], channelIdentities: [{ channelType: 'LINE' }] });
  db.case = { findFirst: async () => null, count: async () => 0 };
  const { plugin, sends } = fakeLinePlugin();
  const { redis } = fakeRedis();
  return { db, state, plugin, sends, redis };
}

async function follow(s: ReturnType<typeof setup>, context: Record<string, unknown>) {
  await handleAutomationJob(
    {
      data: {
        tenantId: TENANT,
        eventId: crypto.randomUUID(),
        trigger: 'contact.followed',
        context: {
          conversationId: 'conv-1',
          contactId: 'contact-1',
          channelType: 'LINE',
          replyToken: 'reply-token-follow',
          receivedAt: new Date(Date.now() - 2_000).toISOString(),
          ...context,
        },
      },
    } as never,
    s.db as never,
    s.redis as never,
    new Map([['LINE', s.plugin]]),
  );
}

test('新好友收到加好友禮：以回覆方式送出帶票券連結的發券訊息，發放方式為「加好友」', async () => {
  const s = setup();
  await follow(s, { isFirstFollow: true });

  assert.equal(s.state.instances.length, 1);
  const instance = s.state.instances[0]!;
  assert.equal(instance.issuedVia, 'follow');
  assert.equal(instance.issuedRefId, FOLLOW_GIFT_RULE.id);
  assert.equal(instance.deliveryPendingAt, null, '送出成功後確認');
  assert.equal(s.sends.length, 1);
  assert.equal(s.sends[0]!.content.strategy, 'reply');
  assert.equal(s.sends[0]!.content.replyToken, 'reply-token-follow');
});

test('封鎖後再加入不發券：不發券，也不留下沒有發券的系統訊息', async () => {
  const s = setup();
  await follow(s, { isFirstFollow: false });
  assert.equal(s.state.instances.length, 0);
  assert.equal(s.sends.length, 0);
  assert.equal(s.state.messages.length, 0);
});

test('上線前就是好友的顧客再加入：API 判斷不是第一次（回填的加入時間），不發券', async () => {
  const s = setup();
  // 回填了 firstFollowedAt 的身分，webhook 送出的「第一次加入」為否
  await follow(s, { isFirstFollow: false });
  assert.equal(s.state.instances.length, 0);
  assert.equal(s.sends.length, 0);
});

test('沒有「第一次加入」資訊的事件不發券（fail-closed）', async () => {
  const s = setup();
  await follow(s, {});
  assert.equal(s.state.instances.length, 0);
});

test('加好友觸發規則：事件為「加入好友」、動作為傳送訊息的規則以回覆方式送出', async () => {
  const s = setup([
    {
      id: 'r-welcome',
      name: '歡迎',
      priority: 0,
      stopOnMatch: false,
      eventType: 'contact.followed',
      trigger: { type: 'contact.followed' },
      conditions: { all: [] },
      actions: [{ type: 'send_message', params: { text: '歡迎加入' } }],
    },
  ]);
  await follow(s, { isFirstFollow: false });
  assert.equal(s.sends.length, 1);
  assert.equal(s.sends[0]!.content.text, '歡迎加入');
  assert.equal(s.sends[0]!.content.strategy, 'reply');
});
