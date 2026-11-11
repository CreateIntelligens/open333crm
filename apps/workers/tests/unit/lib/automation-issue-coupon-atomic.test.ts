/**
 * 自動化發券的確認交易是原子的（add-coupon-system design D16；PR #364 審查第 15 項）。
 *
 * 確認交易內先清除發送中、貼標並寫 outbox，再寫券卡訊息；寫訊息失敗時整個交易回滾：
 * 不留下 contact.tagged 事件，券仍在發送中（交給排程作廢）。測試用的假資料庫交易失敗時會還原，
 * 才驗證得到這件事。
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

test('寫入券卡訊息失敗時，確認交易整個回滾', async () => {
  const { db, state } = fakeCouponDb({ claimTag: true });
  const create = db.message.create;
  db.message.create = async (args: { data: { content?: { coupon?: unknown } } }) => {
    if (args.data.content?.coupon) throw new Error('寫入訊息失敗');
    return create(args);
  };
  const { plugin } = fakeLinePlugin();
  const { redis } = fakeRedis();

  await executeWorkerAutomationActions(db as never, redis as never, [{ type: 'issue_coupon', params: { couponId: COUPON_ID } }], {
    tenantId: TENANT,
    eventId: crypto.randomUUID(),
    ruleId: RULE.id,
    ruleName: RULE.name,
    conversationId: 'conv-1',
    contactId: 'contact-1',
    trigger: 'keyword.matched',
    pluginRegistry: new Map([['LINE', plugin]]),
  }).catch(() => undefined);

  assert.equal(state.outbox.length, 0, '沒有留下 contact.tagged 事件');
  assert.equal(state.contactTags.length, 0, '沒有貼標');
  assert.equal(state.instances.length, 1);
  assert.ok(state.instances[0].deliveryPendingAt, '券仍在發送中，交給排程作廢');
});

test('假資料庫：帶 tenantId 的 findUnique 不回傳其他租戶的對話', async () => {
  const { db } = fakeCouponDb();
  assert.ok(await db.conversation.findUnique({ where: { id: 'conv-1' } }));
  assert.equal(await db.conversation.findUnique({ where: { id: 'conv-1', tenantId: 'other-tenant' } }), null);
});
