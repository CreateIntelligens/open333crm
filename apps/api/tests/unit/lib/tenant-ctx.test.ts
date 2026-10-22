/**
 * inTenant()：入口開一個綁定租戶的交易，推播、事件與佇列 job 在 commit 之後才送出
 * （主規格 tenant-transaction-context；change outbox-event-delivery 改成事件與 job 在交易內寫 outbox）。
 *
 * 用 mock 的 prisma.$transaction 模擬交易：callback resolve 之後才算 commit。
 * 「寫入一起 rollback」「只看得到綁定租戶」要真實的 RLS，見 tests/feature/lib/tenant-ctx.test.ts。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import type { OutboxInput, OutboxRow } from '@open333crm/core';
import { inTenant, type TenantCtxDeps } from '#src/lib/tenant-ctx.js';

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const AGENT_ID = 'c0000000-0000-0000-0000-000000000003';

/** 依發生順序記錄推播、outbox 的寫入與送出，以及交易內的步驟 */
let log: string[] = [];
const written: Array<{ tx: unknown; input: OutboxInput }> = [];

afterEach(() => {
  log = [];
  written.length = 0;
});

function rowOf(input: OutboxInput): OutboxRow {
  return {
    id: `id-${input.name}`,
    tenantId: input.tenantId,
    kind: input.kind,
    name: input.name,
    queueName: input.kind === 'job' ? input.queueName : null,
    payload: input.payload as never,
    jobOptions: null,
    createdAt: new Date(),
  };
}

/** dispatch 的行為：正常、失敗、一直沒有回應 */
function createEvents(dispatch: 'ok' | 'fail' | 'hang' = 'ok'): TenantCtxDeps['events'] {
  return {
    async write(tx, input) {
      written.push({ tx, input });
      log.push(`write:${input.name}`);
      return rowOf(input);
    },
    dispatch(rows) {
      if (dispatch === 'hang') return new Promise(() => {});
      if (dispatch === 'fail') return Promise.reject(new Error('queue down'));
      for (const row of rows) log.push(`dispatch:${row.name}`);
      return Promise.resolve();
    },
  };
}

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

function deps(opts: { commitError?: Error; noIo?: boolean; dispatch?: 'ok' | 'fail' | 'hang' } = {}): TenantCtxDeps {
  return {
    prisma: createPrisma(opts),
    io: opts.noIo ? undefined : (createIo() as never),
    events: createEvents(opts.dispatch),
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

test('commit 之前不送出：事件與 job 在交易內寫 outbox，commit 之後才交給快路徑', async () => {
  await inTenant(deps(), TENANT_ID, async (ctx) => {
    ctx.notify('case.updated', {});
    await ctx.publish('case.resolved', {});
    await ctx.enqueue('rich-menu-bind', 'job-1', {});
    log.push('fn-end');
  });
  assert.deepEqual(log, [
    'write:case.resolved',
    'write:job-1',
    'fn-end',
    'commit',
    `push:tenant:${TENANT_ID}:case.updated`,
    'dispatch:case.resolved',
    'dispatch:job-1',
  ]);
});

test('commit 之後依登記順序送出', async () => {
  await inTenant(deps(), TENANT_ID, async (ctx) => {
    ctx.notify('case.created', {});
    await ctx.publish('case.created', {});
    await ctx.enqueue('rich-menu-bind', 'job-1', {});
    ctx.notify('case.updated', {});
  });
  assert.deepEqual(log, [
    'write:case.created',
    'write:job-1',
    'commit',
    `push:tenant:${TENANT_ID}:case.created`,
    'dispatch:case.created',
    'dispatch:job-1',
    `push:tenant:${TENANT_ID}:case.updated`,
  ]);
});

test('rollback 時不交給快路徑，呼叫端收到原本的錯誤', async () => {
  // outbox 的資料列隨交易 rollback；這裡確認快路徑沒有被呼叫
  const boom = new Error('boom');
  await assert.rejects(
    inTenant(deps(), TENANT_ID, async (ctx) => {
      ctx.notify('case.updated', {});
      await ctx.publish('case.created', {});
      await ctx.enqueue('rich-menu-bind', 'job-1', {});
      throw boom;
    }),
    (err) => err === boom,
  );
  assert.deepEqual(log, ['write:case.created', 'write:job-1']);
});

test('commit 失敗時全部丟棄', async () => {
  const commitError = new Error('commit failed');
  await assert.rejects(
    inTenant(deps({ commitError }), TENANT_ID, async (ctx) => {
      ctx.notify('case.updated', {});
      await ctx.publish('case.created', {});
      await ctx.enqueue('rich-menu-bind', 'job-1', {});
    }),
    (err) => err === commitError,
  );
  assert.deepEqual(log, ['write:case.created', 'write:job-1']);
});

test('一項送出失敗不影響其他項，呼叫端收到回傳值', async () => {
  const result = await inTenant(deps({ dispatch: 'fail' }), TENANT_ID, async (ctx) => {
    await ctx.enqueue('rich-menu-bind', 'job-1', {});
    ctx.notify('case.updated', {});
    return 'done';
  });
  assert.equal(result, 'done');
  assert.deepEqual(log, ['write:job-1', 'commit', `push:tenant:${TENANT_ID}:case.updated`]);
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
  const result = await Promise.race([
    inTenant(deps({ dispatch: 'hang' }), TENANT_ID, async (ctx) => {
      await ctx.enqueue('rich-menu-bind', 'job-1', {});
      ctx.notify('case.updated', {});
      return 'done';
    }),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 500)),
  ]);
  assert.equal(result, 'done');
  assert.deepEqual(log, ['write:job-1', 'commit', `push:tenant:${TENANT_ID}:case.updated`]);
});

