/**
 * 回填 migration 20261005120000_backfill_unbound_channel_access（change channel-visibility-fail-closed）。
 *
 * 渠道可見範圍改回 fail-closed 前，要先把「完全沒有綁定任何團隊或成員」的渠道直綁給該租戶所有
 * 啟用中的成員，部署當下才不會有人突然看不到。測試讀出 migration.sql 的回填語句，
 * 在 owner（superuser）交易內對自建資料執行並斷言，最後回滾：語句是全域的，不能留下對其他
 * 測試資料的寫入。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, test } from 'vitest';
import { repoRoot } from '#tests/support/paths.js';

const owner = new PrismaClient();
const MARK = `ci-backfill-${Date.now()}`;

afterAll(async () => {
  await owner.$disconnect();
});

const migrationPath = resolve(
  repoRoot,
  'packages/database/prisma/migrations/20261005120000_backfill_unbound_channel_access/migration.sql',
);

/** migration.sql 以 `-- @guard`、`-- @backfill` 標記兩段，分別取出執行 */
async function readSection(name: 'guard' | 'backfill'): Promise<string> {
  const sql = await readFile(migrationPath, 'utf8');
  const parts = sql.split(/^-- @(guard|backfill)\s*$/m);
  const index = parts.indexOf(name);
  assert.ok(index >= 0, `migration.sql 缺少 -- @${name} 區段`);
  return parts[index + 1]!.trim();
}

class Rollback extends Error {}

/** 在 owner 交易內建資料、執行回填、斷言，最後一律回滾 */
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
  const agent = (slug: string, isActive = true) =>
    tx.agent.create({
      data: { tenantId: tenant.id, email: `${MARK}-${slug}@example.test`, name: slug, passwordHash: 'x', isActive },
    });
  const channel = (slug: string, isActive = true) =>
    tx.channel.create({
      data: { tenantId: tenant.id, channelType: 'WEBCHAT', displayName: `${MARK}-${slug}`, credentialsEncrypted: 'x', isActive },
    });
  return {
    tenant,
    active1: await agent('active1'),
    active2: await agent('active2'),
    inactive: await agent('inactive', false),
    unbound: await channel('unbound'),
    unboundInactive: await channel('unbound-inactive', false),
    bound: await channel('bound'),
  };
}

async function bindings(tx: Prisma.TransactionClient, channelId: string) {
  const rows = await tx.agentChannelAccess.findMany({ where: { channelId }, select: { agentId: true, accessLevel: true } });
  return rows.sort((a, b) => a.agentId.localeCompare(b.agentId));
}

test('Unbound channel bound to all active members：含停用的渠道，不含停用的成員', async () => {
  const backfill = await readSection('backfill');
  await inRolledBackTransaction(async (tx) => {
    const d = await seed(tx);
    await tx.$executeRawUnsafe(backfill);
    const expected = [d.active1.id, d.active2.id].sort().map((agentId) => ({ agentId, accessLevel: 'full' }));
    assert.deepEqual(await bindings(tx, d.unbound.id), expected);
    assert.deepEqual(await bindings(tx, d.unboundInactive.id), expected, '停用的渠道也回填，重新啟用時才不會沒人看得到');
  });
});

test('Bound channel unchanged：已綁定的渠道不動', async () => {
  const backfill = await readSection('backfill');
  await inRolledBackTransaction(async (tx) => {
    const d = await seed(tx);
    await tx.agentChannelAccess.create({ data: { channelId: d.bound.id, agentId: d.active1.id, accessLevel: 'read_only' } });
    await tx.$executeRawUnsafe(backfill);
    assert.deepEqual(await bindings(tx, d.bound.id), [{ agentId: d.active1.id, accessLevel: 'read_only' }]);
  });
});

test('只綁團隊的渠道也不動', async () => {
  const backfill = await readSection('backfill');
  await inRolledBackTransaction(async (tx) => {
    const d = await seed(tx);
    const team = await tx.team.create({ data: { tenantId: d.tenant.id, name: `${MARK} 團隊` } });
    await tx.channelTeamAccess.create({ data: { channelId: d.bound.id, teamId: team.id, accessLevel: 'full' } });
    await tx.$executeRawUnsafe(backfill);
    assert.deepEqual(await bindings(tx, d.bound.id), []);
  });
});

test('Backfill runs twice：第二次不新增', async () => {
  const backfill = await readSection('backfill');
  await inRolledBackTransaction(async (tx) => {
    const d = await seed(tx);
    await tx.$executeRawUnsafe(backfill);
    const before = await tx.agentChannelAccess.count({ where: { channel: { tenantId: d.tenant.id } } });
    const added = await tx.$executeRawUnsafe(backfill);
    assert.equal(added, 0);
    assert.equal(await tx.agentChannelAccess.count({ where: { channel: { tenantId: d.tenant.id } } }), before);
  });
});

test('執行身分不能略過 RLS 時中止，不會靜默寫入 0 筆', async () => {
  const guard = await readSection('guard');
  // 交易內切換成 app_tenant（NOBYPASSRLS、非 superuser）執行，不需要 app_tenant 的密碼
  await assert.rejects(
    owner.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE app_tenant');
      await tx.$executeRawUnsafe(guard);
    }),
    /回填需要能略過 RLS 的資料庫身分/,
  );
  await owner.$executeRawUnsafe(guard); // superuser 通過
});
