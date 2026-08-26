/**
 * 平台側租戶管理：列表、停用/啟用、開通。
 * provisionTenant 是開通核心（Tenant → system roles → admin agent），
 * 收 transaction client 供 trial 自動開通與平台手動開通共用。
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { seedRolesForTenant } from '@open333crm/core';
import { hashPassword } from '../../shared/utils/password.js';
import { AppError } from '../../shared/utils/response.js';

export async function listTenants(prisma: PrismaClient) {
  return prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      isActive: true,
      createdAt: true,
      contractStartDate: true,
      contractEndDate: true,
      plan: { select: { slug: true, name: true } },
      _count: { select: { agents: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function setTenantActive(prisma: PrismaClient, id: string, isActive: boolean) {
  const existing = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AppError('Tenant not found', 'NOT_FOUND', 404);
  return prisma.tenant.update({ where: { id }, data: { isActive }, select: { id: true, name: true, isActive: true } });
}

/**
 * 開通一個租戶。在呼叫端提供的 transaction 內執行（trial 需與 token 消耗同 transaction）。
 * 密碼由呼叫端決定傳明文（adminPassword，內部 hash）或已 hash（adminPasswordHash）。
 */
export async function provisionTenant(
  tx: Prisma.TransactionClient,
  input: {
    name: string;
    planId: string;
    admin: { email: string; name: string; passwordHash: string };
    trialEndsAt?: Date;
  },
): Promise<{ tenantId: string; adminAgentId: string }> {
  const tenant = await tx.tenant.create({
    data: {
      name: input.name,
      planId: input.planId,
      ...(input.trialEndsAt ? { trialEndsAt: input.trialEndsAt } : {}),
    },
    select: { id: true },
  });

  // 三個 system role + 預設權限（seedRolesForTenant 收 TransactionClient）
  const slugToRoleId = await seedRolesForTenant(tx, tenant.id);

  const agent = await tx.agent.create({
    data: {
      tenantId: tenant.id,
      name: input.admin.name,
      email: input.admin.email,
      role: 'ADMIN',
      roleId: slugToRoleId.admin,
      passwordHash: input.admin.passwordHash,
    },
    select: { id: true },
  });

  return { tenantId: tenant.id, adminAgentId: agent.id };
}

/** 平台手動開通 API 用：先查 plan slug、檢查 email 唯一，再於 transaction 內開通。 */
export async function provisionTenantViaApi(
  prisma: PrismaClient,
  input: { name: string; planSlug: string; adminEmail: string; adminName: string; adminPassword: string },
): Promise<{ tenantId: string; adminAgentId: string }> {
  const plan = await prisma.plan.findUnique({ where: { slug: input.planSlug }, select: { id: true } });
  if (!plan) throw new AppError('Plan not found', 'NOT_FOUND', 404);

  // email 全域唯一：先擋，避免 transaction 內 P2002
  const existing = await prisma.agent.findUnique({ where: { email: input.adminEmail }, select: { id: true } });
  if (existing) throw new AppError('Email already in use', 'CONFLICT', 409);

  const passwordHash = await hashPassword(input.adminPassword);
  return prisma.$transaction((tx) =>
    provisionTenant(tx, {
      name: input.name,
      planId: plan.id,
      admin: { email: input.adminEmail, name: input.adminName, passwordHash },
    }),
  );
}
