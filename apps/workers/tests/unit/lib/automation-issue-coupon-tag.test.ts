/**
 * issue_coupon 領券貼標發出 contact.tagged（change outbox-event-delivery：event-delivery「workers 的事件與資料一起 commit」）。
 *
 * 發券與貼標在同一個交易；contact.tagged 也在這個交易寫進 outbox，不再經 Redis domain:event 轉發。
 * 發券、票券連結與送出換成假的；資料庫是記憶體裡的假交易。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add(_name: string, _data: unknown, opts: { jobId?: string }) {
      return { id: opts.jobId };
    }
  },
}));
vi.mock('@open333crm/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  issueInstances: async () => ({ issued: [{ id: 'instance-1' }], skipped: [] }),
  applyCouponClaimTag: async () => ({ tagId: 'tag-1', tagName: '已領券' }),
  issueWalletToken: async () => 'wallet-token',
  couponSourceName: () => '自動化',
  couponLinkUrl: () => 'https://crm.example/coupon/wallet-token',
  couponLiffConfig: () => null,
  buildCouponMessage: () => '您的優惠券',
}));
vi.mock('#src/lib/channel-delivery.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deliverToChannelFromWorker: async () => true,
}));

const { executeWorkerAutomationActions } = await import('#src/lib/automation-actions.js');

const TENANT = 'a0000000-0000-0000-0000-000000000001';

test('issue_coupon 貼上領券標籤：contact.tagged 與發券寫在同一個交易的 outbox，不經 domain:event', async () => {
  const outbox: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const published: string[] = [];
  let inTransaction = false;
  const db: Record<string, unknown> = {
    sideEffectClaim: { createMany: async () => ({ count: 1 }) },
    coupon: { findFirst: async () => ({ id: 'coupon-1', name: '新會員券', status: 'ACTIVE' }) },
    conversation: { findFirst: async () => ({ id: 'conv-1', channelId: 'ch-1', contactId: 'contact-1' }) },
    channelIdentity: { findFirst: async () => ({ id: 'identity-1' }) },
    channel: { findFirst: async () => ({ settings: {} }) },
    outbox: {
      create: async ({ data }: { data: { name: string; payload: Record<string, unknown>; tenantId: string; kind: string } }) => {
        assert.ok(inTransaction, 'contact.tagged 要在發券的交易內寫入');
        const row = { id: crypto.randomUUID(), ...data, queueName: null, jobOptions: null, createdAt: new Date() };
        outbox.push(row);
        return row;
      },
      updateMany: async () => ({ count: 1 }),
    },
  };
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    inTransaction = true;
    try {
      return await fn(db);
    } finally {
      inTransaction = false;
    }
  };
  const redis = { publish: async (channel: string) => (published.push(channel), 1) };

  await executeWorkerAutomationActions(db as never, redis as never, [{ type: 'issue_coupon', params: { couponId: 'coupon-1' } }], {
    tenantId: TENANT,
    eventId: crypto.randomUUID(),
    ruleId: 'rule-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    pluginRegistry: new Map(),
  } as never);

  assert.deepEqual(outbox.map((o) => o.name), ['contact.tagged']);
  assert.deepEqual(outbox[0].payload, { contactId: 'contact-1', tagId: 'tag-1', tagName: '已領券', source: 'system' });
  assert.equal(published.includes('domain:event'), false);
});
