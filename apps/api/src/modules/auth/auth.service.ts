import type { PrismaClient } from '@prisma/client';
import { DEFAULT_TENANT_ID } from '@open333crm/shared';
import { verifyPassword } from '../../shared/utils/password.js';
import { AppError } from '../../shared/utils/response.js';

export async function login(prisma: PrismaClient, email: string, password: string) {
  const agent = await prisma.agent.findUnique({
    where: {
      tenantId_email: {
        tenantId: DEFAULT_TENANT_ID,
        email,
      },
    },
    select: {
      id: true,
      tenantId: true,
      email: true,
      name: true,
      role: true,
      avatarUrl: true,
      passwordHash: true,
      isActive: true,
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

  const { passwordHash: _, ...agentData } = agent;
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
