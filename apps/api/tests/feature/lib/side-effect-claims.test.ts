/**
 * claimSideEffect() 對真實 PostgreSQL 與 app_tenant 的行為
 * （change outbox-event-delivery：side-effect-claims「一個認領鍵只能認領一次」）。
 *
 * 這些行為來自 PostgreSQL 的 INSERT … ON CONFLICT DO NOTHING。測試以 kind = MARK 寫入，
 * afterAll 用 admin 連線刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { claimSideEffect, type SideEffectKey } from '@open333crm/core';
import { inTenant } from '#src/lib/tenant-ctx.js';
import { backendPid, waitUntilBlockedBy } from '../../support/wait-for-lock-wait.js';

const TENANT_URL = process.env.DATABASE_URL_TENANT;
const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
const TENANT_A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';

if (!TENANT_URL || !ADMIN_URL) {
  throw new Error('side-effect-claims 需要 DATABASE_URL_TENANT / DATABASE_URL_ADMIN，由 tests/setup/feature.env.ts 提供');
}

const tenantDb = new PrismaClient({ datasources: { db: { url: TENANT_URL } } });
const adminDb = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
// kind 的型別只收四種名稱；測試用獨特的值標記自己寫入的資料，方便清除
const MARK = `claims-${randomUUID()}` as SideEffectKey['kind'];
const deps = { prisma: tenantDb, events: { publish() {} } };

afterAll(async () => {
  await adminDb.sideEffectClaim.deleteMany({ where: { kind: MARK } });
  await tenantDb.$disconnect();
  await adminDb.$disconnect();
});

function keyOf(sourceId: string): SideEffectKey {
  return { tenantId: TENANT_A, kind: MARK, sourceId };
}

test('已經認領過：回報失敗，同一個交易之後的查詢成功', async () => {
  const key = keyOf(randomUUID());
  await inTenant(deps, TENANT_A, (ctx) => claimSideEffect(ctx.tx, key));

  const { claimed, countAfter } = await inTenant(deps, TENANT_A, async (ctx) => {
    const claimed = await claimSideEffect(ctx.tx, key);
    // 交易若因衝突進入 aborted 狀態，這個查詢會失敗
    const countAfter = await ctx.tx.sideEffectClaim.count({ where: { kind: MARK, sourceId: key.sourceId } });
    return { claimed, countAfter };
  });

  assert.equal(claimed, false);
  assert.equal(countAfter, 1);
});

test('兩個交易同時認領同一個鍵：只有一個成功', async () => {
  const key = keyOf(randomUUID());
  let releaseFirst!: () => void;
  const firstMayCommit = new Promise<void>((resolve) => (releaseFirst = resolve));
  let firstClaimed!: (pid: number) => void;
  const firstPid = new Promise<number>((resolve) => (firstClaimed = resolve));

  const first = inTenant(deps, TENANT_A, async (ctx) => {
    const claimed = await claimSideEffect(ctx.tx, key);
    firstClaimed(await backendPid(ctx.tx));
    await firstMayCommit;
    return claimed;
  });

  try {
    const pid = await firstPid;
    const second = inTenant(deps, TENANT_A, (ctx) => claimSideEffect(ctx.tx, key));
    // 第二個交易要卡在唯一索引上，等第一個交易 commit；否則測到的只是先後執行
    await waitUntilBlockedBy(adminDb, pid);
    releaseFirst();
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual([a, b], [true, false]);
  } finally {
    releaseFirst();
  }
});

test('先認領的交易 rollback：之後的認領成功', async () => {
  const key = keyOf(randomUUID());
  await assert.rejects(
    inTenant(deps, TENANT_A, async (ctx) => {
      assert.equal(await claimSideEffect(ctx.tx, key), true);
      throw new Error('rollback');
    }),
    /rollback/,
  );

  const claimed = await inTenant(deps, TENANT_A, (ctx) => claimSideEffect(ctx.tx, key));
  assert.equal(claimed, true);
});
