/**
 * 回填 migration 20261023120000_channel_identity_follow_tracking（add-coupon-system A15 15.13；design D28；
 * spec automation-engine「記錄加入好友的次數」：本功能上線前已存在的 LINE 渠道身分視為已加入過）。
 *
 * 測試讀出 migration.sql 的回填語句，在 owner（superuser）交易內對自建資料執行並斷言，最後回滾：
 * 語句是全域的，不能留下對其他測試資料的寫入。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, test } from 'vitest';
import { repoRoot } from '#tests/support/paths.js';

const owner = new PrismaClient();
const MARK = `ci-follow-backfill-${Date.now()}`;

afterAll(async () => {
  await owner.$disconnect();
});

const migrationPath = resolve(
  repoRoot,
  'packages/database/prisma/migrations/20261023120000_channel_identity_follow_tracking/migration.sql',
);

async function readSection(name: 'guard' | 'backfill'): Promise<string> {
  const sql = await readFile(migrationPath, 'utf8');
  const parts = sql.split(/^-- @(guard|backfill)\s*$/m);
  const index = parts.indexOf(name);
  assert.ok(index >= 0, `migration.sql 缺少 -- @${name} 區段`);
  return parts[index + 1]!.trim();
}

class Rollback extends Error {}

async function inRolledBackTransaction(fn: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await owner.$transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
}

async function seed(tx: Prisma.TransactionClient) {
  const tenant = await tx.tenant.create({ data: { name: `${MARK} 租戶` } });
  const contact = await tx.contact.create({ data: { tenantId: tenant.id, displayName: `${MARK} 顧客` } });
  const channel = (channelType: 'LINE' | 'FB') =>
    tx.channel.create({ data: { tenantId: tenant.id, channelType, displayName: `${MARK}-${channelType}`, credentialsEncrypted: 'x' } });
  const line = await channel('LINE');
  const fb = await channel('FB');
  const linkedAt = new Date('2026-01-15T00:00:00.000Z');
  const followedAt = new Date('2026-10-20T00:00:00.000Z');
  const identity = (channelId: string, channelType: 'LINE' | 'FB', uid: string, data: Record<string, unknown> = {}) =>
    tx.channelIdentity.create({ data: { contactId: contact.id, channelId, channelType, uid: `${MARK}-${uid}`, linkedAt, ...data } });
  return {
    linkedAt,
    followedAt,
    lineLegacy: await identity(line.id, 'LINE', 'legacy'),
    lineRecorded: await identity(line.id, 'LINE', 'recorded', { firstFollowedAt: followedAt, lastFollowedAt: followedAt, followCount: 1 }),
    fb: await identity(fb.id, 'FB', 'fb'),
  };
}

const reload = (tx: Prisma.TransactionClient, id: string) => tx.channelIdentity.findUniqueOrThrow({ where: { id } });

test('上線前就是好友的顧客：既有 LINE 渠道身分回填 firstFollowedAt = linkedAt，加入次數不推定', async () => {
  const backfill = await readSection('backfill');
  await inRolledBackTransaction(async (tx) => {
    const d = await seed(tx);
    await tx.$executeRawUnsafe(backfill);
    const legacy = await reload(tx, d.lineLegacy.id);
    assert.deepEqual(legacy.firstFollowedAt, d.linkedAt);
    assert.equal(legacy.lastFollowedAt, null);
    assert.equal(legacy.followCount, 0);
  });
});

test('已有加入紀錄的身分不動；其他渠道沒有加好友事件，不回填', async () => {
  const backfill = await readSection('backfill');
  await inRolledBackTransaction(async (tx) => {
    const d = await seed(tx);
    await tx.$executeRawUnsafe(backfill);
    assert.deepEqual((await reload(tx, d.lineRecorded.id)).firstFollowedAt, d.followedAt);
    assert.equal((await reload(tx, d.fb.id)).firstFollowedAt, null);
  });
});

test('回填執行兩次：第二次不更新', async () => {
  const backfill = await readSection('backfill');
  await inRolledBackTransaction(async (tx) => {
    await seed(tx);
    await tx.$executeRawUnsafe(backfill);
    assert.equal(await tx.$executeRawUnsafe(backfill), 0);
  });
});

test('執行身分不能略過 RLS 時中止，不會靜默回填 0 筆', async () => {
  const guard = await readSection('guard');
  await assert.rejects(
    owner.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE app_tenant');
      await tx.$executeRawUnsafe(guard);
    }),
    /回填需要能略過 RLS 的資料庫身分/,
  );
  await owner.$executeRawUnsafe(guard);
});
