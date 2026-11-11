/**
 * 時效標籤測試（tasks B4.2）。
 *
 * ContactTag.expiresAt 原本是「有欄位但無人寫、無人清」的休眠欄位。
 * 本測試同時驗證寫入（addTagToTarget）與清理（handleTagExpiryCleanup）。
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 * 貼標以 app_tenant 連線在 inTenant() 內執行（RLS 生效）；本檔建立的聯絡人與標籤
 * 都帶唯一標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { inTenant } from '#src/lib/tenant-ctx.js';
import { addTagToTarget } from '#src/modules/tag/tagging.service.js';

const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const tenantId = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const MARK = `tag-expiry-test-${Date.now()}`;
let contactId = '';
let permanentTag = '';
let timedTag = '';

/**
 * 與 workers 的 handleTagExpiryCleanup 同條件（expiresAt 非 null 且已到期）；此處直接驗 SQL 行為。
 * 只清本檔的聯絡人，避免動到同一測試資料庫中其他測試的資料。
 */
async function cleanupExpired(now = new Date()) {
  const r = await owner.contactTag.deleteMany({ where: { contactId, expiresAt: { not: null, lte: now } } });
  return r.count;
}

beforeAll(async () => {
  const contact = await owner.contact.create({ data: { tenantId, displayName: `${MARK}-測試顧客` } });
  contactId = contact.id;
  const mkTag = async (name: string) =>
    (await owner.tag.create({ data: { tenantId, name: `${MARK}-${name}`, color: '#378ADD', scope: 'CONTACT' } })).id;
  permanentTag = await mkTag('永久');
  timedTag = await mkTag('時效');
});

afterAll(async () => {
  await owner.contactTag.deleteMany({ where: { contactId } });
  await owner.tag.deleteMany({ where: { tenantId, name: { startsWith: MARK } } });
  await owner.contact.deleteMany({ where: { tenantId, displayName: { startsWith: MARK } } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

it('可貼上永久標籤（expiresAt 為 null）', async () => {
  await inTenant(tenantDb, tenantId, (ctx) =>
    addTagToTarget(ctx, { targetType: 'CONTACT', targetId: contactId, tagId: permanentTag, addedBy: 'system' }));
  const row = await owner.contactTag.findFirst({ where: { contactId, tagId: permanentTag } });
  assert.ok(row, '未貼上標籤');
  assert.equal(row!.expiresAt, null, '永久標籤不應有到期時間');
});

it('可貼上時效標籤並寫入 expiresAt', async () => {
  const expiresAt = new Date(Date.now() + 60_000);
  await inTenant(tenantDb, tenantId, (ctx) =>
    addTagToTarget(ctx, { targetType: 'CONTACT', targetId: contactId, tagId: timedTag, addedBy: 'system', expiresAt }));
  const row = await owner.contactTag.findFirst({ where: { contactId, tagId: timedTag } });
  assert.ok(row?.expiresAt, '未寫入到期時間');
});

it('重複貼標會刷新效期（續期）', async () => {
  const later = new Date(Date.now() + 600_000);
  await inTenant(tenantDb, tenantId, (ctx) =>
    addTagToTarget(ctx, { targetType: 'CONTACT', targetId: contactId, tagId: timedTag, addedBy: 'system', expiresAt: later }));
  const row = await owner.contactTag.findFirst({ where: { contactId, tagId: timedTag } });
  assert.ok(row!.expiresAt!.getTime() > Date.now() + 300_000, '效期未被刷新');
});

it('未到期的時效標籤不會被清理', async () => {
  await cleanupExpired();
  const row = await owner.contactTag.findFirst({ where: { contactId, tagId: timedTag } });
  assert.ok(row, '未到期竟被清掉');
});

it('已到期的標籤會被清理', async () => {
  await owner.contactTag.updateMany({
    where: { contactId, tagId: timedTag },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const removed = await cleanupExpired();
  assert.ok(removed >= 1, `應清掉至少 1 筆，實得 ${removed}`);
  const row = await owner.contactTag.findFirst({ where: { contactId, tagId: timedTag } });
  assert.equal(row, null, '到期標籤未被清除');
});

it('清理不影響永久標籤', async () => {
  const row = await owner.contactTag.findFirst({ where: { contactId, tagId: permanentTag } });
  assert.ok(row, '永久標籤竟被清掉');
});
