/**
 * inTenant()：入口開一個綁定租戶的交易，推播、事件與佇列 job 在 commit 之後才送出
 * （change tenant-transaction-context，主規格 tenant-transaction-context）。
 *
 * 用 mock 的 prisma.$transaction 模擬交易：callback resolve 之後才算 commit。
 * 「寫入一起 rollback」「只看得到綁定租戶」要真實的 RLS，見 tests/feature/lib/tenant-ctx.test.ts。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import { inTenant, type TenantCtxDeps } from '#src/lib/tenant-ctx.js';
import type { AppEvent } from '#src/events/event-bus.js';

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const AGENT_ID = 'c0000000-0000-0000-0000-000000000003';

/** 依發生順序記錄推播、事件、job 與交易內的步驟 */
let log: string[] = [];
const received: AppEvent[] = [];

afterEach(() => {
  log = [];
  received.length = 0;
});

const events: TenantCtxDeps['events'] = {
  publish(event) {
    received.push(event);
    log.push(`publish:${event.name}`);
  },
};

function createIo() {
  return {
    to(room: string) {
      return {
        emit(event: string) {
          log.push(`push:${room}:${event}`);
        },
      };
    },
  };
}

function createQueue(opts: { fail?: boolean } = {}) {
  return {
    async add(name: string) {
      if (opts.fail) throw new Error(`add ${name} failed`);
      log.push(`add:${name}`);
    },
  } as never;
}

/** callback 完成後才「commit」；commitError 模擬 COMMIT 本身失敗 */
function createPrisma(opts: { commitError?: Error } = {}) {
  const tx = { $executeRaw: async () => 1 };
  const prisma = {
    async $transaction(cb: (t: typeof tx) => Promise<unknown>) {
      const result = await cb(tx);
      if (opts.commitError) throw opts.commitError;
      log.push('commit');
      return result;
    },
  };
  return prisma as never;
}

function deps(opts: { commitError?: Error; noIo?: boolean } = {}): TenantCtxDeps {
  return {
    prisma: createPrisma(opts),
    io: opts.noIo ? undefined : (createIo() as never),
    events,
  };
}

test('不合法的租戶 ID：丟出錯誤，交易內的程式不執行', async () => {
  let ran = false;
  await assert.rejects(
    inTenant(deps(), 'not-a-uuid', async () => {
      ran = true;
    }),
  );
  assert.equal(ran, false);
});

test('commit 之前不送出', async () => {
  await inTenant(deps(), TENANT_ID, async (ctx) => {
    ctx.notify('case.updated', {});
    ctx.publish('case.resolved', {});
    ctx.enqueue(createQueue(), 'job-1', {});
    log.push('fn-end');
  });
  assert.deepEqual(log, [
    'fn-end',
    'commit',
    `push:tenant:${TENANT_ID}:case.updated`,
    'publish:case.resolved',
    'add:job-1',
  ]);
});

test('commit 之後依登記順序送出', async () => {
  await inTenant(deps(), TENANT_ID, async (ctx) => {
    ctx.notify('case.created', {});
    ctx.publish('case.created', {});
    ctx.enqueue(createQueue(), 'job-1', {});
    ctx.notify('case.updated', {});
  });
  assert.deepEqual(log, [
    'commit',
    `push:tenant:${TENANT_ID}:case.created`,
    'publish:case.created',
    'add:job-1',
    `push:tenant:${TENANT_ID}:case.updated`,
  ]);
});

test('rollback 時全部丟棄，呼叫端收到原本的錯誤', async () => {
  const boom = new Error('boom');
  await assert.rejects(
    inTenant(deps(), TENANT_ID, async (ctx) => {
      ctx.notify('case.updated', {});
      ctx.publish('case.created', {});
      ctx.enqueue(createQueue(), 'job-1', {});
      throw boom;
    }),
    (err) => err === boom,
  );
  assert.deepEqual(log, []);
});

test('commit 失敗時全部丟棄', async () => {
  const commitError = new Error('commit failed');
  await assert.rejects(
    inTenant(deps({ commitError }), TENANT_ID, async (ctx) => {
      ctx.notify('case.updated', {});
      ctx.publish('case.created', {});
      ctx.enqueue(createQueue(), 'job-1', {});
    }),
    (err) => err === commitError,
  );
  assert.deepEqual(log, []);
});

test('一項送出失敗不影響其他項，呼叫端收到回傳值', async () => {
  const result = await inTenant(deps(), TENANT_ID, async (ctx) => {
    ctx.enqueue(createQueue({ fail: true }), 'job-1', {});
    ctx.publish('case.created', {});
    ctx.notify('case.updated', {});
    return 'done';
  });
  assert.equal(result, 'done');
  assert.deepEqual(log, ['commit', 'publish:case.created', `push:tenant:${TENANT_ID}:case.updated`]);
});

test('全租戶推播：只送到交易綁定租戶的房間', async () => {
  await inTenant(deps(), TENANT_ID, async (ctx) => {
    ctx.notify('case.updated', { caseId: 'c1' });
  });
  assert.deepEqual(log, ['commit', `push:tenant:${TENANT_ID}:case.updated`]);
});

