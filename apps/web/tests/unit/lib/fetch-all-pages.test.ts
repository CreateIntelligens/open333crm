/**
 * 分頁 API 全部取回。規則列表原本只取第一頁（預設 20 條），Demo Tenant 有 155 條規則，
 * 第 21 條以後的規則在畫面上看不到。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { fetchAllPages } from '#src/lib/fetch-all-pages.js';

/** 模擬 paginated() 的回應：{ data, meta: { total, page, limit, totalPages } } */
function fakeGet(total: number) {
  const calls: Array<Record<string, unknown>> = [];
  const get = async (_url: string, config: { params: { page: number; limit: number } }) => {
    calls.push(config.params);
    const { page, limit } = config.params;
    const start = (page - 1) * limit;
    const data = Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, i) => ({ id: start + i }));
    return { data: { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } } };
  };
  return { get, calls };
}

test('Tenant has more rules than one page：逐頁取回全部規則', async () => {
  const { get, calls } = fakeGet(155);
  const rows = await fetchAllPages<{ id: number }>(get, '/automation/rules');
  assert.equal(rows.length, 155);
  assert.deepEqual(rows.map((r) => r.id), Array.from({ length: 155 }, (_, i) => i));
  assert.deepEqual(calls, [{ page: 1, limit: 100 }, { page: 2, limit: 100 }]);
});

test('Tenant has no rules：只取一頁，回空陣列', async () => {
  const { get, calls } = fakeGet(0);
  assert.deepEqual(await fetchAllPages(get, '/automation/rules'), []);
  assert.equal(calls.length, 1);
});

test('回應沒有 meta：視為只有一頁，不會無限迴圈', async () => {
  let n = 0;
  const get = async () => { n += 1; return { data: { data: [{ id: 1 }] } }; };
  assert.deepEqual(await fetchAllPages(get, '/x'), [{ id: 1 }]);
  assert.equal(n, 1);
});

test('A page fails to load：拋出錯誤，不回傳只有部分資料的列表', async () => {
  const get = async (_url: string, config: { params: { page: number } }) => {
    if (config.params.page === 2) throw new Error('timeout');
    return { data: { data: [{ id: 1 }], meta: { totalPages: 2 } } };
  };
  await assert.rejects(fetchAllPages(get, '/automation/rules'), /timeout/);
});
