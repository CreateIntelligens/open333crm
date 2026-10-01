/**
 * RLS 租戶隔離整合測試（對真實 Postgres + app_tenant/app_admin role）。
 *
 * 5 類：正向隔離、fail-closed、連線池不殘留、白名單 bypass、WITH CHECK 防越權寫入。
 * 前置：DB 已套 RLS migration（roles+grants / enable_core / enable_tenantid / enable_child），
 * 且 app_tenant(NOBYPASSRLS)/app_admin(BYPASSRLS) role 存在並有密碼。
 *
 * 屬於 feature 組：tests/setup/ 會建立測試資料庫、套 migration、建立租戶 A、B，
 * 並以 DATABASE_URL_TENANT／DATABASE_URL_ADMIN 提供兩種角色的連線。
 */
import assert from 'node:assert/strict';
import { test, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { withTenant, tenantScopedClient } from '#src/lib/tenant-db.js';

const TENANT_URL = process.env.DATABASE_URL_TENANT;
const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
// 測試資料：兩個租戶（CI seed 注入），A 有 contacts、B 無（或不同數）
const TENANT_A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const TENANT_B = process.env.RLS_TEST_TENANT_B ?? 'd207783b-58a6-48a1-838c-526874ce1606';

if (!TENANT_URL || !ADMIN_URL) {
  throw new Error('rls-isolation 需要 DATABASE_URL_TENANT / DATABASE_URL_ADMIN，由 tests/setup/feature.env.ts 提供');
}

const tenantDb = new PrismaClient({ datasources: { db: { url: TENANT_URL } } });
const adminDb = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });

// 取 A 租戶的實際 contact 數（用 admin bypass 查基準）
let countA = 0;
test('setup: 用 admin(bypass) 取基準數', async () => {
  countA = await adminDb.contact.count({ where: { tenantId: TENANT_A } });
  assert.ok(countA >= 0);
});

test('① fail-closed：app_tenant 未綁定 → 0 列', async () => {
  const n = await tenantDb.contact.count();
  assert.equal(n, 0, '未設 app.current_tenant 應 fail-closed 回 0');
});

test('② 正向隔離：綁 A → 只見 A 的資料', async () => {
  const n = await withTenant(tenantDb, TENANT_A, (tx) => tx.contact.count());
  assert.equal(n, countA, '綁 A 應見 A 的全部 contacts');
});

test('③ 跨租戶隔離：綁 B → 看不到 A 的資料', async () => {
  const nB = await withTenant(tenantDb, TENANT_B, (tx) => tx.contact.count());
  // B 的數量不該等於 A（除非巧合同數）；關鍵是綁 B 時 A 的列不可見
  const aVisibleUnderB = await withTenant(tenantDb, TENANT_B, (tx) =>
    tx.contact.count({ where: { tenantId: TENANT_A } }),
  );
  assert.equal(aVisibleUnderB, 0, '綁 B 時不該看到任何 A 租戶的 contact');
  assert.ok(nB >= 0);
});

test('④ 連線池不殘留：連續綁 A、B，各自獨立（SET LOCAL 交易語意）', async () => {
  const a1 = await withTenant(tenantDb, TENANT_A, (tx) => tx.contact.count());
  const b1 = await withTenant(tenantDb, TENANT_B, (tx) =>
    tx.contact.count({ where: { tenantId: TENANT_A } }),
  );
  assert.equal(a1, countA);
  assert.equal(b1, 0, '第二個交易綁 B，不該殘留 A 的 tenant 設定');
});

test('⑤ $extends 綁定：tenantScopedClient 照舊呼叫也隔離', async () => {
  const scoped = tenantScopedClient(tenantDb, TENANT_A);
  const n = await scoped.contact.count();
  assert.equal(n, countA, '$extends 自動綁定應等同 withTenant');
});

test('⑥ WITH CHECK：綁 A 時 INSERT B 租戶的列被擋', async () => {
  await assert.rejects(
    withTenant(tenantDb, TENANT_A, (tx) =>
      tx.$executeRawUnsafe(
        `INSERT INTO contacts (id, "tenantId", "displayName", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1::uuid, 'RLS-CI-越權', now(), now())`,
        TENANT_B,
      ),
    ),
    /row-level security|violates/i,
    '綁 A 時寫入 B 租戶 tenantId 應被 WITH CHECK 擋',
  );
});

test('⑦ 白名單 admin bypass：app_admin 未綁定也能跨租戶查', async () => {
  const total = await adminDb.contact.count();
  assert.ok(total >= countA, 'admin(BYPASSRLS) 不受 RLS 限制，能看到全部租戶資料');
});

// ─── 標籤（2026-09-23 素材標籤統一後補上）──────────────────────────────
//
// 標籤的 @@unique 是 [tenantId, name, scope]，「同名不同租戶」是合法且常見的
// （兩家公司都會有「促銷」）。這正是隔離失效時最容易出事的形狀：
// 漏帶 tenantId 的查詢會撈到別家的標籤，而且名稱一樣、肉眼看不出來。