test('給客服人員的推播：只送到帶租戶 ID 的該客服人員房間', async () => {
  await inTenant(deps(), TENANT_ID, async (ctx) => {
    ctx.notifyAgent(AGENT_ID, 'notification.new', { id: 'n1' });
  });
  assert.deepEqual(log, ['commit', `push:tenant:${TENANT_ID}:agent:${AGENT_ID}:notification.new`]);
});

test('給客服人員的推播用了別的租戶的客服人員 ID：房間仍是交易綁定的租戶', async () => {
  // 客服人員 Y 屬於租戶 B，連線只加入 tenant:B:agent:Y（socket-room-handlers），收不到這則推播
  const agentOfOtherTenant = 'd0000000-0000-0000-0000-000000000004';
  await inTenant(deps(), TENANT_ID, async (ctx) => {
    ctx.notifyAgent(agentOfOtherTenant, 'notification.new', {});
  });
  assert.deepEqual(log, ['commit', `push:tenant:${TENANT_ID}:agent:${agentOfOtherTenant}:notification.new`]);
});

test('佇列沒有回應時不阻擋回傳', async () => {
  const hanging = { add: () => new Promise(() => {}) } as never;
  const result = await Promise.race([
    inTenant(deps(), TENANT_ID, async (ctx) => {
      ctx.enqueue(hanging, 'job-1', {});
      ctx.notify('case.updated', {});
      return 'done';
    }),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 500)),
  ]);
  assert.equal(result, 'done');
  assert.deepEqual(log, ['commit', `push:tenant:${TENANT_ID}:case.updated`]);
});

test('事件不重複送出', async () => {
  await inTenant(deps(), TENANT_ID, async (ctx) => {
    ctx.publish('case.resolved', { caseId: 'c1' });
  });
  assert.equal(received.length, 1);
});

test('publish 交給注入的 events，事件帶交易綁定的 tenantId 與時間', async () => {
  await inTenant(deps(), TENANT_ID, async (ctx) => {
    ctx.publish('case.resolved', { caseId: 'c1' });
  });
  assert.equal(received[0].tenantId, TENANT_ID);
  assert.equal(received[0].name, 'case.resolved');
  assert.deepEqual(received[0].payload, { caseId: 'c1' });
  assert.ok(received[0].timestamp instanceof Date);
});

test('enqueue 把名稱、資料與選項交給呼叫端的佇列', async () => {
  const calls: unknown[][] = [];
  const queue = {
    async add(...args: unknown[]) {
      calls.push(args);
    },
  } as never;
  await inTenant(deps(), TENANT_ID, async (ctx) => {
    ctx.enqueue(queue, 'data-export:generate', { requestId: 'r1' }, { jobId: 'r1' });
  });
  assert.deepEqual(calls, [['data-export:generate', { requestId: 'r1' }, { jobId: 'r1' }]]);
});

test('沒有 io 時呼叫 notify：在交易內丟錯，交易 rollback', async () => {
  await assert.rejects(
    inTenant(deps({ noIo: true }), TENANT_ID, async (ctx) => {
      ctx.publish('case.created', {});
      ctx.notify('case.updated', {});
    }),
  );
  assert.deepEqual(log, []);
});

test('沒有 io 時呼叫 notifyAgent：在交易內丟錯，交易 rollback', async () => {
  await assert.rejects(
    inTenant(deps({ noIo: true }), TENANT_ID, async (ctx) => {
      ctx.notifyAgent(AGENT_ID, 'notification.new', {});
    }),
  );
  assert.deepEqual(log, []);
});

test('ctx 帶交易與綁定的 tenantId', async () => {
  await inTenant(deps(), TENANT_ID, async (ctx) => {
    assert.equal(ctx.tenantId, TENANT_ID);
    assert.equal(typeof ctx.tx.$executeRaw, 'function');
  });
});

test('createMockTenantCtx：依呼叫順序記錄推播（含房間）、事件與 job', async () => {
  const { createMockTenantCtx } = await import('#tests/support/mock-tenant-ctx.js');
  const tx = { contact: {} };
  const queue = createQueue();
  const { ctx, pushed, published, enqueued } = createMockTenantCtx(tx, TENANT_ID);
  ctx.notify('case.updated', { a: 1 });
  ctx.publish('case.created', { caseId: 'c1' });
  ctx.notifyAgent(AGENT_ID, 'notification.new', {});
  ctx.enqueue(queue, 'job-1', { b: 2 });
  assert.equal(ctx.tx, tx);
  assert.equal(ctx.tenantId, TENANT_ID);
  assert.deepEqual(pushed, [
    { room: `tenant:${TENANT_ID}`, name: 'case.updated', data: { a: 1 } },
    { room: `tenant:${TENANT_ID}:agent:${AGENT_ID}`, name: 'notification.new', data: {} },
  ]);
  assert.deepEqual(published, [{ name: 'case.created', payload: { caseId: 'c1' } }]);
  assert.equal(enqueued.length, 1);
  assert.ok(enqueued[0].queue === queue);
  assert.equal(enqueued[0].name, 'job-1');
  assert.deepEqual(enqueued[0].data, { b: 2 });
  assert.deepEqual(log, []);
});
