import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import { hashPassword, verifyPassword } from '../../shared/utils/password.js';
import type { AgentRoleValue, CreateAgentInput } from './agent.schema.js';

// legacy enum role → system role slug（與 granular RBAC 雙寫的橋樑）
const ENUM_TO_SLUG: Record<string, string> = {
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  AGENT: 'agent',
};

/** 依 enum role 查該租戶對應 system role 的 roleId（雙寫用；查無回 null）。 */
async function resolveRoleId(
  prisma: PrismaClient,
  tenantId: string,
  role: string,
): Promise<string | null> {
  const slug = ENUM_TO_SLUG[role];
  if (!slug) return null;
  const r = await prisma.role.findFirst({
    where: { tenantId, slug, isSystem: true },
    select: { id: true },
  });
  return r?.id ?? null;
}

const agentSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  avatarUrl: true,
  isActive: true,
  tenantId: true,
  createdAt: true,
} as const;

export async function createAgent(
  prisma: PrismaClient,
  tenantId: string,
  data: CreateAgentInput,
) {
  // email 全域唯一：跨租戶檢查是否已被使用（不限本租戶），
  // 否則跨租戶撞 email 會在 create 時冒 P2002 → 500，而非乾淨的 409
  const existing = await prisma.agent.findUnique({
    where: { email: data.email },
  });

  if (existing) {
    throw new AppError('Email already in use', 'CONFLICT', 409);
  }

  const passwordHash = await hashPassword(data.password);
  // 雙寫：legacy role enum + granular roleId（指向該租戶對應 system role）
  const roleId = await resolveRoleId(prisma, tenantId, data.role);

  const agent = await prisma.agent.create({
    data: {
      tenantId,
      name: data.name,
      email: data.email,
      role: data.role,
      roleId,
      passwordHash,
    },
    select: agentSelect,
  });

  return agent;
}

export async function updateAgentRole(
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
  role: AgentRoleValue,
) {
  const existing = await prisma.agent.findFirst({
    where: { id: agentId, tenantId },
  });

  if (!existing) {
    throw new AppError('Agent not found', 'NOT_FOUND', 404);
  }

  // 雙寫：改 legacy role 同時更新 granular roleId
  const roleId = await resolveRoleId(prisma, tenantId, role);

  const agent = await prisma.agent.update({
    where: { id: agentId },
    data: { role, roleId },
    select: agentSelect,
  });

  return agent;
}

export async function changeOwnPassword(
  prisma: PrismaClient,
  agentId: string,
  currentPassword: string,
  newPassword: string,
) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { passwordHash: true },
  });

  if (!agent) {
    throw new AppError('Agent not found', 'NOT_FOUND', 404);
  }

  const valid = await verifyPassword(currentPassword, agent.passwordHash);
  if (!valid) {
    throw new AppError('Current password is incorrect', 'INVALID_PASSWORD', 400);
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.agent.update({
    where: { id: agentId },
    data: { passwordHash },
  });
}

export async function resetAgentPassword(
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
  newPassword: string,
) {
  const existing = await prisma.agent.findFirst({
    where: { id: agentId, tenantId },
  });

  if (!existing) {
    throw new AppError('Agent not found', 'NOT_FOUND', 404);
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.agent.update({
    where: { id: agentId },
    data: { passwordHash },
  });
}

export async function deactivateAgent(
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
) {
  const existing = await prisma.agent.findFirst({
    where: { id: agentId, tenantId },
  });

  if (!existing) {
    throw new AppError('Agent not found', 'NOT_FOUND', 404);
  }

  await prisma.agent.update({
    where: { id: agentId },
    data: { isActive: false },
  });
}
