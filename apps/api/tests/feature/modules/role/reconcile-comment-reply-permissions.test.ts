/**
 * 部署後跑 reconcile，既有租戶的 system role 拿到留言自動私訊權限（change add-comment-keyword-private-reply tasks 9.6；
 * design「上線與回滾」第 2 步、Open Questions 2：ADMIN、SUPERVISOR 有 view＋manage，AGENT 有 view）。
 *
 * scripts/reconcile-system-role-permissions.mjs 對每個租戶在交易內呼叫 seedRolesForTenant()；
 * 這裡對「部署前就存在」的租戶（system role 沒有 comment_reply.*）呼叫同一個函式，並確認腳本確實呼叫它。
 * 腳本本身從 repo 根目錄解析不到 workspace 套件（pnpm 不 hoist），所以不在測試裡另開 node 行程執行。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedRolesForTenant } from '@open333crm/core';
import { repoRoot } from '#tests/support/paths.js';

const prisma = new PrismaClient();
const tenant = await prisma.tenant.create({ data: { name: `ci-reconcile-cr-${Date.now()}` } });

afterAll(async () => {
  await prisma.rolePermission.deleteMany({ where: { role: { tenantId: tenant.id } } });
  await prisma.role.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.tenant.delete({ where: { id: tenant.id } });
  await prisma.$disconnect();
});

const codesOf = async (slug: string) =>
  (await prisma.rolePermission.findMany({ where: { role: { tenantId: tenant.id, slug } }, select: { permissionCode: true } })).map((p) => p.permissionCode);

test('reconcile 後既有租戶的 ADMIN、SUPERVISOR 有 view＋manage，AGENT 有 view', async () => {
  // 部署前的狀態：system role 存在，但沒有 comment_reply.*
  await seedRolesForTenant(prisma, tenant.id);
  await prisma.rolePermission.deleteMany({ where: { role: { tenantId: tenant.id }, permissionCode: { startsWith: 'comment_reply.' } } });
  for (const slug of ['admin', 'supervisor', 'agent']) {
    assert.equal((await codesOf(slug)).some((c) => c.startsWith('comment_reply.')), false);
  }

  await prisma.$transaction(async (tx) => {
    await seedRolesForTenant(tx, tenant.id);
  });

  for (const slug of ['admin', 'supervisor']) {
    const codes = await codesOf(slug);
    assert.ok(codes.includes('comment_reply.view') && codes.includes('comment_reply.manage'), `${slug}：${codes.filter((c) => c.startsWith('comment_reply')).join(',')}`);
  }
  const agent = await codesOf('agent');
  assert.ok(agent.includes('comment_reply.view'));
  assert.equal(agent.includes('comment_reply.manage'), false);
});

test('reconcile 腳本對每個租戶呼叫 seedRolesForTenant（上面的行為就是腳本做的事）', () => {
  const source = readFileSync(join(repoRoot, 'scripts/reconcile-system-role-permissions.mjs'), 'utf8');
  assert.match(source, /prisma\.tenant\.findMany\(/);
  assert.match(source, /seedRolesForTenant\(tx, t\.id\)/);
});
