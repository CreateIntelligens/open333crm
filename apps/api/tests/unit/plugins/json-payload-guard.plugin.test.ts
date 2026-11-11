/**
 * 全域 JSON 解析器在解析前限制請求內容（change limit-request-array-size，spec request-payload-limits，issue #382）。
 *
 * `zod/v3` 對陣列每個不合格的元素各產生一筆錯誤，`.max()` 也擋不住。這裡確認超過上限的請求
 * 在進入 handler（也就是 Zod）之前就被拒絕，而且只回一筆錯誤。
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import jsonPayloadGuardPlugin from '#src/plugins/json-payload-guard.plugin.js';
import { DEFAULT_JSON_PAYLOAD_LIMITS } from '#src/shared/utils/json-payload-limits.js';

const small = { maxArrayLength: 5, maxObjectKeys: 4, maxTotalEntries: 20, maxDepth: 4 };

let handlerCalls = 0;
let zodParseCalls = 0;
const stringList = z.array(z.string()).max(10);

async function buildApp(limits: typeof small): Promise<FastifyInstance> {
  // 與 apps/api/src/index.ts 相同的 bodyLimit（30MB），讓二十萬個元素的請求能送到解析器
  const app = Fastify({ bodyLimit: 30 * 1024 * 1024 });
  await app.register(errorHandlerPlugin);
  await app.register(jsonPayloadGuardPlugin, { limits });
  app.post('/echo', async (request) => {
    handlerCalls++;
    return { ok: true, body: request.body };
  });
  app.post('/zod', async (request) => {
    handlerCalls++;
    zodParseCalls++;
    return { ok: true, value: stringList.parse(request.body) };
  });
  app.post('/raised', { config: { jsonPayloadLimits: { maxArrayLength: 20 } } }, async () => {
    handlerCalls++;
    return { ok: true };
  });
  await app.ready();
  return app;
}

function arr(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

let app: FastifyInstance;
let defaultApp: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(small);
  defaultApp = await buildApp(DEFAULT_JSON_PAYLOAD_LIMITS);
});

afterAll(async () => {
  await app.close();
  await defaultApp.close();
});

beforeEach(() => {
  handlerCalls = 0;
  zodParseCalls = 0;
});

describe('陣列元素過多的 JSON 請求在解析前被拒絕', () => {
  test('根層陣列超過上限', async () => {
    const res = await app.inject({ method: 'POST', url: '/echo', payload: arr(6) });
    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'PAYLOAD_ARRAY_TOO_LARGE');
    assert.deepEqual(body.error.details, { path: '', limit: 5 });
    assert.match(body.error.message, /陣列/);
    assert.equal(handlerCalls, 0);
  });

  test('巢狀物件裡的陣列超過上限', async () => {
    const res = await app.inject({ method: 'POST', url: '/echo', payload: { items: [{ tags: arr(6) }] } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'PAYLOAD_ARRAY_TOO_LARGE');
    assert.equal(res.json().error.details.path, 'items.0.tags');
    assert.equal(handlerCalls, 0);
  });

  test('陣列剛好等於上限', async () => {
    const res = await app.inject({ method: 'POST', url: '/echo', payload: arr(5) });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().body, arr(5));
    assert.equal(handlerCalls, 1);
  });

  test('二十萬個不合格元素只得到一筆錯誤', async () => {
    const started = Date.now();
    const res = await defaultApp.inject({ method: 'POST', url: '/zod', payload: arr(200_000) });
    const elapsed = Date.now() - started;
    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.error.code, 'PAYLOAD_ARRAY_TOO_LARGE');
    assert.equal(body.error.details.issues, undefined);
    assert.deepEqual(body.error.details, { path: '', limit: 10_000 });
    assert.equal(zodParseCalls, 0);
    assert.ok(elapsed < 2_000, `回應花了 ${elapsed}ms`);
  });

  test('預設上限內的陣列照常進入 Zod 驗證', async () => {
    const res = await defaultApp.inject({ method: 'POST', url: '/zod', payload: arr(3) });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');
    assert.equal(zodParseCalls, 1);
  });
});

test('物件欄位超過上限', async () => {
  const res = await app.inject({ method: 'POST', url: '/echo', payload: { map: { a: 1, b: 2, c: 3, d: 4, e: 5 } } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'PAYLOAD_OBJECT_TOO_LARGE');
  assert.deepEqual(res.json().error.details, { path: 'map', limit: 4 });
  assert.equal(handlerCalls, 0);
});

test('多個未超過單一上限的陣列合計超過總數上限', async () => {
  const res = await app.inject({ method: 'POST', url: '/echo', payload: [arr(5), arr(5), arr(5), arr(5)] });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'PAYLOAD_TOO_MANY_ENTRIES');
  assert.equal(res.json().error.details.limit, 20);
  assert.equal(handlerCalls, 0);
});

test('巢狀深度超過上限', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json' },
    payload: '[[[[[1]]]]]',
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'PAYLOAD_TOO_DEEP');
  assert.equal(res.json().error.details.limit, 4);
  assert.equal(handlerCalls, 0);
});

describe('路由可以調高自己的上限', () => {
  test('調高上限的路由接受大陣列', async () => {
    const res = await app.inject({ method: 'POST', url: '/raised', payload: arr(15) });
    assert.equal(res.statusCode, 200);
    assert.equal(handlerCalls, 1);
  });

  test('調高上限的路由仍受其他上限限制', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/raised',
      headers: { 'content-type': 'application/json' },
      payload: '[[[[[1]]]]]',
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'PAYLOAD_TOO_DEEP');
    assert.equal(handlerCalls, 0);
  });

  test('調高上限的路由超過調高後的上限仍被拒絕', async () => {
    const res = await app.inject({ method: 'POST', url: '/raised', payload: arr(21) });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json().error.details, { path: '', limit: 20 });
  });
});

describe('Fastify 預設 JSON 解析器的行為不變', () => {
  test('__proto__ 仍被拒絕', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"__proto__":{"polluted":true}}',
    });
    assert.equal(res.statusCode, 400);
    assert.equal(handlerCalls, 0);
  });

  test('格式錯誤的 JSON 回 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"a":',
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'REQUEST_ERROR');
    assert.equal(handlerCalls, 0);
  });

  test('一般的 JSON 照常解析', async () => {
    const res = await app.inject({ method: 'POST', url: '/echo', payload: { name: '王小明', list: [1, 2] } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().body, { name: '王小明', list: [1, 2] });
  });

  test('content-type 帶 charset 也會檢查', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      payload: JSON.stringify(arr(6)),
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'PAYLOAD_ARRAY_TOO_LARGE');
  });
});
