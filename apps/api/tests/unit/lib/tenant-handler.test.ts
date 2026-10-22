/**
 * tenantHandler()：route 的回應在 commit 之後才送出
 * （主規格 tenant-transaction-context「route 的回應在 commit 之後才送出」）。
 *
 * 用 mock 的 prisma.$transaction 模擬交易：callback resolve 之後才算 commit。
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import { tenantHandler } from '#src/lib/tenant-ctx.js';
import { AppError } from '#src/shared/utils/response.js';

// 快路徑換成記錄呼叫：確認 commit 之後才送出
const dispatched = vi.hoisted(() => [] as Array<{ db: unknown; names: string[] }>);
vi.mock('@open333crm/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@open333crm/core')>();
  return {
    ...original,
    dispatchOutboxRows: async (db: unknown, rows: Array<{ name: string }>) => {
      dispatched.push({ db, names: rows.map((r) => r.name) });
    },
  };
});

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

let app: FastifyInstance;
let log: string[] = [];
let commitError: Error | null = null;
let handlerRan = false;

const tx = {
  $executeRaw: async () => 1,
  outbox: {
    async create(args: { data: { name: string; tenantId: string } }) {
      log.push(`write:${args.data.name}`);
      return { id: 'o1', ...args.data, createdAt: new Date() };
    },
  },
};

const prisma = {
  async $transaction(cb: (t: typeof tx) => Promise<unknown>) {
    const result = await cb(tx);
    if (commitError) throw commitError;
    log.push('commit');
    return result;
  },
};
const io = {
  to: () => ({
    emit: (event: string) => {
      log.push(`push:${event}`);
    },
  }),
};

beforeAll(async () => {
  app = Fastify();
  app.decorate('prisma', prisma as never);
  app.decorate('io', io as never);
  await app.register(errorHandlerPlugin);
  // 模擬 auth：帶 x-tenant 才有租戶身分
  app.addHook('onRequest', async (request) => {
    const tenantId = request.headers['x-tenant'];
    if (typeof tenantId === 'string') {
      (request as unknown as { agent: unknown }).agent = { id: 'agent-1', tenantId, role: 'ADMIN' };
    }
  });

  app.post(
    '/ok',
    tenantHandler(app, async (_request, reply, ctx) => {
      handlerRan = true;
      reply.code(201);
      ctx.notify('case.created', {});
      log.push('handler-end');
      return { success: true, data: { tenantId: ctx.tenantId } };
    }),
  );

  app.post(
    '/conflict',
    tenantHandler(app, async (_request, _reply, ctx) => {
      handlerRan = true;
      ctx.notify('case.created', {});
      throw new AppError('重複', 'CONFLICT', 409);
    }),
  );

  app.post(
    '/conflict-after-header',
    tenantHandler(app, async (_request, reply) => {
      reply.code(201).header('location', '/created/1');
      throw new AppError('重複', 'CONFLICT', 409);
    }),
  );

  app.post(
    '/publish',
    tenantHandler(app, async (_request, _reply, ctx) => {
      await ctx.publish('case.resolved', { caseId: 'c1' });
      log.push('handler-end');
      return { success: true };
    }),
  );

  app.post(
    '/header',
    tenantHandler(app, async (_request, reply) => {
      reply.code(201).header('location', '/created/1');
      return { success: true };
    }),
  );

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  log = [];
  dispatched.length = 0;
  commitError = null;
  handlerRan = false;
});

test('成功時回應交易內程式的結果', async () => {
  const res = await app.inject({ method: 'POST', url: '/ok', headers: { 'x-tenant': TENANT_ID } });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.json(), { success: true, data: { tenantId: TENANT_ID } });
  assert.deepEqual(log, ['handler-end', 'commit', 'push:case.created']);
});

test('交易內程式丟出錯誤：回應錯誤，登記的推播不送出', async () => {
  const res = await app.inject({ method: 'POST', url: '/conflict', headers: { 'x-tenant': TENANT_ID } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, 'CONFLICT');
  assert.deepEqual(log, []);
});

test('請求沒有租戶身分：回應 401，交易內程式不執行', async () => {
  const res = await app.inject({ method: 'POST', url: '/ok' });
  assert.equal(res.statusCode, 401);
  assert.equal(handlerRan, false);
});

test('commit 失敗：回應錯誤而不是成功', async () => {
  commitError = new Error('commit failed');
  const res = await app.inject({ method: 'POST', url: '/ok', headers: { 'x-tenant': TENANT_ID } });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(log, ['handler-end']);
});

test('交易內程式設定 header 後丟出錯誤：錯誤回應不帶該 header', async () => {
  const res = await app.inject({ method: 'POST', url: '/conflict-after-header', headers: { 'x-tenant': TENANT_ID } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.headers.location, undefined);
});

test('commit 失敗：錯誤回應不帶交易內設定的 header', async () => {
  commitError = new Error('commit failed');
  const res = await app.inject({ method: 'POST', url: '/header', headers: { 'x-tenant': TENANT_ID } });
  assert.equal(res.statusCode, 500);
  assert.equal(res.headers.location, undefined);
});

test('commit 成功：回應帶交易內設定的狀態碼與 header', async () => {
  const res = await app.inject({ method: 'POST', url: '/header', headers: { 'x-tenant': TENANT_ID } });
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers.location, '/created/1');
});

test('型別：交易內的 reply 不能送出回應，推播名稱依種類限制', { timeout: 120_000 }, async () => {
  // tests/ 不在 apps/api 的 tsconfig 裡，另以 tests/types/tsconfig.json 檢查 tenant-handler.types.ts。
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

test('事件在交易內寫 outbox，commit 之後交給快路徑', async () => {
  const res = await app.inject({ method: 'POST', url: '/publish', headers: { 'x-tenant': TENANT_ID } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(log, ['write:case.resolved', 'handler-end', 'commit']);
  assert.deepEqual(dispatched.map((d) => d.names), [['case.resolved']]);
});