test('publish 在交易內寫 outbox，帶交易綁定的 tenantId', async () => {
  let ctxTx: unknown;
  await inTenant(deps(), TENANT_ID, async (ctx) => {
    ctxTx = ctx.tx;
    await ctx.publish('case.resolved', { caseId: 'c1' });
  });
  assert.equal(written[0].tx, ctxTx);
  assert.deepEqual(written[0].input, { tenantId: TENANT_ID, kind: 'event', name: 'case.resolved', payload: { caseId: 'c1' } });
});

test('enqueue 在交易內寫 outbox，帶佇列名稱、資料與選項', async () => {
  await inTenant(deps(), TENANT_ID, async (ctx) => {
    await ctx.enqueue('data-export', 'data-export:generate', { requestId: 'r1' }, { attempts: 2 });
  });
  assert.deepEqual(written[0].input, {
    tenantId: TENANT_ID,
    kind: 'job',
    queueName: 'data-export',
    name: 'data-export:generate',
    payload: { requestId: 'r1' },
    jobOptions: { attempts: 2 },
  });
});

test('沒有 io 時呼叫 notify：在交易內丟錯，交易 rollback', async () => {
  await assert.rejects(
    inTenant(deps({ noIo: true }), TENANT_ID, async (ctx) => {
      await ctx.publish('case.created', {});
      ctx.notify('case.updated', {});
    }),
  );
  assert.deepEqual(log, ['write:case.created']);
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
  const { ctx, pushed, published, enqueued } = createMockTenantCtx(tx, TENANT_ID);
  ctx.notify('case.updated', { a: 1 });
  await ctx.publish('case.created', { caseId: 'c1' });
  ctx.notifyAgent(AGENT_ID, 'notification.new', {});
  await ctx.enqueue('rich-menu-bind', 'job-1', { b: 2 });
  assert.equal(ctx.tx, tx);
  assert.equal(ctx.tenantId, TENANT_ID);
  assert.deepEqual(pushed, [
    { room: `tenant:${TENANT_ID}`, name: 'case.updated', data: { a: 1 } },
    { room: `tenant:${TENANT_ID}:agent:${AGENT_ID}`, name: 'notification.new', data: {} },
  ]);
  assert.deepEqual(published, [{ name: 'case.created', payload: { caseId: 'c1' } }]);
  assert.deepEqual(enqueued, [{ queueName: 'rich-menu-bind', name: 'job-1', data: { b: 2 }, opts: undefined }]);
  assert.deepEqual(log, []);
});
