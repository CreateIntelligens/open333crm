/**
 * 自動化送出失敗要讓使用者看得到（#362 #11、#12）。
 *
 * - 送出失敗的紀錄要像送出成功一樣更新對話的 lastMessageAt，對話才會浮到收件匣上方；
 *   原本只寫訊息與推 socket，重新整理後對話仍排在舊位置，客服找不到這則失敗。
 * - 渠道已停用但對話還在時，原本只寫 log；現在寫成對話中的失敗紀錄（發券不重複寫）。
 * - 對話不存在時沒有地方寫訊息：send_message／send_material 把動作標成失敗，
 *   寫一筆規則執行紀錄（automation_logs）記下原因，而不是忽略回傳值。
 *
 * 走真的入口 executeWorkerAutomationActions；資料庫是記憶體假資料庫，core 的發券流程照常執行。
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

type Row = Record<string, any>;

/** 假資料庫補上規則執行紀錄、素材與聯絡人查詢（共用的 fake-coupon-db 沒有） */
function env(opts: Parameters<typeof fakeCouponDb>[0] = {}) {
  const { db, state } = fakeCouponDb(opts);
  const logs: Row[] = [];
  db.automationLog = {
    async create({ data }: { data: Row }) {
      logs.push(data);
      return { id: crypto.randomUUID(), ...data };
    },
  };
  db.material = {
    async findFirst({ where }: { where: Row }) {
      return where.id === 'material-1' && where.tenantId === TENANT
        ? { name: '歡迎素材', contentType: 'line_text', body: { text: '歡迎' }, channelType: 'line', variables: [] }
        : null;
    },
  };
  // 素材變數代入會查聯絡人
  db.contact.findFirst = async () => ({ displayName: '王小明', phone: null, email: null, attributes: [] });
  return { db, state, logs };
}

function run(
  db: unknown,
  redis: unknown,
  plugin: unknown,
  actions: Array<{ type: string; params: Record<string, unknown> }>,
  conversationId = 'conv-1',
) {
  return executeWorkerAutomationActions(db as never, redis as never, actions, {
    tenantId: TENANT,
    eventId: crypto.randomUUID(),
    ruleId: RULE.id,
    ruleName: RULE.name,
    conversationId,
    contactId: 'contact-1',
    trigger: 'keyword.matched',
    pluginRegistry: new Map([['LINE', plugin as never]]),
  });
}

test('傳送訊息被渠道拒收：失敗紀錄更新對話的最後訊息時間', async () => {
  const { db, state } = env();
  const { plugin } = fakeLinePlugin({ reject: 'The user has blocked the account' });
  const { redis, events } = fakeRedis();

  await run(db, redis, plugin, [{ type: 'send_message', params: { text: '您好' } }]);

  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].metadata.deliveryFailed, true);
  assert.ok(state.conversations[0].lastMessageAt instanceof Date, '失敗紀錄要更新 lastMessageAt');
  assert.equal(state.conversations[0].lastMessageAt.getTime(), state.messages[0].createdAt.getTime());
  const pushed = events.find((e) => e.event === 'message.new');
  assert.equal(pushed?.data.message.createdAt, state.messages[0].createdAt.toISOString(), 'socket 推送的時間與 lastMessageAt 一致');
});

test('渠道已停用但對話還在：傳送訊息寫成對話中的失敗紀錄並更新最後訊息時間', async () => {
  const { db, state, logs } = env();
  state.channels[0].isActive = false;
  const { plugin, sends } = fakeLinePlugin();
  const { redis } = fakeRedis();

  await run(db, redis, plugin, [{ type: 'send_message', params: { text: '您好' } }]);

  assert.equal(sends.length, 0, '停用的渠道不送出');
  assert.equal(state.messages.length, 1, '原本只寫 log，對話中看不到');
  assert.equal(state.messages[0].metadata.deliveryFailed, true);
  assert.match(state.messages[0].metadata.deliveryError, /渠道已停用/);
  assert.ok(state.conversations[0].lastMessageAt instanceof Date);
  assert.equal(logs.length, 1, '動作失敗也寫進規則執行紀錄');
  assert.equal(logs[0].success, false);
});

