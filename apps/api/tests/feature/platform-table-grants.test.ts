/**
 * 平台層資料表的 app_tenant 權限（issue #412、AUDIT RLS-10）。
 *
 * 平台層表沒有 RLS（AGENTS.md 列出的 7 張），所以 app_tenant 能做什麼只由 GRANT 決定：
 * - 租戶路徑會讀 tenants、plans、platform_settings、model_pricings，只保留 SELECT。
 * - platform_users、platform_audit_logs、trial_signups 只有 app_admin 路徑使用，app_tenant 連讀都不行。
 * - 任何平台層表 app_tenant 都不能寫。
 * 另外檢查預設權限：之後新建的表不再自動授權給 app_tenant，所以每張開了 FORCE RLS 的租戶表
 * 都必須在自己的 migration 明確 GRANT（這裡一併檢查，避免漏 GRANT 到上線才 permission denied）。
 */
import assert from 'node:assert/strict';
import { afterAll, describe, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { tenantScopedClient, withTenant } from '#src/lib/tenant-db.js';
import { readAiPrivacyPolicy } from '#src/modules/platform/ai-privacy.service.js';
import { clearPricingCache, getPricing } from '#src/modules/ai/pricing.service.js';
import { getEffectiveLimit } from '#src/modules/platform/plan-limits.service.js';
import { TENANT_A, urls } from '#tests/setup/feature-config.js';

const tenantDb = new PrismaClient({ datasources: { db: { url: urls.tenant } } });
const ownerDb = new PrismaClient({ datasources: { db: { url: urls.owner } } });

afterAll(async () => {
  await tenantDb.$disconnect();
  await ownerDb.$disconnect();
});

/** 租戶路徑只需要讀的平台層表 */
const READ_ONLY_TABLES = ['tenants', 'plans', 'platform_settings', 'model_pricings'];
/** 租戶路徑完全不碰的平台層表 */
const NO_ACCESS_TABLES = ['platform_users', 'platform_audit_logs', 'trial_signups', '_prisma_migrations'];

/** 以 app_tenant 執行一句 SQL，回傳 Postgres 錯誤碼（成功回 null）。都包在會 rollback 的交易裡。 */
async function runAsTenant(sql: string): Promise<string | null> {
  try {
    await tenantDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(sql);
      throw new RollbackSignal();
    });
    return null;
  } catch (err) {
    if (err instanceof RollbackSignal) return null;
    const message = String((err as Error).message);
    const code = (err as { meta?: { code?: string } }).meta?.code ?? message.match(/Code: `(\w+)`/)?.[1];
    return code ?? message;
  }
}
class RollbackSignal extends Error {}

describe('app_tenant 不能寫平台層表', () => {
  for (const table of [...READ_ONLY_TABLES, ...NO_ACCESS_TABLES]) {
    test(`${table}：INSERT、UPDATE、DELETE 都回 42501`, async () => {
      // WHERE false：不動任何資料，但 Postgres 在規劃時就檢查權限
      assert.equal(await runAsTenant(`INSERT INTO "${table}" SELECT * FROM "${table}" WHERE false`), '42501');
      assert.equal(await runAsTenant(`UPDATE "${table}" SET "${await firstColumn(table)}" = "${await firstColumn(table)}" WHERE false`), '42501');
      assert.equal(await runAsTenant(`DELETE FROM "${table}" WHERE false`), '42501');
    });
  }
});

describe('app_tenant 讀不到只有平台方使用的表', () => {
  for (const table of NO_ACCESS_TABLES) {
    test(`${table}：SELECT 回 42501`, async () => {
      assert.equal(await runAsTenant(`SELECT 1 FROM "${table}" LIMIT 1`), '42501');
    });
  }
});

