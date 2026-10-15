/**
 * SLA 政策名稱在並行請求下仍不可重複（change fix-admin-settings-safeguards，sla-policy-selection；review #284）。
 * 「先查有無同名、再寫入」若沒有鎖，兩個同時送出的請求都會通過檢查，留下兩條同名政策，
 * 工單依名稱回查政策時就有歧義。
 *
 * 屬於 feature 組：需要真的 PostgreSQL 才能重現並行。
 */
import assert from 'node:assert/strict';
import { test, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { withTenant } from '#src/lib/tenant-db.js';
import { createSlaPolicy } from '#src/modules/sla/sla.service.js';

const prisma = new PrismaClient();
const TENANT = 'a0000000-0000-0000-0000-000000000001';
const MARK = `qa-sla-race-${Date.now()}`;

const input = (name: string) => ({
  name,
  priority: 'HIGH' as const,
  firstResponseMinutes: 30,
  resolutionMinutes: 240,
  warningBeforeMinutes: 30,
  isDefault: false,
});

afterAll(async () => {
  await withTenant(prisma, TENANT, (tx) =>
    tx.slaPolicy.deleteMany({ where: { tenantId: TENANT, name: { startsWith: MARK } } }),
  );
  await prisma.$disconnect();
});

test('同時建立多條同名政策，只有一條成功', async () => {
  const name = `${MARK}-same`;
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () => createSlaPolicy(prisma, TENANT, input(name))),
  );

  const ok = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  assert.equal(ok.length, 1);
  for (const r of rejected) assert.equal((r.reason as { code?: string }).code, 'DUPLICATE');

  const rows = await withTenant(prisma, TENANT, (tx) =>
    tx.slaPolicy.count({ where: { tenantId: TENANT, name } }),
  );
  assert.equal(rows, 1);
});
