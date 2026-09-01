/**
 * 平台側租戶管理：列表、停用/啟用、開通。
 * provisionTenant 是開通核心（Tenant → system roles → admin agent），
 * 收 transaction client 供 trial 自動開通與平台手動開通共用。
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { seedRolesForTenant } from '@open333crm/core';
import { getConfig } from '../../config/env.js';
import { hashPassword } from '../../shared/utils/password.js';
import { AppError } from '../../shared/utils/response.js';
import { sendManualProvisionedEmail } from '../trial/trial-emails.js';
import { invalidatePlanPermissions } from '../../services/permission.service.js';
import { invalidateTenantPlan } from '../../services/tenant-plan.cache.js';

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

/** 平台租戶詳細：基本資料 + 成員清單 + 各類資料量統計。 */
export async function getTenantDetail(prisma: PrismaClient, id: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      isActive: true,
      createdAt: true,
      trialEndsAt: true,
      purgedAt: true,
      contractStartDate: true,
      contractEndDate: true,
      plan: { select: { id: true, slug: true, name: true } },
      agents: {
        select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
      _count: { select: { agents: true, channels: true, contacts: true, conversations: true, cases: true } },
    },
  });
  if (!tenant) throw new AppError('Tenant not found', 'NOT_FOUND', 404);
  return tenant;
}

/** 平台編輯租戶基本資料：名稱、方案。方案變更需失效權限天花板/租戶方案快取（比照 convertToPaid）。 */
export async function updateTenant(
  prisma: PrismaClient,
  id: string,
  input: { name?: string; planSlug?: string },
) {
  const existing = await prisma.tenant.findUnique({ where: { id }, select: { id: true, planId: true } });
  if (!existing) throw new AppError('Tenant not found', 'NOT_FOUND', 404);

  const data: Prisma.TenantUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;

  let planChangedTo: string | null = null;
  if (input.planSlug !== undefined) {
    const plan = await prisma.plan.findUnique({ where: { slug: input.planSlug }, select: { id: true } });
    if (!plan) throw new AppError('Plan not found', 'NOT_FOUND', 404);
    if (plan.id !== existing.planId) {
      data.plan = { connect: { id: plan.id } };
      planChangedTo = plan.id;
    }
  }

  const updated = await prisma.tenant.update({
    where: { id },
    data,
    select: { id: true, name: true, isActive: true, plan: { select: { slug: true, name: true } } },
  });

  if (planChangedTo) {
    await invalidatePlanPermissions(prisma, planChangedTo);
    invalidateTenantPlan(id);
  }
  return updated;
}

/** 平台修改租戶成員 email（即登入帳號）。email 全域唯一，衝突回 409。 */
export async function updateTenantAgentEmail(
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
  email: string,
) {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, tenantId },
    select: { id: true, email: true },
  });
  if (!agent) throw new AppError('Agent not found', 'NOT_FOUND', 404);
  if (agent.email === email) return { id: agent.id, email: agent.email };

  const dup = await prisma.agent.findUnique({ where: { email }, select: { id: true } });
  if (dup) throw new AppError('Email already in use', 'CONFLICT', 409);

  return prisma.agent.update({ where: { id: agentId }, data: { email }, select: { id: true, email: true } });
}

/** 重寄開通信給指定成員（帶登入網址、不含密碼；寄送失敗只 log 不拋錯）。 */
export async function resendWelcomeEmail(prisma: PrismaClient, tenantId: string, agentId: string) {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, tenantId },
    select: { email: true },
  });
  if (!agent) throw new AppError('Agent not found', 'NOT_FOUND', 404);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  if (!tenant) throw new AppError('Tenant not found', 'NOT_FOUND', 404);

  const loginUrl = `${getConfig().WEB_BASE_URL}/login`;
  await sendManualProvisionedEmail(agent.email, {
    siteName: tenant.name,
    loginUrl,
    adminEmail: agent.email,
  });
  return { ok: true, email: agent.email };
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

/** 平台手動開通 API 用：先查 plan slug、檢查 email 唯一，再於 transaction 內開通，成功後寄開通信。 */
export async function provisionTenantViaApi(
  prisma: PrismaClient,
  input: { name: string; planSlug: string; adminEmail: string; adminName: string; adminPassword: string },
): Promise<{ tenantId: string; adminAgentId: string; loginUrl: string }> {
  const plan = await prisma.plan.findUnique({ where: { slug: input.planSlug }, select: { id: true } });
  if (!plan) throw new AppError('Plan not found', 'NOT_FOUND', 404);

  // email 全域唯一：先擋，避免 transaction 內 P2002
  const existing = await prisma.agent.findUnique({ where: { email: input.adminEmail }, select: { id: true } });
  if (existing) throw new AppError('Email already in use', 'CONFLICT', 409);

  const passwordHash = await hashPassword(input.adminPassword);
  const result = await prisma.$transaction((tx) =>
    provisionTenant(tx, {
      name: input.name,
      planId: plan.id,
      admin: { email: input.adminEmail, name: input.adminName, passwordHash },
    }),
  );

  // 開通信不帶密碼（平台方設定，線下轉交）；fire-and-forget，寄信失敗不影響開通結果
  const loginUrl = `${getConfig().WEB_BASE_URL}/login`;
  void sendManualProvisionedEmail(input.adminEmail, {
    siteName: input.name,
    loginUrl,
    adminEmail: input.adminEmail,
  });

  return { ...result, loginUrl };
}