describe('租戶路徑需要的讀取仍可用', () => {
  for (const table of READ_ONLY_TABLES) {
    test(`${table}：SELECT 成功`, async () => {
      assert.equal(await runAsTenant(`SELECT 1 FROM "${table}" LIMIT 1`), null);
    });
  }

  test('readAiPrivacyPolicy 以綁定租戶的 client 讀 platform_settings', async () => {
    const policy = await readAiPrivacyPolicy(tenantScopedClient(tenantDb, TENANT_A), TENANT_A);
    assert.equal(typeof policy.enabled, 'boolean');
  });

  test('getPricing 在租戶交易內讀 model_pricings', async () => {
    clearPricingCache();
    const model = `grants-test-${Date.now()}`;
    await ownerDb.modelPricing.create({
      data: { model, inputPer1M: 1, outputPer1M: 2, cachedPer1M: 0.5, effectiveFrom: new Date(Date.now() - 60_000) },
    });
    try {
      // getPricing 收 TenantCtx，在交易 2 內讀價目（change migrate-ai-llm-tenant-ctx）
      const pricing = await withTenant(tenantDb, TENANT_A, (tx) => getPricing({ tx, tenantId: TENANT_A }, model));
      assert.equal(pricing?.model, model);
    } finally {
      await ownerDb.modelPricing.deleteMany({ where: { model } });
      clearPricingCache();
    }
  });

  test('getEffectiveLimit 以綁定租戶的 client 讀 tenants 與 plans', async () => {
    const limit = await getEffectiveLimit(tenantScopedClient(tenantDb, TENANT_A), TENANT_A, 'maxAgents');
    assert.ok(limit === null || typeof limit === 'number');
  });

  test('withTenant 的 tx 讀 tenants（租戶名稱）', async () => {
    const tenant = await withTenant(tenantDb, TENANT_A, (tx) =>
      tx.tenant.findUnique({ where: { id: TENANT_A }, select: { name: true } }),
    );
    assert.equal(tenant?.name, 'Feature Test Tenant A');
  });
});

describe('權限結構', () => {
  test('沒有 FORCE RLS 的表，app_tenant 只能讀 READ_ONLY_TABLES，不能寫任何一張', async () => {
    const rows = await ownerDb.$queryRaw<Array<{ relname: string; can_read: boolean; can_write: boolean }>>`
      SELECT c.relname,
             has_table_privilege('app_tenant', c.oid, 'SELECT') AS can_read,
             has_table_privilege('app_tenant', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') AS can_write
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
       ORDER BY c.relname`;
    const writable = rows.filter((r) => r.can_write).map((r) => r.relname);
    const readable = rows.filter((r) => r.can_read).map((r) => r.relname);
    assert.deepEqual(writable, []);
    assert.deepEqual(readable, [...READ_ONLY_TABLES].sort());
  });

  test('每張 FORCE RLS 的表都授權 app_tenant 讀寫（新表要在 migration 明確 GRANT）', async () => {
    // has_table_privilege 的多權限寫法是「任一」，所以逐項檢查
    const missing = await ownerDb.$queryRaw<Array<{ relname: string; priv: string }>>`
      SELECT c.relname, p.priv
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND c.relrowsecurity AND c.relforcerowsecurity
         AND NOT has_table_privilege('app_tenant', c.oid, p.priv)
       ORDER BY c.relname, p.priv`;
    assert.deepEqual(missing, []);
  });

  test('schema public 的預設權限不再把新表授權給 app_tenant', async () => {
    const rows = await ownerDb.$queryRaw<Array<{ acl: string }>>`
      SELECT d.defaclacl::text AS acl
        FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
       WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'`;
    for (const { acl } of rows) assert.ok(!/\bapp_tenant=/.test(acl), `預設權限仍授權 app_tenant：${acl}`);
  });
});

const columnCache = new Map<string, string>();
async function firstColumn(table: string): Promise<string> {
  const hit = columnCache.get(table);
  if (hit) return hit;
  const rows = await ownerDb.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${table}
     ORDER BY ordinal_position LIMIT 1`;
  columnCache.set(table, rows[0].column_name);
  return rows[0].column_name;
}
