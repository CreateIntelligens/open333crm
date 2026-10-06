/**
 * 資料 migration 20261005100000_remove_retired_automation_actions（change fix-automation-remaining-actions）。
 *
 * assign_bot、kb_auto_reply、llm_reply 從契約拿掉後，含這些動作的既有規則契約驗證會失敗、
 * workers 整條略過。migration 把它們清掉：還有其他動作的規則只移除這 3 種；只有這 3 種的規則停用。
 * 測試在 owner（superuser）交易內對自建資料執行 migration.sql 並斷言，最後回滾：
 * 語句是全域的，不能留下對其他測試資料的寫入。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, test } from 'vitest';
import { repoRoot } from '#tests/support/paths.js';

const owner = new PrismaClient();
const MARK = `ci-retired-${Date.now()}`;

afterAll(async () => {
  await owner.$disconnect();
});

const migrationPath = resolve(
  repoRoot,
  'packages/database/prisma/migrations/20261005100000_remove_retired_automation_actions/migration.sql',
);

/** migration.sql 的每一條語句（去掉註解）；回傳每條語句影響的列數總和 */
async function runMigration(tx: Prisma.TransactionClient): Promise<number> {
  const sql = (await readFile(migrationPath, 'utf8'))
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const statements = sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
  assert.equal(statements.length, 2, 'migration 應有兩條 UPDATE');
  let affected = 0;
  for (const statement of statements) affected += await tx.$executeRawUnsafe(statement);
  return affected;
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
  const rule = (name: string, actions: unknown[], isActive = true) =>
    tx.automationRule.create({
      data: {
        tenantId: tenant.id,
        name: `${MARK} ${name}`,
        eventType: 'message.received',
        trigger: { type: 'message.received' },
        conditions: { all: [] },
        actions: actions as Prisma.InputJsonValue,
        isActive,
      },
    });
  return {
    onlyRetired: await rule('只有已停用動作', [{ type: 'llm_reply', params: {} }, { type: 'assign_bot', params: {} }]),
    mixed: await rule('混合', [
      { type: 'add_tag', params: { tagName: 'A' } },
      { type: 'kb_auto_reply', params: {} },
      { type: 'send_message', params: { text: 'hi' } },
      { type: 'llm_reply', params: {} },
    ]),
    payloadFormat: await rule('payload 格式', [
      { type: 'add_tag', payload: { tagName: 'B' } },
      { type: 'assign_bot', payload: {} },
    ]),
    untouched: await rule('不受影響', [{ type: 'remove_tag', params: { tagName: 'C' } }]),
    inactiveRetired: await rule('已停用的舊規則', [{ type: 'llm_reply', params: {} }], false),
    emptyActions: await rule('空動作', []),
  };
}

const reload = (tx: Prisma.TransactionClient, id: string) =>
  tx.automationRule.findUniqueOrThrow({ where: { id }, select: { isActive: true, actions: true, updatedAt: true } });

test('只有已停用動作的規則：停用，動作保留原樣', async () => {
  await inRolledBackTransaction(async (tx) => {
    const r = await seed(tx);
    await runMigration(tx);
    const after = await reload(tx, r.onlyRetired.id);
    assert.equal(after.isActive, false);
    assert.deepEqual(after.actions, r.onlyRetired.actions, '動作保留，管理員打開時看得到原本的設定');
  });
});

test('混合的規則：只移除已停用動作，其他動作照原順序保留，仍然啟用', async () => {
  await inRolledBackTransaction(async (tx) => {
    const r = await seed(tx);
    await runMigration(tx);
    const after = await reload(tx, r.mixed.id);
    assert.equal(after.isActive, true);
    assert.deepEqual(after.actions, [
      { type: 'add_tag', params: { tagName: 'A' } },
      { type: 'send_message', params: { text: 'hi' } },
    ]);
    assert.deepEqual((await reload(tx, r.payloadFormat.id)).actions, [{ type: 'add_tag', payload: { tagName: 'B' } }], 'payload 格式一樣處理');
  });
});

test('不含已停用動作、已停用的舊規則、空動作：不動', async () => {
  await inRolledBackTransaction(async (tx) => {
    const r = await seed(tx);
    await runMigration(tx);
    for (const before of [r.untouched, r.inactiveRetired, r.emptyActions]) {
      const after = await reload(tx, before.id);
      assert.equal(after.isActive, before.isActive, before.name);
      assert.deepEqual(after.actions, before.actions, before.name);
      assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), `${before.name} 不應更新 updatedAt`);
    }
  });
});

test('執行兩次：第二次不影響任何列', async () => {
  await inRolledBackTransaction(async (tx) => {
    await seed(tx);
    await runMigration(tx);
    assert.equal(await runMigration(tx), 0);
  });
});
