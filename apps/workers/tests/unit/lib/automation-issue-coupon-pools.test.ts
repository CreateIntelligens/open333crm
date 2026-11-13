/**
 * 兩張券、兩個序號包同時存在時的自動化發券（#362 A7、D13）。
 *
 * 記憶體資料庫原本忽略序號的 couponId、券的 status／OR／expiresAt 條件與 outbox 的送出標記，
 * 只放一張券時測不出「歸還到別張券的序號包」「過期的券也算進每人上限」這類錯誤。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, vi } from 'vitest';
import type { ChannelPlugin } from '@open333crm/channel-plugins';
import { COUPON_ID, RULE, TENANT, fakeCouponDb, fakeLinePlugin, fakeRedis } from '../support/fake-coupon-db.js';

// outbox 的 job id 與列 id 相同才算送出（dispatchOutboxRows），這裡讓 Queue.add 回傳帶入的 jobId
vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add(_name: string, _data: unknown, opts?: { jobId?: string }) {
      return { id: opts?.jobId };
    }
  },
}));

const { executeWorkerAutomationActions } = await import('#src/lib/automation-actions.js');

const OTHER_COUPON = 'c0000000-0000-4000-8000-0000000000b2';

type Env = ReturnType<typeof fakeCouponDb> & { plugin: ChannelPlugin } & ReturnType<typeof fakeRedis>;

function run(env: Env) {
  return executeWorkerAutomationActions(env.db as never, env.redis as never, [{ type: 'issue_coupon', params: { couponId: COUPON_ID } }], {
    tenantId: TENANT,
    eventId: randomUUID(),
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

/** 加上第二張券與它的序號包 */
function addOtherPool(env: ReturnType<typeof fakeCouponDb>, codes: Array<{ code: string; status: string; instanceId: string | null }>) {
  env.state.coupons.push({ ...env.state.coupons[0], id: OTHER_COUPON, name: '冬季九折' });
  for (const c of codes) {
    env.state.codes.push({ id: randomUUID(), tenantId: TENANT, couponId: OTHER_COUPON, createdAt: new Date(), ...c });
  }
}

test('送出失敗作廢時只歸還這張券序號包的序號，別張券已指派的序號不動', async () => {
  const db = fakeCouponDb({ poolCodes: ['AUT-0001'] });
  addOtherPool(db, [{ code: 'WIN-0001', status: 'ASSIGNED', instanceId: null }]);
  // 送出當下把別張券的序號錯置成指向這張發送中的券，模擬資料不一致
  const plugin: ChannelPlugin = {
    ...fakeLinePlugin().plugin,
    sendMessage: async () => {
      const pendingInstance = db.state.instances.find((i) => i.deliveryPendingAt != null)!;
      db.state.codes.find((c) => c.code === 'WIN-0001')!.instanceId = pendingInstance.id;
      return { success: false, error: 'blocked' };
    },
  };
  const env: Env = { ...db, plugin, ...fakeRedis() };

  await run(env);

  assert.equal(env.state.instances.length, 0, '送不出的券作廢');
  const mine = env.state.codes.find((c) => c.code === 'AUT-0001')!;
  assert.deepEqual([mine.status, mine.instanceId], ['AVAILABLE', null], '這張券的序號回到庫存');
  const other = env.state.codes.find((c) => c.code === 'WIN-0001')!;
  assert.equal(other.status, 'ASSIGNED', '別張券的序號不可被放回庫存');
});

test('每人上限只算這張券仍有效的券：過期未使用的券不算，別張券不算', async () => {
  const db = fakeCouponDb({ poolCodes: ['AUT-0001'] });
  addOtherPool(db, [{ code: 'WIN-0001', status: 'ASSIGNED', instanceId: null }]);
  const past = new Date(Date.now() - 86_400_000);
  db.state.instances.push(
    // 這張券、已過期未使用
    { id: randomUUID(), tenantId: TENANT, couponId: COUPON_ID, contactId: 'contact-1', code: 'OLD-1', status: 'ISSUED', deliveryPendingAt: null, expiresAt: past },
    // 別張券、仍有效
    { id: randomUUID(), tenantId: TENANT, couponId: OTHER_COUPON, contactId: 'contact-1', code: 'WIN-0001', status: 'CLAIMED', deliveryPendingAt: null, expiresAt: null },
  );
  const env: Env = { ...db, ...fakeLinePlugin(), ...fakeRedis() };

  await run(env);

  const issued = env.state.instances.filter((i) => i.couponId === COUPON_ID && i.code === 'AUT-0001');
  assert.equal(issued.length, 1, '應發出新券');
  assert.equal(issued[0].deliveryPendingAt, null, '送出成功後確認');
});

test('每人上限：這張券仍有效的券算進上限', async () => {
  const db = fakeCouponDb({ poolCodes: ['AUT-0001'] });
  const future = new Date(Date.now() + 86_400_000);
  db.state.instances.push(
    { id: randomUUID(), tenantId: TENANT, couponId: COUPON_ID, contactId: 'contact-1', code: 'HELD-1', status: 'OPENED', deliveryPendingAt: null, expiresAt: future },
  );
  const env: Env = { ...db, ...fakeLinePlugin(), ...fakeRedis() };

  await run(env);

  assert.equal(env.state.instances.length, 1, '不建立新券');
  assert.equal(env.state.codes[0].status, 'AVAILABLE', '序號沒有被取用');
});

test('outbox 送出後只標記這次送出的列', async () => {
  const db = fakeCouponDb({ poolCodes: ['AUT-0001'], claimTag: true });
  const untouched = { id: randomUUID(), tenantId: TENANT, kind: 'event', name: 'other.event', payload: {}, dispatchedAt: null, createdAt: new Date() };
  db.state.outbox.push(untouched);
  const env: Env = { ...db, ...fakeLinePlugin(), ...fakeRedis() };

  await run(env);

  const written = env.state.outbox.filter((r) => r !== untouched);
  assert.ok(written.length > 0, '發券應寫 outbox');
  for (const r of written) assert.ok(r.dispatchedAt instanceof Date, `${r.name} 應標記為已送出`);
  assert.equal(untouched.dispatchedAt, null, '不在這次清單內的列不標記');
});