test('對話不存在：傳送訊息標成失敗並寫進規則執行紀錄', async () => {
  const { db, state, logs } = env();
  const { plugin, sends } = fakeLinePlugin();
  const { redis } = fakeRedis();

  const outcomes = await run(db, redis, plugin, [{ type: 'send_message', params: { text: '您好' } }], 'conv-missing');

  assert.equal(sends.length, 0);
  assert.equal(state.messages.length, 0, '沒有對話可以寫訊息');
  assert.equal(logs.length, 1, '原本完全忽略回傳值，沒有任何紀錄');
  assert.equal(logs[0].tenantId, TENANT);
  assert.equal(logs[0].ruleId, RULE.id);
  assert.equal(logs[0].success, false);
  assert.match(logs[0].errorMsg, /找不到對話/);
  assert.deepEqual(logs[0].actionsRan, [{ index: 0, type: 'send_message', status: 'failed', error: '找不到對話' }]);
  assert.deepEqual(outcomes, logs[0].actionsRan, '回傳值與紀錄相同');
});

test('對話不存在：傳送素材標成失敗並寫進規則執行紀錄', async () => {
  const { db, logs } = env();
  const { plugin, sends } = fakeLinePlugin();
  const { redis } = fakeRedis();

  await run(db, redis, plugin, [{ type: 'send_material', params: { materialId: 'material-1' } }], 'conv-missing');

  assert.equal(sends.length, 0);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].success, false);
  assert.deepEqual(logs[0].actionsRan, [{ index: 0, type: 'send_material', status: 'failed', error: '找不到對話' }]);
});

test('動作都成功時不寫失敗紀錄', async () => {
  const { db, logs } = env();
  const { plugin, sends } = fakeLinePlugin();
  const { redis } = fakeRedis();

  const outcomes = await run(db, redis, plugin, [
    { type: 'send_message', params: { text: '您好' } },
    { type: 'send_material', params: { materialId: 'material-1' } },
  ]);

  assert.equal(sends.length, 2);
  assert.equal(logs.length, 0);
  assert.deepEqual(outcomes.map((o) => o.status), ['ok', 'ok']);
});

test('渠道已停用時自動化發券只留一則失敗紀錄，並更新最後訊息時間', async () => {
  const { db, state } = env();
  state.channels[0].isActive = false;
  const { plugin, sends } = fakeLinePlugin();
  const { redis } = fakeRedis();

  await run(db, redis, plugin, [{ type: 'issue_coupon', params: { couponId: COUPON_ID } }]);

  assert.equal(sends.length, 0);
  assert.equal(state.instances.length, 0, '送不出的券要作廢');
  assert.equal(state.messages.length, 1, '送出層已寫紀錄，發券不可再寫一則');
  assert.equal(state.messages[0].metadata.deliveryFailed, true);
  assert.ok(state.messages[0].metadata.couponIssueFailed, '紀錄仍是發券的失敗內容');
  assert.ok(state.conversations[0].lastMessageAt instanceof Date);
});

test('發券產生票券連結失敗：失敗紀錄更新最後訊息時間', async () => {
  const { db, state } = env();
  const { plugin, sends } = fakeLinePlugin();
  const { redis } = fakeRedis();
  redis.set = async () => {
    throw new Error('redis down');
  };

  await run(db, redis, plugin, [{ type: 'issue_coupon', params: { couponId: COUPON_ID } }]);

  assert.equal(sends.length, 0);
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].metadata.deliveryFailed, true);
  assert.ok(state.conversations[0].lastMessageAt instanceof Date, 'recordFailureNotice 也要更新 lastMessageAt');
  assert.equal(state.conversations[0].lastMessageAt.getTime(), state.messages[0].createdAt.getTime());
});
