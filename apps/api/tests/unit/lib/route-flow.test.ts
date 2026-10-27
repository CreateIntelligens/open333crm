/**
 * route 呼叫 flow：回應在 commit 之後才送出（主規格 tenant-transaction-context「route 的回應在 commit 之後才送出」，
 * change migrate-role-agent-tenant-ctx 改成 route 一律呼叫 flow）。
 *
 * 用 mock 的 prisma.$transaction 模擬交易：callback resolve 之後才算 commit。
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { afterAll, beforeAll, beforeEach, test } from 'vitest';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import { inTenant } from '#src/lib/tenant-ctx.js';
import { actorOf } from '#src/lib/request-actor.js';
import { notifyTenant } from '#src/events/socket-push.js';
import { AppError } from '#src/shared/utils/response.js';

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

let app: FastifyInstance;
let log: string[] = [];
let commitError: Error | null = null;
let transactions = 0;

const tx = {
  $executeRaw: async () => 1,
  item: {
    async create() {
      log.push('write');
      return { id: 'i1' };
    },
  },
};

const prisma = {
  async $transaction(cb: (t: typeof tx) => Promise<unknown>) {
    transactions += 1;
    const result = await cb(tx);
    if (commitError) {
      log.push('rollback');
      throw commitError;
    }
    log.push('commit');
    return result;
  },
} as unknown as PrismaClient;

const io = {
  to: () => ({
    emit: (event: string) => {
      log.push(`push:${event}`);
    },
  }),
} as unknown as Server;

/** 測試用的 flow：寫一筆、登記推播；conflict 時寫入之後丟出 409 */
function createItemFlow(tenantId: string, opts: { conflict?: boolean } = {}) {
  return inTenant(prisma, tenantId, async (scope) => {
    const item = await (scope.tx as unknown as typeof tx).item.create();
    notifyTenant(scope, io, 'case.created', item);
    if (opts.conflict) throw new AppError('重複', 'CONFLICT', 409);
    return item;
  });
}

beforeAll(async () => {
  app = Fastify();
  await app.register(errorHandlerPlugin);
  // 模擬 auth：帶 x-tenant 才有租戶身分
  app.addHook('onRequest', async (request) => {
    const tenantId = request.headers['x-tenant'];
    if (typeof tenantId === 'string') {
      (request as unknown as { agent: unknown }).agent = { id: 'agent-1', tenantId, role: 'ADMIN' };
    }
  });
  app.addHook('onSend', async () => {
    log.push('send');
  });
  app.post('/items', async (request, reply) => {
    const item = await createItemFlow(actorOf(request).tenantId);
    return reply.code(201).header('location', `/items/${item.id}`).send({ success: true, data: item });
  });
  app.post('/items/conflict', async (request, reply) => {
    const item = await createItemFlow(actorOf(request).tenantId, { conflict: true });
    return reply.code(201).send({ success: true, data: item });
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  log = [];
  commitError = null;
  transactions = 0;
});

test('成功時回應交易內程式的結果：狀態碼 201、內容是 flow 的回傳值，commit 與推播在送出之前', async () => {
  const res = await app.inject({ method: 'POST', url: '/items', headers: { 'x-tenant': TENANT_ID } });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.json(), { success: true, data: { id: 'i1' } });
  assert.equal(res.headers.location, '/items/i1');
  assert.deepEqual(log, ['write', 'commit', 'push:case.created', 'send']);
});

test('交易內程式丟出錯誤：回應 409，交易 rollback，推播不送出', async () => {
  const res = await app.inject({ method: 'POST', url: '/items/conflict', headers: { 'x-tenant': TENANT_ID } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, 'CONFLICT');
  assert.deepEqual(log, ['write', 'send'], '沒有 commit，也沒有推播');
});

test('交易失敗時不帶交易內設定的 header：commit 失敗時回錯誤，沒有 Location', async () => {
  commitError = new Error('commit failed');
  const res = await app.inject({ method: 'POST', url: '/items', headers: { 'x-tenant': TENANT_ID } });
  assert.equal(res.statusCode, 500);
  assert.equal(res.headers.location, undefined);
  assert.deepEqual(log, ['write', 'rollback', 'send'], '推播不送出');
});

test('請求沒有租戶身分：回應 401，flow 不開交易', async () => {
  const res = await app.inject({ method: 'POST', url: '/items' });
  assert.equal(res.statusCode, 401);
  assert.equal(transactions, 0);
});

test('型別：service 的 TenantCtx 不能登記副作用，推播名稱依種類限制', { timeout: 120_000 }, async () => {
  // tests/ 不在 apps/api 的 tsconfig 裡，另以 tests/types/tsconfig.json 檢查 tenant-ctx.types.ts。
  // 該檔用 @ts-expect-error 標出不能編譯的寫法；限制被拿掉時，@ts-expect-error 沒有用到，tsc 失敗。
  const apiRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const tsc = fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url));
  try {
    await promisify(execFile)(process.execPath, [tsc, '-p', 'tests/types/tsconfig.json'], { cwd: apiRoot });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    assert.fail(`tsc 型別檢查失敗：\n${e.stdout ?? ''}${e.stderr ?? ''}`);
  }
});
