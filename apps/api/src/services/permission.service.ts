/**
 * Permission Service — 有效權限解析與快取
 *
 * 對應 rbac-granular-permissions specs/permission-check：
 * - 有效權限集合 = RolePermission(roleId) ∪ implies 遞迴閉包
 * - 快取 perms:role:{roleId}（TTL ≤ 10min），RolePermission 變更時主動失效
 */

import type { PrismaClient } from '@prisma/client';
import { redis, resolveImplied } from '@open333crm/core';

const CACHE_PREFIX = 'perms:role:';
const CACHE_TTL_SEC = 600; // 10 分鐘

function cacheKey(roleId: string): string {
  return `${CACHE_PREFIX}${roleId}`;
}

/**
 * 解析某角色的有效權限集合（含 implies 閉包），優先讀 Redis 快取。
 * roleId 為 null（過渡期未回填）時回空集合。
 */
export async function getEffectivePermissions(
  prisma: PrismaClient,
  roleId: string | null | undefined,
): Promise<Set<string>> {
  if (!roleId) return new Set();

  // 讀快取
  try {
    const cached = await redis.get(cacheKey(roleId));
    if (cached) return new Set(JSON.parse(cached) as string[]);
  } catch {
    /* 快取失敗不阻斷，回退查 DB */
  }

  // 查 DB：明確授予的權限碼
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permissionCode: true },
  });
  const granted = rows.map((r) => r.permissionCode);

  // 加上 implies 遞迴閉包
  const effective = resolveImplied(granted);

  // 回填快取
  try {
    await redis.set(cacheKey(roleId), JSON.stringify([...effective]), 'EX', CACHE_TTL_SEC);
  } catch {
    /* 快取寫入失敗不阻斷 */
  }

  return effective;
}

/** 某角色是否擁有某權限（含 implies）。 */
export async function roleHasPermission(
  prisma: PrismaClient,
  roleId: string | null | undefined,
  code: string,
): Promise<boolean> {
  const eff = await getEffectivePermissions(prisma, roleId);
  return eff.has(code);
}

/** 失效某角色的權限快取（RolePermission 變更後呼叫）。 */
export async function invalidateRolePermissions(roleId: string): Promise<void> {
  try {
    await redis.del(cacheKey(roleId));
  } catch {
    /* 失效失敗靠 TTL 兜底 */
  }
}
