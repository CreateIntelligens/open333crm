/**
 * inTenant()：入口開一個綁定租戶的交易，推播與事件在 commit 之後才送出
 * （change tenant-transaction-context，主規格 tenant-transaction-context）。
 *
 * 用 mock 的 prisma.$transaction 模擬交易：callback resolve 之後才算 commit。
 * 「寫入一起 rollback」「只看得到綁定租戶」要真實的 RLS，見 tests/feature/lib/tenant-ctx.test.ts。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import { inTenant } from '#src/lib/tenant-ctx.js';
import { eventBus, type AppEvent } from '#src/events/event-bus.js';

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

/** 依發生順序記錄推播、事件與交易內的步驟 */
let log: string[] = [];
const received: AppEvent[] = [];

function onEvent(event: AppEvent) {
  if (event.tenantId !== TENANT_ID) return;
  received.push(event);
  log.push(`publish:${event.name}`);
}
eventBus.subscribe('*', onEvent);

afterEach(() => {
  log = [];
  received.length = 0;
});

function createIo(opts: { failRoom?: string } = {}) {
  return {
    to(room: string) {
      return {
        emit(event: string) {
          if (room === opts.failRoom) throw new Error(`emit to ${room} failed`);
          log.push(`emit:${event}`);
        },
      };
    },
  };
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

function deps(opts: { failRoom?: string; commitError?: Error; noIo?: boolean } = {}) {
  return {
    prisma: createPrisma(opts),
    io: opts.noIo ? undefined : (createIo(opts) as never),
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
    ctx.emit(`tenant:${TENANT_ID}`, 'case.updated', {});
    ctx.publish('case.resolved', {});
    log.push('fn-end');
  });
  assert.deepEqual(log, ['fn-end', 'commit', 'emit:case.updated', 'publish:case.resolved']);
});

test('commit 之後依登記順序送出', async () => {
  await inTenant(deps(), TENANT_ID, async (ctx) => {
    ctx.emit('room', 'p1', {});
    ctx.publish('case.created', {});
    ctx.emit('room', 'p2', {});
  });
  assert.deepEqual(log, ['commit', 'emit:p1', 'publish:case.created', 'emit:p2']);
});

test('rollback 時全部丟棄，呼叫端收到原本的錯誤', async () => {
  const boom = new Error('boom');
  await assert.rejects(
    inTenant(deps(), TENANT_ID, async (ctx) => {
      ctx.emit('room', 'p1', {});
      ctx.publish('case.created', {});
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
      ctx.emit('room', 'p1', {});
      ctx.publish('case.created', {});
    }),
    (err) => err === commitError,
  );
  assert.deepEqual(log, []);
});

test('一項送出失敗不影響其他項，呼叫端收到回傳值', async () => {
  const result = await inTenant(deps({ failRoom: 'bad' }), TENANT_ID, async (ctx) => {
    ctx.emit('bad', 'p1', {});
    ctx.publish('case.created', {});
    ctx.emit('room', 'p2', {});
    return 'done';
  });
  assert.equal(result, 'done');
  assert.deepEqual(log, ['commit', 'publish:case.created', 'emit:p2']);
});

test('事件不重複送出', async () => {
  await inTenant(deps(), TENANT_ID, async (ctx) => {
    ctx.publish('case.resolved', { caseId: 'c1' });
  });
  assert.equal(received.length, 1);
});

test('publish 送出的事件帶交易綁定的 tenantId 與時間', async () => {
  await inTenant(deps(), TENANT_ID, async (ctx) => {
    ctx.publish('case.resolved', { caseId: 'c1' });
  });
  assert.equal(received[0].tenantId, TENANT_ID);
  assert.equal(received[0].name, 'case.resolved');
  assert.deepEqual(received[0].payload, { caseId: 'c1' });
  assert.ok(received[0].timestamp instanceof Date);
});

test('沒有 io 時呼叫 emit：在交易內丟錯，交易 rollback', async () => {
  await assert.rejects(
    inTenant(deps({ noIo: true }), TENANT_ID, async (ctx) => {
      ctx.publish('case.created', {});
      ctx.emit('room', 'p1', {});
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

test('createMockTenantCtx：依呼叫順序記錄推播與事件', async () => {
  const { createMockTenantCtx } = await import('#tests/support/mock-tenant-ctx.js');
  const tx = { contact: {} };
  const { ctx, emitted, published } = createMockTenantCtx(tx, TENANT_ID);
  ctx.emit('room-1', 'p1', { a: 1 });
  ctx.publish('case.created', { caseId: 'c1' });
  ctx.emit('room-2', 'p2', {});
  assert.equal(ctx.tx, tx);
  assert.equal(ctx.tenantId, TENANT_ID);
  assert.deepEqual(emitted, [
    { room: 'room-1', event: 'p1', data: { a: 1 } },
    { room: 'room-2', event: 'p2', data: {} },
  ]);
  assert.deepEqual(published, [{ name: 'case.created', payload: { caseId: 'c1' } }]);
  assert.deepEqual(log, []);
});
