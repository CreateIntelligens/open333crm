/**
 * 資料 migration 20261103120000_enable_channels_on_trial_light（issue #411，change enable-channels-on-trial-light-411）。
 *
 * 既有的 trial、light 方案 features 不含 channels。migration 只在這兩個 slug、features 還不含 channels 時
 * 把 channels 加進去，其他欄位與其他方案不變；重複執行不再改動。
 * 測試在 owner（superuser）交易內對自建資料執行 migration.sql 並斷言，最後回滾：
 * 語句是全域的（依 slug 更新），不能留下對其他測試資料的寫入。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, test } from 'vitest';
import { repoRoot } from '#tests/support/paths.js';

const owner = new PrismaClient();
const MARK = `ci-enable-channels-${Date.now()}`;

afterAll(async () => {
  await owner.$disconnect();
});

const migrationPath = resolve(
  repoRoot,
  'packages/database/prisma/migrations/20261103120000_enable_channels_on_trial_light/migration.sql',
);

/** 執行 migration.sql（去掉註解），回傳影響的列數 */
async function runMigration(tx: Prisma.TransactionClient): Promise<number> {
  const sql = (await readFile(migrationPath, 'utf8'))
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const statements = sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
  assert.equal(statements.length, 1, 'migration 應只有一條 UPDATE');
  return tx.$executeRawUnsafe(statements[0]);
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

/** 把 slug 方案設成修正前的內容（測試庫可能沒有這個方案，也可能有） */
async function upsertPlan(tx: Prisma.TransactionClient, slug: string, data: Prisma.PlanUncheckedUpdateInput & { features: string[] }) {
  return tx.plan.upsert({
    where: { slug },
    update: data,
    create: { slug, name: String(data.name ?? slug), ...data } as Prisma.PlanUncheckedCreateInput,
  });
}

test('既有方案補上 channels：trial、light 加入 channels，其他欄位與其他方案不變；重複執行不再改動', async () => {
  await inRolledBackTransaction(async (tx) => {
    const trial = await upsertPlan(tx, 'trial', {
      name: '免費試用（平台改名）',
      features: ['inbox', 'knowledge', 'core'],
      limits: { maxAgents: 7, maxChannels: 2 },
      allowedChannelTypes: ['LINE', 'WEBCHAT'],
      permissionOverrides: { deny: ['channel.delete'] },
      priceMonthly: 0,
    });
    const light = await upsertPlan(tx, 'light', { name: '輕量版', features: ['inbox', 'core'], limits: { maxAgents: 5 } });
    const other = await tx.plan.create({ data: { slug: `${MARK}-other`, name: MARK, features: ['inbox', 'core'] } });

    assert.equal(await runMigration(tx), 2);

    const after = async (id: string) => tx.plan.findUniqueOrThrow({ where: { id } });
    const trialAfter = await after(trial.id);
    assert.deepEqual(trialAfter.features, ['inbox', 'knowledge', 'core', 'channels']);
    assert.equal(trialAfter.name, '免費試用（平台改名）');
    assert.deepEqual(trialAfter.limits, { maxAgents: 7, maxChannels: 2 });
    assert.deepEqual(trialAfter.allowedChannelTypes, ['LINE', 'WEBCHAT']);
    assert.deepEqual(trialAfter.permissionOverrides, { deny: ['channel.delete'] });
    assert.deepEqual((await after(light.id)).features, ['inbox', 'core', 'channels']);
    assert.deepEqual((await after(other.id)).features, ['inbox', 'core']);

    assert.equal(await runMigration(tx), 0, '第二次執行沒有符合的列');
    assert.deepEqual((await after(light.id)).features, ['inbox', 'core', 'channels']);
  });
});

test('已含 channels 的方案不改動：features 順序與 updatedAt 不變', async () => {
  await inRolledBackTransaction(async (tx) => {
    const light = await upsertPlan(tx, 'light', { name: '輕量版', features: ['channels', 'inbox', 'core'] });
    assert.equal(await runMigration(tx), 0);
    const after = await tx.plan.findUniqueOrThrow({ where: { id: light.id } });
    assert.deepEqual(after.features, ['channels', 'inbox', 'core']);
    assert.equal(after.updatedAt.getTime(), light.updatedAt.getTime());
  });
});
