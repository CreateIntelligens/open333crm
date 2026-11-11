/**
 * 交易內處理唯一約束與條件認領的共用函式
 * （主規格 tenant-transaction-context「寫入撞到唯一鍵時改用既有資料」「條件更新認領」）。
 *
 * 寫入與查詢以 callback 傳入，這裡用假的 callback 驗證判斷邏輯。
 * 對真實 PostgreSQL 的行為（交易不失效、兩個交易同時寫入）見 apps/api/tests/feature/lib/db-invariants.test.ts。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { claimOne, createOrFindExisting } from '#src/db/db-invariants.js';

test('claimOne：更新 1 筆，認領成功', async () => {
  assert.equal(await claimOne(async () => ({ count: 1 })), true);
});

test('claimOne：更新 0 筆，已經被認領', async () => {
  assert.equal(await claimOne(async () => ({ count: 0 })), false);
});

test('claimOne：更新 2 筆，條件對應多筆資料時丟錯', async () => {
  await assert.rejects(claimOne(async () => ({ count: 2 })), /2/);
});

test('createOrFindExisting：沒有衝突，回傳新寫入的資料', async () => {
  let looked = false;
  const result = await createOrFindExisting(
    async () => [{ id: 'new' }],
    async () => {
      looked = true;
      return null;
    },
  );
  assert.deepEqual(result, { row: { id: 'new' }, created: true });
  assert.equal(looked, false);
});

test('createOrFindExisting：寫入被略過，回傳既有的資料', async () => {
  const result = await createOrFindExisting(
    async () => [],
    async () => ({ id: 'existing' }),
  );
  assert.deepEqual(result, { row: { id: 'existing' }, created: false });
});

test('createOrFindExisting：寫入被略過但查不到既有資料時丟錯', async () => {
  await assert.rejects(
    createOrFindExisting(
      async () => [],
      async () => null,
    ),
  );
});

test('createOrFindExisting：寫入回傳 2 筆時丟錯', async () => {
  await assert.rejects(
    createOrFindExisting(
      async () => [{ id: 'a' }, { id: 'b' }],
      async () => null,
    ),
  );
});
