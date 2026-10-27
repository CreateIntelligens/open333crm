/**
 * inTenant()：入口開一個綁定租戶的交易，推播、事件與佇列 job 在 commit 之後才送出
 * （主規格 tenant-transaction-context；change outbox-event-delivery 改成事件與 job 在交易內寫 outbox；
 * change migrate-role-agent-tenant-ctx 把副作用改成收 scope 的函式，scope 只留 afterCommit）。
 *
 * 用 mock 的 prisma.$transaction 模擬交易：callback resolve 之後才算 commit。
 * 「寫入一起 rollback」「只看得到綁定租戶」要真實的 RLS，見 tests/feature/lib/tenant-ctx.test.ts。
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import type { OutboxInput, OutboxRow } from '@open333crm/core';
import type { Server } from 'socket.io';
import { inTenant } from '#src/lib/tenant-ctx.js';
import { enqueueJob, publishEvent, type EventPublisher } from '#src/events/outbox-publisher.js';
import { notifyAgent, notifyTenant } from '#src/events/socket-push.js';

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
function createEvents(dispatch: 'ok' | 'fail' | 'hang' = 'ok'): EventPublisher {
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

const io = {
  to(room: string) {
    return {
      emit(event: string) {
        log.push(`push:${room}:${event}`);
      },
    };
  },
} as unknown as Server;

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

const events = createEvents();

test('不合法的租戶 ID：丟出錯誤，交易內的程式不執行', async () => {
  let ran = false;
  await assert.rejects(
    inTenant(createPrisma(), 'not-a-uuid', async () => {
      ran = true;
    }),
  );
  assert.equal(ran, false);
});

test('commit 之前不送出：事件與 job 在交易內寫 outbox，commit 之後才交給快路徑', async () => {
  await inTenant(createPrisma(), TENANT_ID, async (scope) => {
    notifyTenant(scope, io, 'case.updated', {});
    await publishEvent(scope, events, 'case.resolved', {});
    await enqueueJob(scope, events, 'rich-menu-bind', 'job-1', {});
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
  await inTenant(createPrisma(), TENANT_ID, async (scope) => {
    notifyTenant(scope, io, 'case.created', {});
    await publishEvent(scope, events, 'case.created', {});
    await enqueueJob(scope, events, 'rich-menu-bind', 'job-1', {});
    notifyTenant(scope, io, 'case.updated', {});
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
    inTenant(createPrisma(), TENANT_ID, async (scope) => {
      notifyTenant(scope, io, 'case.updated', {});
      await publishEvent(scope, events, 'case.created', {});
      await enqueueJob(scope, events, 'rich-menu-bind', 'job-1', {});
      throw boom;
    }),
    (err) => err === boom,
  );
  assert.deepEqual(log, ['write:case.created', 'write:job-1']);
});

test('commit 失敗時全部丟棄', async () => {
  const commitError = new Error('commit failed');
  await assert.rejects(
    inTenant(createPrisma({ commitError }), TENANT_ID, async (scope) => {
      notifyTenant(scope, io, 'case.updated', {});
      await publishEvent(scope, events, 'case.created', {});
      await enqueueJob(scope, events, 'rich-menu-bind', 'job-1', {});
    }),
    (err) => err === commitError,
  );
  assert.deepEqual(log, ['write:case.created', 'write:job-1']);
});

test('一項送出失敗不影響其他項，呼叫端收到回傳值', async () => {
  const result = await inTenant(createPrisma(), TENANT_ID, async (scope) => {
    await enqueueJob(scope, createEvents('fail'), 'rich-menu-bind', 'job-1', {});
    notifyTenant(scope, io, 'case.updated', {});
    return 'done';
  });
  assert.equal(result, 'done');
  assert.deepEqual(log, ['write:job-1', 'commit', `push:tenant:${TENANT_ID}:case.updated`]);
});

test('全租戶推播：只送到交易綁定租戶的房間', async () => {
  await inTenant(createPrisma(), TENANT_ID, async (scope) => {
    notifyTenant(scope, io, 'case.updated', { caseId: 'c1' });
  });
  assert.deepEqual(log, ['commit', `push:tenant:${TENANT_ID}:case.updated`]);
});

test('給客服人員的推播：只送到帶租戶 ID 的該客服人員房間', async () => {
  await inTenant(createPrisma(), TENANT_ID, async (scope) => {
    notifyAgent(scope, io, AGENT_ID, 'notification.new', { id: 'n1' });
  });
  assert.deepEqual(log, ['commit', `push:tenant:${TENANT_ID}:agent:${AGENT_ID}:notification.new`]);
});

test('給客服人員的推播用了別的租戶的客服人員 ID：房間仍是交易綁定的租戶', async () => {
  // 客服人員 Y 屬於租戶 B，連線只加入 tenant:B:agent:Y（socket-room-handlers），收不到這則推播
  const agentOfOtherTenant = 'd0000000-0000-0000-0000-000000000004';
  await inTenant(createPrisma(), TENANT_ID, async (scope) => {
    notifyAgent(scope, io, agentOfOtherTenant, 'notification.new', {});
  });
  assert.deepEqual(log, ['commit', `push:tenant:${TENANT_ID}:agent:${agentOfOtherTenant}:notification.new`]);
});

test('佇列沒有回應時不阻擋回傳', async () => {
  const result = await Promise.race([
    inTenant(createPrisma(), TENANT_ID, async (scope) => {
      await enqueueJob(scope, createEvents('hang'), 'rich-menu-bind', 'job-1', {});
      notifyTenant(scope, io, 'case.updated', {});
      return 'done';
    }),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 500)),
  ]);
  assert.equal(result, 'done');
  assert.deepEqual(log, ['write:job-1', 'commit', `push:tenant:${TENANT_ID}:case.updated`]);
});

test('afterCommit：commit 之後執行，回傳之前完成', async () => {
  await inTenant(createPrisma(), TENANT_ID, async (scope) => {
    scope.afterCommit('slow', async () => {
      log.push('after:start');
      await new Promise((resolve) => setTimeout(resolve, 50));
      log.push('after:end');
    });
    log.push('fn-end');
  });
  log.push('returned');
  assert.deepEqual(log, ['fn-end', 'commit', 'after:start', 'after:end', 'returned']);
});

test('afterCommit：rollback 時不執行，呼叫端收到原本的錯誤', async () => {
  const boom = new Error('boom');
  await assert.rejects(
    inTenant(createPrisma(), TENANT_ID, async (scope) => {
      scope.afterCommit('a', () => {
        log.push('after');
      });
      throw boom;
    }),
    (err) => err === boom,
  );
  assert.deepEqual(log, []);
});

test('afterCommit：動作失敗不影響回傳，其後的推播照常送出', async () => {
  const result = await inTenant(createPrisma(), TENANT_ID, async (scope) => {
    scope.afterCommit('fail', async () => {
      throw new Error('redis down');
    });
    notifyTenant(scope, io, 'case.updated', {});
    return 'done';
  });
  assert.equal(result, 'done');
  assert.deepEqual(log, ['commit', `push:tenant:${TENANT_ID}:case.updated`]);
});

test('afterCommit：與推播依登記順序執行', async () => {
  await inTenant(createPrisma(), TENANT_ID, async (scope) => {
    notifyTenant(scope, io, 'case.created', {});
    scope.afterCommit('a1', () => {
      log.push('after:a1');
    });
    notifyTenant(scope, io, 'case.updated', {});
  });
  assert.deepEqual(log, [
    'commit',
    `push:tenant:${TENANT_ID}:case.created`,
    'after:a1',
    `push:tenant:${TENANT_ID}:case.updated`,
  ]);
});

test('publish 在交易內寫 outbox，帶交易綁定的 tenantId', async () => {
  let ctxTx: unknown;
  await inTenant(createPrisma(), TENANT_ID, async (scope) => {
    ctxTx = scope.tx;
    await publishEvent(scope, events, 'case.resolved', { caseId: 'c1' });
  });
  assert.equal(written[0].tx, ctxTx);
  assert.deepEqual(written[0].input, { tenantId: TENANT_ID, kind: 'event', name: 'case.resolved', payload: { caseId: 'c1' } });
});

test('enqueue 在交易內寫 outbox，帶佇列名稱、資料與選項', async () => {
  await inTenant(createPrisma(), TENANT_ID, async (scope) => {
    await enqueueJob(scope, events, 'data-export', 'data-export:generate', { requestId: 'r1' }, { attempts: 2 });
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

test('scope 只有交易、綁定的 tenantId 與 afterCommit', async () => {
  await inTenant(createPrisma(), TENANT_ID, async (scope) => {
    assert.equal(scope.tenantId, TENANT_ID);
    assert.equal(typeof scope.tx.$executeRaw, 'function');
    assert.deepEqual(Object.keys(scope).sort(), ['afterCommit', 'tenantId', 'tx']);
  });
});

test('createMockTenantScope：依呼叫順序記錄 afterCommit，commit() 才依序執行', async () => {
  const { createMockTenantScope } = await import('#tests/support/mock-tenant-ctx.js');
  const tx = { contact: {} };
  const { scope, afterCommitted, commit } = createMockTenantScope(tx, TENANT_ID);
  notifyTenant(scope, io, 'case.updated', { a: 1 });
  scope.afterCommit('cache', () => {
    log.push('after');
  });
  assert.equal(scope.tx, tx);
  assert.equal(scope.tenantId, TENANT_ID);
  assert.deepEqual(afterCommitted.map((a) => a.label), ['push case.updated', 'cache']);
  assert.deepEqual(log, [], '登記時不執行');
  await commit();
  assert.deepEqual(log, [`push:tenant:${TENANT_ID}:case.updated`, 'after']);
});


test('flowOf：在綁定租戶的交易內呼叫 service，傳入 scope 與其餘參數，commit 之後回傳結果', async () => {
  const { flowOf } = await import('#src/lib/tenant-ctx.js');
  const seen: unknown[] = [];
  const flow = flowOf(async (ctx, id: string, n: number) => {
    seen.push(ctx.tenantId, id, n);
    log.push('fn');
    return `${id}:${n}`;
  });
  const result = await flow({ prisma: createPrisma() }, TENANT_ID, 'x', 2);
  assert.equal(result, 'x:2');
  assert.deepEqual(seen, [TENANT_ID, 'x', 2]);
  assert.deepEqual(log, ['fn', 'commit']);
});
