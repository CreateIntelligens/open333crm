/**
 * Permission Service — 有效權限解析與快取
 *
 * 對應 rbac-granular-permissions specs/permission-check：
 * - 有效權限集合 = RolePermission(roleId) ∪ implies 遞迴閉包
 * - 快取 perms:role:{roleId}（TTL ≤ 10min），RolePermission 變更時主動失效
 *
 * 讀寫快取的函式以參數接收 Redis，由入口傳入 `fastify.redis`。租戶交易內的越權檢查改用
 * loadRolePermissions()，只查資料庫：交易內不使用 Redis（AGENTS.md 結構規則 2、#337 10.4）。
 */

import type { Redis } from 'ioredis';
import type { TenantDb } from '../lib/tenant-db.js';
import { resolveImplied, permsForFeatures, CORE_FEATURE } from '@open333crm/core';

const CACHE_PREFIX = 'perms:role:';
const TENANT_CACHE_PREFIX = 'perms:tenant:';
const CACHE_TTL_SEC = 600; // 10 分鐘

function cacheKey(roleId: string): string {
  return `${CACHE_PREFIX}${roleId}`;
}

// 交集結果與 (roleId, planId) 相關 → 快取 key 帶兩者
function tenantCacheKey(roleId: string, planId: string | null): string {
  return `${TENANT_CACHE_PREFIX}${roleId}:${planId ?? 'none'}`;
}

/**
 * 某角色的有效權限集合（含 implies 閉包），只查資料庫、不讀快取。
 * 租戶交易內的越權檢查用這個；roleId 為 null（過渡期未回填）時回空集合。
 */
export async function loadRolePermissions(
  prisma: TenantDb,
  roleId: string | null | undefined,
): Promise<Set<string>> {
  if (!roleId) return new Set();
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permissionCode: true },
  });
  return resolveImplied(rows.map((r) => r.permissionCode));
}

/**
 * 解析某角色的有效權限集合（含 implies 閉包），優先讀 Redis 快取。
 * 不要在租戶交易內呼叫，交易內改用 loadRolePermissions()。
 */
async function getEffectivePermissions(
  prisma: TenantDb,
  redis: Redis,
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

  const effective = await loadRolePermissions(prisma, roleId);

  // 回填快取
  try {
    await redis.set(cacheKey(roleId), JSON.stringify([...effective]), 'EX', CACHE_TTL_SEC);
  } catch {
    /* 快取寫入失敗不阻斷 */
  }

  return effective;
}

/** 失效某角色的權限快取（RolePermission 變更後呼叫）。 */
export async function invalidateRolePermissions(redis: Redis, roleId: string): Promise<void> {
  try {
    await redis.del(cacheKey(roleId));
    // 角色權限變更也影響其套天花板後的結果 → 一併清該角色的 tenant 交集快取
    await delByPattern(redis, `${TENANT_CACHE_PREFIX}${roleId}:*`);
  } catch {
    /* 失效失敗靠 TTL 兜底 */
  }
}

/**
 * 有效「租戶內」權限 = 角色權限 ∩ 方案功能天花板。
 * 供 guard（requirePermission）與 /me/permissions 使用——這是使用者實際可用的權限。
 * planId 為 null（租戶無方案）時不套天花板，回角色權限本身（既有租戶零影響）。
 *
 * 注意：與 getEffectivePermissions（角色原始權限，越權檢查用）語意不同，勿混用。
 */
export async function getEffectiveTenantPermissions(
  prisma: TenantDb,
  redis: Redis,
  roleId: string | null | undefined,
  planId: string | null | undefined,
): Promise<Set<string>> {
  if (!roleId) return new Set();

  // 無方案 → 不設天花板，直接回角色權限
  if (!planId) return getEffectivePermissions(prisma, redis, roleId);

  const key = tenantCacheKey(roleId, planId);
  try {
    const cached = await redis.get(key);
    if (cached) return new Set(JSON.parse(cached) as string[]);
  } catch {
    /* 快取失敗回退計算 */
  }

  const roleEff = await getEffectivePermissions(prisma, redis, roleId);
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    select: { features: true, permissionOverrides: true },
  });
  const features = new Set<string>((plan?.features as string[]) ?? []);
  features.add(CORE_FEATURE); // core 恆開
  const ceiling = permsForFeatures(features);

  // 功能點細分：從天花板再扣掉方案 deny 的權限碼（deny 高階不連坐低階）
  const overrides = (plan?.permissionOverrides ?? {}) as { deny?: string[] };
  for (const code of overrides.deny ?? []) ceiling.delete(code);

  const effective = new Set<string>();
  for (const code of roleEff) if (ceiling.has(code)) effective.add(code);

  try {
    await redis.set(key, JSON.stringify([...effective]), 'EX', CACHE_TTL_SEC);
  } catch {
    /* 寫入失敗不阻斷 */
  }
  return effective;
}

/** 失效某方案所有租戶的天花板交集快取（改 plan.features 後呼叫）。 */
export async function invalidatePlanPermissions(redis: Redis, planId: string): Promise<void> {
  try {
    await delByPattern(redis, `${TENANT_CACHE_PREFIX}*:${planId}`);
  } catch {
    /* 失效失敗靠 TTL 兜底 */
  }
}

/** 以 SCAN 逐批刪除符合 pattern 的 key（避免 KEYS 阻塞）。 */
async function delByPattern(redis: Redis, pattern: string): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    if (keys.length) await redis.del(...keys);
  } while (cursor !== '0');
}
