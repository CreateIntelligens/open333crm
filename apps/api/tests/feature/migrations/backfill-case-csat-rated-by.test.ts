/**
 * 回填 migration 20261111100000_add_case_csat_rated_by（change csat-reresolve-decisions-339，issue #339 決定 8）。
 *
 * 已評分的工單依時間軸最後一筆 csat_rated 事件的 payload.source 回填 csatRatedBy；沒有事件的舊評分維持 NULL。
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
const MARK = `ci-csat-rated-by-${Date.now()}`;

afterAll(async () => {
  await owner.$disconnect();
});

const migrationPath = resolve(
  repoRoot,
  'packages/database/prisma/migrations/20261111100000_add_case_csat_rated_by/migration.sql',
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
  const channel = await tx.channel.create({
    data: { tenantId: tenant.id, channelType: 'LINE', displayName: MARK, credentialsEncrypted: 'x' },
  });
  const contact = await tx.contact.create({ data: { tenantId: tenant.id, displayName: MARK } });
  const kase = (csatScore: number | null) =>
    tx.case.create({ data: { tenantId: tenant.id, contactId: contact.id, channelId: channel.id, title: MARK, status: 'CLOSED', csatScore } });
  const rated = (caseId: string, source: string, createdAt: Date) =>
    tx.caseEvent.create({ data: { caseId, actorType: source === 'agent' ? 'agent' : 'contact', eventType: 'csat_rated', payload: { score: 4, source }, createdAt } });
  return { kase, rated };
}

test('既有評分依時間軸回填來源', async () => {
  const backfill = await readSection('backfill');
  await inRolledBackTransaction(async (tx) => {
    const { kase, rated } = await seed(tx);
    const agentRated = await kase(5);
    await rated(agentRated.id, 'agent', new Date('2026-11-05T00:00:00Z'));
    const legacy = await kase(3);
    const twice = await kase(4);
    await rated(twice.id, 'customer', new Date('2026-11-05T00:00:00Z'));
    await rated(twice.id, 'agent', new Date('2026-11-06T00:00:00Z'));

    await tx.$executeRawUnsafe(backfill);

    const read = async (id: string) => (await tx.case.findUniqueOrThrow({ where: { id } })).csatRatedBy;
    assert.equal(await read(agentRated.id), 'agent');
    assert.equal(await read(legacy.id), null, '沒有 csat_rated 事件的舊評分維持 NULL');
    assert.equal(await read(twice.id), 'agent', '取最後一筆事件');
  });
});

test('沒有評分的工單不回填，第二次執行不改變結果', async () => {
  const backfill = await readSection('backfill');
  await inRolledBackTransaction(async (tx) => {
    const { kase, rated } = await seed(tx);
    const unrated = await kase(null);
    await rated(unrated.id, 'customer', new Date('2026-11-05T00:00:00Z'));

    await tx.$executeRawUnsafe(backfill);
    const updatedAgain = await tx.$executeRawUnsafe(backfill);

    assert.equal((await tx.case.findUniqueOrThrow({ where: { id: unrated.id } })).csatRatedBy, null);
    assert.equal(updatedAgain, 0);
  });
});

test('執行身分不能略過 RLS 時中止，不會靜默寫入 0 筆', async () => {
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
