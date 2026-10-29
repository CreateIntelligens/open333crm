/**
 * Demo seed 的系統角色權限必須等於 DEFAULT_ROLE_PERMISSIONS。
 *
 * API 容器每次啟動都會跑 demo seed（apps/api/docker-entrypoint.sh），
 * seedDemoRoles() 先刪除 Demo Tenant 系統角色的權限碼，再依它的表重建。
 * 2026-10-29 發現 seed 用的是手抄的副本，新增的權限碼沒有同步：
 * 每次部署後，UAT 的 admin 少 9 個權限碼（例如 audit.view），稽核頁回 403。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, SYSTEM_ROLE_NAMES, SYSTEM_ROLE_SLUGS } from '#src/rbac/index.js';
import { seedDemoRoles } from '../../../../database/prisma/seed-data/rbac-roles.js';

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

/** 只實作 seedDemoRoles 會呼叫的方法，記下每個角色最後的權限碼與名稱 */
function fakePrisma() {
  const roles = new Map<string, { id: string; name: string; codes: string[] }>();
  const prisma = {
    role: {
      upsert: async ({ create }: { create: { slug: string; name: string } }) => {
        const role = roles.get(create.slug) ?? { id: `role-${create.slug}`, name: create.name, codes: ['stale.code'] };
        role.name = create.name;
        roles.set(create.slug, role);
        return { id: role.id };
      },
    },
    rolePermission: {
      deleteMany: async ({ where }: { where: { roleId: string } }) => {
        for (const role of roles.values()) if (role.id === where.roleId) role.codes = [];
      },
      createMany: async ({ data }: { data: Array<{ roleId: string; permissionCode: string }> }) => {
        for (const row of data) {
          const role = [...roles.values()].find((r) => r.id === row.roleId)!;
          role.codes.push(row.permissionCode);
        }
      },
    },
  };
  return { prisma: prisma as never, roles };
}

// 主規格 role-management「demo seed 讓 Demo Tenant 與預設權限同步」
test('demo seed 讓 Demo Tenant 的系統角色與預設權限相同', async () => {
  const { prisma, roles } = fakePrisma();
  // Demo Tenant 已有角色：admin 少了 audit.view，supervisor 多了 channel.view_all
  roles.set('admin', { id: 'role-admin', name: 'Admin', codes: DEFAULT_ROLE_PERMISSIONS.admin.filter((c) => c !== 'audit.view') });
  roles.set('supervisor', { id: 'role-supervisor', name: 'Supervisor', codes: [...DEFAULT_ROLE_PERMISSIONS.supervisor, 'channel.view_all'] });

  const slugToId = await seedDemoRoles(prisma, TENANT_ID);

  assert.deepEqual(Object.keys(slugToId).sort(), [...SYSTEM_ROLE_SLUGS].sort());
  for (const slug of SYSTEM_ROLE_SLUGS) {
    const role = roles.get(slug)!;
    assert.deepEqual([...role.codes].sort(), [...DEFAULT_ROLE_PERMISSIONS[slug]].sort(), `${slug} 的權限碼`);
    assert.equal(role.name, SYSTEM_ROLE_NAMES[slug]);
  }
  assert.ok(roles.get('admin')!.codes.includes('audit.view'));
  assert.equal(roles.get('supervisor')!.codes.includes('channel.view_all'), false);
});
