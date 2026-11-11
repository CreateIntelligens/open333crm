/**
 * issue_coupon 領券貼標發出 contact.tagged（change outbox-event-delivery：event-delivery「workers 的事件與資料一起 commit」）。
 *
 * add-coupon-system design D16、D25 起，貼標改在送出成功後的確認交易內（原本在發券的交易內，
 * 送不出的券也被貼標）；contact.tagged 仍與貼標寫在同一個交易的 outbox，不經 Redis domain:event 轉發。
 * 資料庫是記憶體裡的假資料庫，渠道是假外掛。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { COUPON_ID, RULE, TENANT, fakeCouponDb, fakeLinePlugin, fakeRedis } from '../support/fake-coupon-db.js';

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add(_name: string, _data: unknown, opts: { jobId?: string }) {
      return { id: opts?.jobId };
    }
  },
}));

const { executeWorkerAutomationActions } = await import('#src/lib/automation-actions.js');

test('issue_coupon 貼上領券標籤：contact.tagged 與貼標寫在同一個交易的 outbox，不經 domain:event', async () => {
  const { db, state } = fakeCouponDb({ claimTag: true });
  let inTransaction = false;
  const tagWrittenInTx: boolean[] = [];
  const outboxCreate = db.outbox.create;
  db.outbox.create = async (args: unknown) => {
    tagWrittenInTx.push(inTransaction);
    return outboxCreate(args);
  };
  const transaction = db.$transaction;
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    inTransaction = true;
    try {
      return await transaction(fn);
    } finally {
      inTransaction = false;
    }
  };
  const { plugin } = fakeLinePlugin();
  const { redis } = fakeRedis();
  const published: string[] = [];
  const publish = redis.publish;
  redis.publish = async (channel: string, payload: string) => (published.push(channel), publish(channel, payload));

  await executeWorkerAutomationActions(db as never, redis as never, [{ type: 'issue_coupon', params: { couponId: COUPON_ID } }], {
    tenantId: TENANT,
    eventId: crypto.randomUUID(),
    ruleId: RULE.id,
    ruleName: RULE.name,
    conversationId: 'conv-1',
    contactId: 'contact-1',
    trigger: 'keyword.matched',
    pluginRegistry: new Map([['LINE', plugin]]),
  });

  const tagged = state.outbox.filter((o) => o.name === 'contact.tagged');
  assert.deepEqual(tagged.map((o) => o.payload), [{ contactId: 'contact-1', tagId: 'tag-claimed', tagName: '已領秋季券', source: 'system' }]);
  assert.ok(tagWrittenInTx.every(Boolean), 'contact.tagged 要在交易內寫入');
  assert.equal(published.includes('domain:event'), false);
});