test('⑧ 標籤正向隔離：同名標籤不會跨租戶互見', async () => {
  const NAME = 'RLS-CI-同名標籤';
  // 兩個租戶各建一筆同名標籤（用 admin 繞過 RLS 建資料）
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await adminDb.tag
      .create({ data: { tenantId, name: NAME, scope: 'MATERIAL', type: 'MANUAL' } })
      .catch(() => {}); // 已存在就略過
  }

  const seenByA = await withTenant(tenantDb, TENANT_A, (tx) =>
    tx.tag.findMany({ where: { name: NAME }, select: { tenantId: true } }),
  );
  assert.equal(seenByA.length, 1, '綁 A 時同名標籤只該看到自己那筆');
  assert.equal(seenByA[0].tenantId, TENANT_A);

  const seenByB = await withTenant(tenantDb, TENANT_B, (tx) =>
    tx.tag.findMany({ where: { name: NAME }, select: { tenantId: true } }),
  );
  assert.equal(seenByB.length, 1, '綁 B 時同名標籤只該看到自己那筆');
  assert.equal(seenByB[0].tenantId, TENANT_B);
});

test('⑨ 標籤 fail-closed：未綁租戶 → 查不到任何標籤', async () => {
  const n = await tenantDb.tag.count();
  assert.equal(n, 0, '未設 app.current_tenant 時標籤應 fail-closed');
});

test('⑩ 標籤 WITH CHECK：綁 A 時不可寫入 B 租戶的標籤', async () => {
  await assert.rejects(
    () =>
      withTenant(tenantDb, TENANT_A, (tx) =>
        tx.tag.create({
          data: {
            tenantId: TENANT_B,
            name: 'RLS-CI-越權標籤',
            scope: 'MATERIAL',
            type: 'MANUAL',
          },
        }),
      ),
    /row-level security|violates/i,
    '綁 A 時寫入 B 租戶的標籤應被 WITH CHECK 擋',
  );
});

// ─── 合併紀錄（2026-09-29 跨渠道 One ID 新增 contact_merge_logs）──────────
//
// movedRecords 記著另一個租戶的聯絡人／對話 id，外洩等同洩漏客戶關聯，須與 contacts 同級隔離。

const MERGE_LOG_MARK = { rlsCi: true };

test('⑪ 合併紀錄正向隔離：綁 B 看不到 A 的合併紀錄', async () => {
  const log = await adminDb.contactMergeLog.create({
    data: {
      tenantId: TENANT_A,
      survivorId: '00000000-0000-0000-0000-00000000a001',
      mergedId: '00000000-0000-0000-0000-00000000a002',
      source: 'MANUAL',
      movedRecords: MERGE_LOG_MARK,
    },
  });

  const seenByA = await withTenant(tenantDb, TENANT_A, (tx) =>
    tx.contactMergeLog.count({ where: { id: log.id } }),
  );
  assert.equal(seenByA, 1, '綁 A 應看得到自己的合併紀錄');

  const seenByB = await withTenant(tenantDb, TENANT_B, (tx) =>
    tx.contactMergeLog.count({ where: { id: log.id } }),
  );
  assert.equal(seenByB, 0, '綁 B 不該看到 A 的合併紀錄');

  const unbound = await tenantDb.contactMergeLog.count();
  assert.equal(unbound, 0, '未綁租戶時合併紀錄應 fail-closed');
});

test('⑫ 合併紀錄 WITH CHECK：綁 A 時不可寫入 B 租戶的合併紀錄', async () => {
  await assert.rejects(
    () =>
      withTenant(tenantDb, TENANT_A, (tx) =>
        tx.contactMergeLog.create({
          data: {
            tenantId: TENANT_B,
            survivorId: '00000000-0000-0000-0000-00000000b001',
            mergedId: '00000000-0000-0000-0000-00000000b002',
            source: 'MANUAL',
            movedRecords: MERGE_LOG_MARK,
          },
        }),
      ),
    /row-level security|violates/i,
    '綁 A 時寫入 B 租戶的合併紀錄應被 WITH CHECK 擋',
  );
});

afterAll(async () => {
  // 清理可能殘留的越權測試列（用 admin）
  await adminDb.contactMergeLog
    .deleteMany({ where: { movedRecords: { equals: MERGE_LOG_MARK } } })
    .catch(() => {});
  await adminDb.contact
    .deleteMany({ where: { displayName: 'RLS-CI-越權' } })
    .catch(() => {});
  await adminDb.tag
    .deleteMany({ where: { name: { startsWith: 'RLS-CI-' } } })
    .catch(() => {});
  await tenantDb.$disconnect();
  await adminDb.$disconnect();
});
