/**
 * 自動化發券先保留、送出成功才確認（add-coupon-system A15 15.3、15.4、15.7、15.8，design D16、D25、D27；
 * spec coupon-management「自動化發券先保留、送出成功才確認」「自動化發券記錄發券的規則」
 * 「自動化發出的券在收件匣顯示為券卡」「自動化規則編輯器不提供發券動作」）。
 *
 * 原本先在交易內建券（直接已領取）再送訊息，送不出時券留在顧客名下、占用名額，也已貼上領券標籤。
 * 資料庫是記憶體裡的假資料庫，core 的發券、確認、作廢照常執行；渠道是記錄送出內容的假外掛。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { COUPON_ID, RULE, TENANT, fakeCouponDb, fakeLinePlugin, fakeRedis } from '../support/fake-coupon-db.js';

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add(_name: string, _data: unknown, opts?: { jobId?: string }) {
      return { id: opts?.jobId };
    }
  },
}));

const { executeWorkerAutomationActions } = await import('#src/lib/automation-actions.js');

function run(
  env: { db: unknown; redis: unknown; plugin: unknown },
  context: { trigger: string; ruleName?: string; replyToken?: string; receivedAt?: string },
  params: Record<string, unknown> = { couponId: COUPON_ID },
) {
  return executeWorkerAutomationActions(env.db as never, env.redis as never, [{ type: 'issue_coupon', params }], {
    tenantId: TENANT,
    eventId: crypto.randomUUID(),
    ruleId: RULE.id,
    ruleName: context.ruleName ?? RULE.name,
    conversationId: 'conv-1',
    contactId: 'contact-1',
    trigger: context.trigger,
    replyToken: context.replyToken ?? null,
    receivedAt: context.receivedAt ?? null,
    pluginRegistry: new Map([['LINE', env.plugin as never]]),
  });
}

test('自動化發券訊息送不出時券作廢並歸還名額：顧客名下沒有券、序號放回、沒有貼標', async () => {
  const { db, state } = fakeCouponDb({ poolCodes: ['POOL-0001'], claimTag: true });
  const { plugin } = fakeLinePlugin({ reject: 'The user has blocked the account' });
  const { redis } = fakeRedis();

  await run({ db, redis, plugin }, { trigger: 'keyword.matched' });

  assert.equal(state.instances.length, 0, '送不出的券要作廢');
  assert.equal(state.codes[0].status, 'AVAILABLE', '配出的序號放回可配發');
  assert.equal(state.codes[0].instanceId, null);
  assert.equal(state.contactTags.length, 0, '送不出時不貼領券標籤');
  assert.deepEqual(state.outbox.filter((o) => o.name === 'contact.tagged'), []);
});

test('自動化發券送出成功：券不再是發送中、貼上領券標籤、發出 contact.tagged', async () => {
  const { db, state } = fakeCouponDb({ claimTag: true });
  const { plugin, sends } = fakeLinePlugin();
  const { redis } = fakeRedis();

  await run({ db, redis, plugin }, { trigger: 'keyword.matched' });

  assert.equal(sends.length, 1);
  assert.equal(state.instances.length, 1);
  assert.equal(state.instances[0].deliveryPendingAt, null, '確認後不再是發送中，顧客的票券夾看得到');
  assert.equal(state.instances[0].contactId, 'contact-1');
  assert.deepEqual(state.contactTags.map((t) => t.tagId), ['tag-claimed']);
  assert.deepEqual(
    state.outbox.filter((o) => o.name === 'contact.tagged').map((o) => o.payload),
    [{ contactId: 'contact-1', tagId: 'tag-claimed', tagName: '已領秋季券', source: 'system' }],
  );
});

test('送出時券仍在發送中：送出前就有 deliveryPendingAt，不是先發券再送訊息', async () => {
  const { db, state } = fakeCouponDb();
  const pendingAtSend: unknown[] = [];
  const { plugin } = fakeLinePlugin();
  const send = plugin.sendMessage;
  plugin.sendMessage = async (...args) => {
    pendingAtSend.push(state.instances[0]?.deliveryPendingAt ?? null);
    return send(...args);
  };
  const { redis } = fakeRedis();

  await run({ db, redis, plugin }, { trigger: 'keyword.matched' });

  assert.equal(pendingAtSend.length, 1);
  assert.ok(pendingAtSend[0] instanceof Date, '送出當下這張券是發送中');
});

test('既有的發券規則照常執行：收到訊息規則發券，發放方式為「自動化」', async () => {
  const { db, state } = fakeCouponDb();
  const { plugin, sends } = fakeLinePlugin();
  const { redis } = fakeRedis();

  await run({ db, redis, plugin }, { trigger: 'message.received', ruleName: '收到訊息就發券' });

  assert.equal(sends.length, 1);
  assert.equal(state.instances.length, 1);
  assert.equal(state.instances[0].issuedVia, 'automation');
  assert.equal(state.instances[0].issuedSourceName, '收到訊息就發券');
});

test('關鍵字規則發券的歸因：issuedVia 為 keyword、issuedRefId 為規則 id、來源名稱為規則名稱', async () => {
  const { db, state } = fakeCouponDb();
  const { plugin } = fakeLinePlugin();
  const { redis } = fakeRedis();

  await run({ db, redis, plugin }, { trigger: 'keyword.matched' });

  assert.equal(state.instances[0].issuedVia, 'keyword');
  assert.equal(state.instances[0].issuedRefId, RULE.id);
  assert.equal(state.instances[0].issuedSourceName, '秋季領券');
});

test('規則改名後仍顯示當下名稱：來源名稱存發券當下的規則名稱', async () => {
  const { db, state } = fakeCouponDb({ coupon: { perContactLimit: 5 } });
  const { plugin } = fakeLinePlugin();
  const { redis } = fakeRedis();

  await run({ db, redis, plugin }, { trigger: 'keyword.matched', ruleName: '秋季領券' });
  await run({ db, redis, plugin }, { trigger: 'keyword.matched', ruleName: '冬季領券' });

  assert.deepEqual(state.instances.map((i) => i.issuedSourceName), ['秋季領券', '冬季領券']);
});

test('收件匣顯示自動化發出的券卡：對話訊息帶 content.coupon 與規則名稱', async () => {
  const { db, state } = fakeCouponDb();
  const { plugin, sends } = fakeLinePlugin();
  const { redis, events } = fakeRedis();

  await run({ db, redis, plugin }, { trigger: 'keyword.matched' });

  assert.equal(state.messages.length, 1);
  const message = state.messages[0];
  assert.equal(message.senderType, 'SYSTEM');
  assert.equal(message.direction, 'OUTBOUND');
  assert.equal(message.content.text, sends[0].content.text, '對話紀錄的文字就是送給顧客的文字');
  assert.equal(message.content.coupon.instanceId, state.instances[0].id);
  assert.equal(message.content.coupon.couponId, COUPON_ID);
  assert.equal(message.content.coupon.name, '秋季九折');
  assert.equal(message.content.coupon.discountPercent, 10);
  assert.deepEqual(message.metadata, { source: 'automation', ruleId: RULE.id, ruleName: '秋季領券' });
  const newMessage = events.filter((e) => e.event === 'message.new');
  assert.deepEqual(newMessage.map((e) => e.room).sort(), ['conversation:conv-1', `tenant:${TENANT}`]);
  assert.equal(newMessage[0].data.message.content.coupon.instanceId, state.instances[0].id);
});

test('已發優惠券區塊即時更新：確認後推 coupon.instance.updated 到租戶房間', async () => {
  const { db, state } = fakeCouponDb();
  const { plugin } = fakeLinePlugin();
  const { redis, events } = fakeRedis();

  await run({ db, redis, plugin }, { trigger: 'keyword.matched' });

  assert.deepEqual(
    events.filter((e) => e.event === 'coupon.instance.updated'),
    [{ room: `tenant:${TENANT}`, event: 'coupon.instance.updated', data: { instanceId: state.instances[0].id, contactId: 'contact-1', change: 'issued' } }],
  );
});

test('送不出時不推 coupon.instance.updated', async () => {
  const { db } = fakeCouponDb();
  const { plugin } = fakeLinePlugin({ reject: 'blocked' });
  const { redis, events } = fakeRedis();

  await run({ db, redis, plugin }, { trigger: 'keyword.matched' });

  assert.deepEqual(events.filter((e) => e.event === 'coupon.instance.updated'), []);
});
