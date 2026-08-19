import type { PrismaClient } from '@prisma/client';
import { verifyPassword } from '../../shared/utils/password.js';
import { AppError } from '../../shared/utils/response.js';

export async function login(prisma: PrismaClient, email: string, password: string) {
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
    throw new AppError('Invalid email or password', 'INVALID_CREDENTIALS', 401);
  }

  if (!agent.isActive) {
    throw new AppError('Account is disabled', 'ACCOUNT_DISABLED', 403);
  }

  const valid = await verifyPassword(password, agent.passwordHash);
  if (!valid) {
    throw new AppError('Invalid email or password', 'INVALID_CREDENTIALS', 401);
  }

  // 租戶被停用（例如欠費停權）時，即使帳號本身有效也擋下登入。
  // 用 optional chaining 防孤兒列（tenant 被繞過 Prisma 刪除時 agent.tenant 可能為 null），
  // 並把「租戶缺失」一併視為停用擋下。
  // 放在密碼驗證之後：避免未通過驗證者藉由 403(TENANT_DISABLED) 與 401 的差異
  // 枚舉出某 email 是否屬於被停用的租戶。
  if (!agent.tenant?.isActive) {
    throw new AppError('Tenant is disabled', 'TENANT_DISABLED', 403);
  }

  // 移除 passwordHash 與 join 進來的 tenant 物件，只回傳 agent 本身欄位
  const { passwordHash: _, tenant: __, ...agentData } = agent;
  return agentData;
}

export async function getAgentById(prisma: PrismaClient, agentId: string, tenantId: string) {
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
    throw new AppError('Agent not found', 'NOT_FOUND', 404);
  }

  return agent;
}
