import type { PrismaClient } from '@open333crm/database';
import type { TenantDb } from '../../lib/tenant-db.js';
import { createHash, randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from '../../shared/utils/password.js';
import { AppError } from '../../shared/utils/response.js';
import { notFound } from '../../shared/messages/resource.js';
import { logger } from '@open333crm/core';
import { clearLoginAttempts, registerLoginAttempt, type LoginAttemptStore } from './login-attempts.js';

/**
 * 帳號不存在時也驗一次密碼（對這組雜湊），讓回應時間與存在的帳號相同，不能靠快慢判斷 email 是否存在。
 * 用正式的 hashPassword 產生（成本參數一致），明文是隨機值，不會有人猜中；第一次用到才算、之後重用。
 */
function hashEmailForLog(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 12);
}

let dummyPasswordHash: Promise<string> | undefined;
function getDummyPasswordHash(): Promise<string> {
  // 產生失敗時清掉快取，下次重算；否則 rejected 的 Promise 會一直留著，之後不存在帳號的登入全部 500
  dummyPasswordHash ??= hashPassword(randomUUID()).catch((err: unknown) => {
    dummyPasswordHash = undefined;
    throw err;
  });
  return dummyPasswordHash;
}

export async function login(prisma: PrismaClient, email: string, password: string, attempts: LoginAttemptStore) {
  // 失敗達上限的帳號在區間內一律擋下，不驗密碼（否則鎖定期間仍可繼續猜）。
  // 計數儲存（Redis）出錯時照常放行並留 log：不能因為 Redis 故障讓全站無法登入，IP 限流仍在。
  const attempt = await registerLoginAttempt(attempts, email).catch((err: unknown) => {
    logger.error('[Auth] 登入失敗計數無法使用，略過帳號鎖定', { error: err instanceof Error ? err.message : String(err) });
    return { locked: false as const };
  });
  if (attempt.locked) {
    // 供監控：同一帳號持續被鎖、或短時間多個帳號被鎖，可能是有人故意鎖人或在撞庫（不記明文 email）
    logger.warn('[Auth] 登入因失敗次數過多被擋', { emailHash: hashEmailForLog(email) });
    const minutes = Math.max(1, Math.ceil(attempt.retryAfterMs / 60_000));
    throw new AppError(`登入失敗次數過多，請 ${minutes} 分鐘後再試`, 'ACCOUNT_LOCKED', 429);
  }

  // email 全域唯一：直接用 email 查出 agent，agent.tenantId 即為登入者所屬租戶
  // （後續 JWT 帶 tenantId、每個 request 從 token 解租戶，整條鏈路自動多租戶正確）
  const agent = await prisma.agent.findUnique({
    where: { email },
    select: {
      id: true,
      tenantId: true,
      email: true,
      name: true,
      role: true,
      roleId: true,
      avatarUrl: true,
      passwordHash: true,
      isActive: true,
      // 一併載入所屬租戶的啟用狀態，停用租戶不得登入
      tenant: {
        select: { isActive: true },
      },
    },
  });

  if (!agent) {
    await verifyPassword(password, await getDummyPasswordHash());
    throw new AppError('電子郵件或密碼不正確', 'INVALID_CREDENTIALS', 401);
  }

  const valid = await verifyPassword(password, agent.passwordHash);
  if (!valid) {
    throw new AppError('電子郵件或密碼不正確', 'INVALID_CREDENTIALS', 401);
  }

  // 放在密碼驗證之後：不知道密碼的人不能藉 403 與 401 的差異確認某個 email 是停用帳號
  if (!agent.isActive) {
    throw new AppError('此帳號已被停用，請聯繫管理員', 'ACCOUNT_DISABLED', 403);
  }

  // 租戶被停用（例如欠費停權）時，即使帳號本身有效也擋下登入。
  // 用 optional chaining 防孤兒列（tenant 被繞過 Prisma 刪除時 agent.tenant 可能為 null），
  // 並把「租戶缺失」一併視為停用擋下。
  // 放在密碼驗證之後：避免未通過驗證者藉由 403(TENANT_DISABLED) 與 401 的差異
  // 枚舉出某 email 是否屬於被停用的租戶。
  if (!agent.tenant?.isActive) {
    throw new AppError('此租戶已停用，請聯繫管理員', 'TENANT_DISABLED', 403);
  }

  await clearLoginAttempts(attempts, email).catch((err: unknown) => {
    logger.error('[Auth] 清除登入失敗計數失敗', { error: err instanceof Error ? err.message : String(err) });
  });

  // 移除 passwordHash 與 join 進來的 tenant 物件，只回傳 agent 本身欄位
  const { passwordHash: _, tenant: __, ...agentData } = agent;
  return agentData;
}

export async function getAgentById(prisma: TenantDb, agentId: string, tenantId: string) {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, tenantId },
    select: {
      id: true,
      tenantId: true,
      email: true,
      name: true,
      role: true,
      avatarUrl: true,
      isActive: true,
      createdAt: true,
      teams: {
        include: {
          team: true,
        },
      },
    },
  });

  if (!agent) {
    throw new AppError(notFound('agent'), 'NOT_FOUND', 404);
  }

  return agent;
}

/**
 * Load an agent for an authentication flow while enforcing both account and
 * tenant activation. The tenantId must come from the authenticated request or
 * the passkey credential challenge, never from a client-controlled profile.
 */
export async function getActiveAgentForAuth(
  prisma: PrismaClient,
  agentId: string,
  tenantId: string,
) {
  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      tenantId,
      isActive: true,
      tenant: { isActive: true },
    },
    select: {
      id: true,
      tenantId: true,
      email: true,
      name: true,
      role: true,
      roleId: true, // RBAC：JWT 需帶 roleId 做細粒度權限判斷
      avatarUrl: true,
    },
  });

  if (!agent) {
    throw new AppError('此帳號已停用或無法使用，請聯繫管理員', 'UNAUTHORIZED', 401);
  }

  return agent;
}
