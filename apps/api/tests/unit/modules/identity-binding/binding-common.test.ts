/**
 * inTransaction() 擋下 request.tenantPrisma（issue #253 測試缺口，原 add-cross-channel-one-id 9.6）。
 * tenantPrisma 的 $transaction 不帶租戶、每個查詢各自開交易：合併與解除合併會失去原子性，也會被 RLS 擋下。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { inTransaction } from '#src/modules/identity-binding/binding-common.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import type { TenantDb } from '#src/lib/tenant-db.js';

const T = 'a0000000-0000-0000-0000-000000000001';

test('傳入 request.tenantPrisma（tenantScopedClient）：丟出錯誤，不執行 fn', async () => {
  // 只建立 client、不送查詢，不會連線資料庫
  const scoped = tenantScopedClient(new PrismaClient(), T);
  let ran = false;
  await assert.rejects(
    inTransaction(scoped as unknown as TenantDb, async () => {
      ran = true;
    }),
    /withTenant 交易內執行/,
  );
  assert.equal(ran, false);
});

test('傳入有 $transaction 的 client：在它的交易內執行 fn，拿到交易 client', async () => {
  const tx = { marker: 'tx' };
  const client = { $transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx) };
  const got = await inTransaction(client as unknown as TenantDb, async (t) => t);
  assert.equal(got, tx);
});

test('傳入交易 client（沒有 $transaction）：直接執行 fn，不巢狀開交易', async () => {
  const tx = { marker: 'already-in-tx' };
  const got = await inTransaction(tx as unknown as TenantDb, async (t) => t);
  assert.equal(got, tx);
});
