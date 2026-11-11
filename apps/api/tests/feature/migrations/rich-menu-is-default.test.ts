/**
 * migration 20261105100000_rich_menu_is_default（change migrate-line-tenant-ctx，spec line-rich-menu
 * 「圖文選單展開狀態」的「既有選單的預設狀態」）。
 *
 * selected 原本同時代表「所有好友的預設選單」，migration 以它填入 isDefault，selected 不變。
 * 測試庫已套用 migration（欄位已存在），所以只對自建資料重跑其中的 UPDATE，在 owner 交易內斷言後回滾：
 * UPDATE 是全域的，不能留下對其他測試資料的寫入。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, test } from 'vitest';
import { repoRoot } from '#tests/support/paths.js';

const owner = new PrismaClient();
const MARK = `ci-rich-menu-is-default-${Date.now()}`;

afterAll(async () => {
  await owner.$disconnect();
});

const migrationPath = resolve(
  repoRoot,
  'packages/database/prisma/migrations/20261105100000_rich_menu_is_default/migration.sql',
);

/** 只取 migration 中的 UPDATE（ADD COLUMN 已在測試庫套用過） */
async function runBackfill(tx: Prisma.TransactionClient): Promise<number> {
  const sql = (await readFile(migrationPath, 'utf8'))
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const updates = sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith('UPDATE'));
  assert.equal(updates.length, 1, 'migration 應有一條 UPDATE');
  return tx.$executeRawUnsafe(updates[0]);
}

class Rollback extends Error {}

test('既有選單的預設狀態：selected 是 true 的列 isDefault 變成 true，selected 不變', async () => {
  try {
    await owner.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: MARK } });
      const channel = await tx.channel.create({
        data: { tenantId: tenant.id, channelType: 'LINE', displayName: MARK, credentialsEncrypted: 'x' },
      });
      const base = {
        tenantId: tenant.id,
        channelId: channel.id,
        chatBarText: '選單',
        size: { width: 2500, height: 843 },
        areas: [],
        imageUrl: 'https://example.test/menu.png',
        isDefault: false,
      };
      const wasDefault = await tx.richMenu.create({ data: { ...base, name: `${MARK}-預設`, selected: true } });
      const notDefault = await tx.richMenu.create({ data: { ...base, name: `${MARK}-非預設`, selected: false } });

      await runBackfill(tx);

      const after = (id: string) => tx.richMenu.findUniqueOrThrow({ where: { id } });
      const a = await after(wasDefault.id);
      const b = await after(notDefault.id);
      assert.equal(a.isDefault, true);
      assert.equal(a.selected, true);
      assert.equal(b.isDefault, false);
      assert.equal(b.selected, false);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
});
