/**
 * 自動化發券的收券人以對話的聯絡人為準（PR #364 審查第 14 項）。
 *
 * 訊息送到對話的聯絡人；事件帶的 contactId 可能已過期（例如事件排入後聯絡人被合併，對話搬到保留的聯絡人）。
 * 原本券、票券連結與標籤用事件的 contactId，訊息卻送給對話的聯絡人，兩者可能不是同一個人。
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

test('事件的聯絡人與對話的聯絡人不同時，券發給對話的聯絡人', async () => {
  const env = { ...fakeCouponDb(), ...fakeLinePlugin(), ...fakeRedis() };
  // 另一位在同一個渠道也有身分的聯絡人（事件帶的是他的 id）
  env.state.contacts.push({ id: 'contact-2', tenantId: TENANT });
  env.state.identities.push({ id: 'identity-2', contactId: 'contact-2', channelId: 'channel-1', uid: 'line-user-2' });

  await executeWorkerAutomationActions(env.db as never, env.redis as never, [{ type: 'issue_coupon', params: { couponId: COUPON_ID } }], {
    tenantId: TENANT,
    eventId: crypto.randomUUID(),
    ruleId: RULE.id,
    ruleName: RULE.name,
    conversationId: 'conv-1',
    contactId: 'contact-2',
    trigger: 'keyword.matched',
    pluginRegistry: new Map([['LINE', env.plugin]]),
  });

  assert.equal(env.sends.length, 1, '訊息送出一次');
  assert.equal(env.state.instances.length, 1);
  assert.equal(env.state.instances[0].contactId, 'contact-1', '券歸給收到訊息的對話聯絡人');
});
