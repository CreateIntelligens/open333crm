import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import { hashPassword, verifyPassword } from '../../shared/utils/password.js';
import type { AgentRoleValue, CreateAgentInput } from './agent.schema.js';

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
  const existing = await prisma.agent.findFirst({
    where: { tenantId, email: data.email },
  });

  if (existing) {
    throw new AppError('Email already in use', 'CONFLICT', 409);
  }

  const passwordHash = await hashPassword(data.password);

  const agent = await prisma.agent.create({
    data: {
      tenantId,
      name: data.name,
      email: data.email,
      role: data.role,
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

  const agent = await prisma.agent.update({
    where: { id: agentId },
    data: { role },
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
