/**
 * 時效標籤測試（tasks B4.2）。
 *   DATABASE_URL=... npx tsx src/__tests__/tag-expiry.test.ts
 *
 * ContactTag.expiresAt 原本是「有欄位但無人寫、無人清」的休眠欄位。
 * 本測試同時驗證寫入（addTagToTarget）與清理（handleTagExpiryCleanup）。
 */
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { withTenant } from '../lib/tenant-db.js';
import { addTagToTarget } from '../modules/tag/tagging.service.js';

const prisma = new PrismaClient();
let pass = 0;
let fail = 0;

async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.log(`FAIL  ${name}\n      ${(err as Error).message}`);
    fail += 1;
  }
}

/** 與 workers 的 handleTagExpiryCleanup 同邏輯；此處直接驗 SQL 行為。 */
async function cleanupExpired(now = new Date()) {
  const r = await prisma.contactTag.deleteMany({ where: { expiresAt: { not: null, lte: now } } });
  return r.count;
}

async function main() {
  const tenantId = randomUUID();
  const contactId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO tenants (id, name, "updatedAt") VALUES ($1::uuid,$2,now())`, tenantId, '標籤測試租戶');
  await prisma.$executeRawUnsafe(`INSERT INTO contacts (id, "tenantId", "displayName", "updatedAt") VALUES ($1::uuid,$2::uuid,$3,now())`, contactId, tenantId, '測試顧客');

  const mkTag = async (name: string) => {
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO tags (id, "tenantId", name, color, scope) VALUES ($1::uuid,$2::uuid,$3,$4,$5::"TagScope")`,
      id, tenantId, name, '#378ADD', 'CONTACT');
    return id;
  };
  const permanentTag = await mkTag(`永久-${Date.now()}`);
  const timedTag = await mkTag(`時效-${Date.now()}`);

  await t('可貼上永久標籤（expiresAt 為 null）', async () => {
    await withTenant(prisma, tenantId, (tx) =>
      addTagToTarget(tx, { tenantId, targetType: 'CONTACT', targetId: contactId, tagId: permanentTag, addedBy: 'system' }));
    const row = await prisma.contactTag.findFirst({ where: { contactId, tagId: permanentTag } });
    assert.ok(row, '未貼上標籤');
    assert.equal(row!.expiresAt, null, '永久標籤不應有到期時間');
  });

  await t('可貼上時效標籤並寫入 expiresAt', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    await withTenant(prisma, tenantId, (tx) =>
      addTagToTarget(tx, { tenantId, targetType: 'CONTACT', targetId: contactId, tagId: timedTag, addedBy: 'system', expiresAt }));
    const row = await prisma.contactTag.findFirst({ where: { contactId, tagId: timedTag } });
    assert.ok(row?.expiresAt, '未寫入到期時間');
  });

  await t('重複貼標會刷新效期（續期）', async () => {
    const later = new Date(Date.now() + 600_000);
    await withTenant(prisma, tenantId, (tx) =>
      addTagToTarget(tx, { tenantId, targetType: 'CONTACT', targetId: contactId, tagId: timedTag, addedBy: 'system', expiresAt: later }));
    const row = await prisma.contactTag.findFirst({ where: { contactId, tagId: timedTag } });
    assert.ok(row!.expiresAt!.getTime() > Date.now() + 300_000, '效期未被刷新');
  });

  await t('未到期的時效標籤不會被清理', async () => {
    await cleanupExpired();
    const row = await prisma.contactTag.findFirst({ where: { contactId, tagId: timedTag } });
    assert.ok(row, '未到期竟被清掉');
  });

  await t('已到期的標籤會被清理', async () => {
    await prisma.contactTag.updateMany({
      where: { contactId, tagId: timedTag },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const removed = await cleanupExpired();
    assert.ok(removed >= 1, `應清掉至少 1 筆，實得 ${removed}`);
    const row = await prisma.contactTag.findFirst({ where: { contactId, tagId: timedTag } });
    assert.equal(row, null, '到期標籤未被清除');
  });

  await t('清理不影響永久標籤', async () => {
    const row = await prisma.contactTag.findFirst({ where: { contactId, tagId: permanentTag } });
    assert.ok(row, '永久標籤竟被清掉');
  });

  await prisma.$executeRawUnsafe(`DELETE FROM contact_tags WHERE "contactId" = $1::uuid`, contactId);
  await prisma.$executeRawUnsafe(`DELETE FROM tags WHERE "tenantId" = $1::uuid`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM contacts WHERE "tenantId" = $1::uuid`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1::uuid`, tenantId);

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('測試執行失敗：', err);
  await prisma.$disconnect();
  process.exit(1);
});
