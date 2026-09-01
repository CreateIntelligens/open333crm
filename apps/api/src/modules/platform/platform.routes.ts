import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { ChannelType } from '@prisma/client';
import { buildPlatformRegistry, PERMISSION_CODES } from '@open333crm/core';
import { getConfig } from '../../config/env.js';
import { success } from '../../shared/utils/response.js';
import { platformLogin } from './platform-auth.service.js';
import { writePlatformAudit } from './platform-audit.service.js';
import { listPlans, updatePlan } from './plan.service.js';
import {
  listTenants,
  setTenantActive,
  provisionTenantViaApi,
  getTenantDetail,
  updateTenant,
  updateTenantAgentEmail,
  resendWelcomeEmail,
} from './platform-tenant.service.js';
import { getPlatformSetting, setPlatformSetting } from './platform-setting.service.js';
import {
  getUsageOverview,
  getTenantUsageRanking,
  getTenantUsageDetail,
} from './platform-usage.service.js';
import {
  listTrialTenants,
  extendTrial,
  convertToPaid,
  updateTenantContract,
  restorePurgedTenant,
  resendVerification,
  markSignupFailed,
} from './trial-admin.service.js';
import {
  listPendingRequests,
  approveRequest,
  rejectRequest,
} from './plan-change.service.js';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const channelTypeValues = Object.values(ChannelType) as [string, ...string[]];
const updatePlanSchema = z.object({
  name: z.string().optional(),
  features: z.array(z.string()).optional(),
  // 上限皆為非負整數（人數/渠道數/標籤數/token 數），null 代表無上限；
  // 擋前端誤送的小數、負數或 NaN→null 以外的怪值
  limits: z.record(z.number().int().nonnegative().nullable()).optional(),
  // 渠道 provider 白名單：值須為合法 ChannelType；空陣列 = 不限制
  allowedChannelTypes: z.array(z.enum(channelTypeValues)).optional(),
  // 功能點細分：deny 一組權限碼（須為 registry 內合法碼）。{ deny: [] } = 無 override
  permissionOverrides: z
    .object({
      deny: z.array(z.string().refine((c) => PERMISSION_CODES.has(c), { message: '未知的權限碼' })),
    })
    .optional(),
  priceMonthly: z.number().nullable().optional(),
  isActive: z.boolean().optional(),
});
const provisionSchema = z.object({
  name: z.string().min(1),
  planSlug: z.string().min(1),
  adminEmail: z.string().email(),
  adminName: z.string().min(1),
  adminPassword: z.string().min(8),
});

export default async function platformRoutes(fastify: FastifyInstance) {
  await fastify.register(rateLimit, {
    global: false,
    max: 30,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });

  // ── 平台登入（公開，簽平台 JWT）──
  fastify.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const config = getConfig();
    if (!config.PLATFORM_JWT_SECRET) {
      return reply.status(503).send({
        success: false,
        error: { code: 'PLATFORM_DISABLED', message: 'Platform control plane not configured' },
      });
    }
    const body = loginSchema.parse(request.body);
    const user = await platformLogin(fastify.prismaAdmin, body.email, body.password);
    // @ts-expect-error namespace sign 由 @fastify/jwt 動態掛載
    const token = await reply.platformJwtSign({ platformUserId: user.id, role: 'PLATFORM_SUPERUSER' });
    return reply.send(success({ token, user }));
  });

  // ── 以下皆需平台 superuser ──
  const guard = { preHandler: [fastify.authenticatePlatformSuperuser] };

  // 功能 registry（方案設定頁動態載入用，單一資料源＝core FEATURES + permissions + Prisma ChannelType enum）
  fastify.get('/registry', guard, async () =>
    success({
      features: buildPlatformRegistry(),
      // 動態取 Prisma ChannelType enum 值（非寫死，未來加新渠道類型自動出現）
      channelTypes: Object.values(ChannelType),
    }),
  );

  // Plans
  fastify.get('/plans', guard, async () => success(await listPlans(fastify.prismaAdmin)));
  fastify.patch<{ Params: { id: string } }>('/plans/:id', guard, async (request) => {
    const body = updatePlanSchema.parse(request.body);
    const plan = await updatePlan(fastify.prismaAdmin, request.params.id, body);
    await writePlatformAudit(fastify.prismaAdmin, {
      platformUserId: request.platformUser!.id,
      action: 'plan.update',
      targetType: 'plan',
      targetId: plan.id,
      payload: body,
    });
    return success(plan);
  });

  // Tenants
  fastify.get('/tenants', guard, async () => success(await listTenants(fastify.prismaAdmin)));
  fastify.get<{ Params: { id: string } }>('/tenants/:id', guard, async (request) =>
    success(await getTenantDetail(fastify.prismaAdmin, request.params.id)),
  );
  fastify.patch<{ Params: { id: string } }>('/tenants/:id', guard, async (request) => {
    const body = z
      .object({
        name: z.string().min(1).max(100).optional(),
        planSlug: z.string().min(1).optional(),
      })
      .refine((b) => b.name !== undefined || b.planSlug !== undefined, { message: '至少提供一個欄位' })
      .parse(request.body);
    const tenant = await updateTenant(fastify.prismaAdmin, request.params.id, body);
    await writePlatformAudit(fastify.prismaAdmin, {
      platformUserId: request.platformUser!.id,
      action: 'tenant.update',
      targetType: 'tenant',
      targetId: tenant.id,
      payload: body,
    });
    return success(tenant);
  });
  fastify.patch<{ Params: { id: string; agentId: string } }>(
    '/tenants/:id/agents/:agentId',
    guard,
    async (request) => {
      const { email } = z.object({ email: z.string().email() }).parse(request.body);
      const agent = await updateTenantAgentEmail(
        fastify.prismaAdmin,
        request.params.id,
        request.params.agentId,
        email,
      );
      await writePlatformAudit(fastify.prismaAdmin, {
        platformUserId: request.platformUser!.id,
        action: 'tenant.agent.email.update',
        targetType: 'agent',
        targetId: agent.id,
        payload: { tenantId: request.params.id, email },
      });
      return success(agent);
    },
  );
  fastify.post<{ Params: { id: string; agentId: string } }>(
    '/tenants/:id/agents/:agentId/resend-welcome',
    guard,
    async (request) => {
      const result = await resendWelcomeEmail(fastify.prismaAdmin, request.params.id, request.params.agentId);
      await writePlatformAudit(fastify.prismaAdmin, {
        platformUserId: request.platformUser!.id,
        action: 'tenant.agent.resend_welcome',
        targetType: 'agent',
        targetId: request.params.agentId,
        payload: { tenantId: request.params.id },
      });
      return success(result);
    },
  );
  fastify.patch<{ Params: { id: string } }>('/tenants/:id/active', guard, async (request) => {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(request.body);
    const tenant = await setTenantActive(fastify.prismaAdmin, request.params.id, isActive);
    await writePlatformAudit(fastify.prismaAdmin, {
      platformUserId: request.platformUser!.id,
      action: isActive ? 'tenant.enable' : 'tenant.disable',
      targetType: 'tenant',
      targetId: tenant.id,
    });
    return success(tenant);
  });
  fastify.post('/tenants', guard, async (request) => {
    const body = provisionSchema.parse(request.body);
    const result = await provisionTenantViaApi(fastify.prismaAdmin, body);
    await writePlatformAudit(fastify.prismaAdmin, {
      platformUserId: request.platformUser!.id,
      action: 'tenant.provision',
      targetType: 'tenant',
      targetId: result.tenantId,
      payload: { planSlug: body.planSlug, name: body.name },
    });
    return success(result);
  });

  // Trial signups 列表（排查用）
  fastify.get('/trial-signups', guard, async () => {
    const rows = await fastify.prismaAdmin.trialSignup.findMany({
      select: {
        id: true, email: true, siteName: true, status: true, tenantId: true,
        provisionedAt: true, failureReason: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return success(rows);
  });

  // ── 試用用戶管理 ──
  // 試用租戶列表（含到期倒數與狀態）
  fastify.get('/trial-tenants', guard, async () => success(await listTrialTenants(fastify.prismaAdmin)));

  // 延長試用
  fastify.patch<{ Params: { id: string } }>('/trial-tenants/:id/extend', guard, async (request) => {
    const { days } = z.object({ days: z.number().int().positive() }).parse(request.body);
    const result = await extendTrial(fastify.prismaAdmin, request.params.id, days);
    await writePlatformAudit(fastify.prismaAdmin, {
      platformUserId: request.platformUser!.id,
      action: 'tenant.trial.extend',
      targetType: 'tenant',
      targetId: result.id,
      payload: { days, newEnd: result.trialEndsAt },
    });
    return success(result);
  });

  // 轉正式方案
  fastify.patch<{ Params: { id: string } }>('/trial-tenants/:id/convert', guard, async (request) => {
    const { planSlug } = z.object({ planSlug: z.string().min(1) }).parse(request.body);
    const result = await convertToPaid(fastify.prismaAdmin, request.params.id, planSlug);
    await writePlatformAudit(fastify.prismaAdmin, {
      platformUserId: request.platformUser!.id,
      action: 'tenant.trial.convert',
      targetType: 'tenant',
      targetId: result.id,
      payload: { planSlug },
    });
    return success(result);
  });

  // 設定租戶合約起訖日（純記錄，不觸發任何自動行為）。null=清除、缺=不動、date=設值。
  fastify.patch<{ Params: { id: string } }>('/tenants/:id/contract', guard, async (request) => {
    // 日期先後屬業務規則（非格式），交由 service 檢查並回 422 CONTRACT_DATE_INVALID；
    // service 會合併現有值比對（傳單一日期也擋），比在此 Zod refine 更周全。
    const body = z
      .object({
        contractStartDate: z.coerce.date().nullable().optional(),
        contractEndDate: z.coerce.date().nullable().optional(),
      })
      .parse(request.body);
    const result = await updateTenantContract(fastify.prismaAdmin, request.params.id, body);
    await writePlatformAudit(fastify.prismaAdmin, {
      platformUserId: request.platformUser!.id,
      action: 'tenant.contract.update',
      targetType: 'tenant',
      targetId: result.id,
      payload: { contractStartDate: result.contractStartDate, contractEndDate: result.contractEndDate },
    });
    return success(result);
  });

  // 復原已軟刪（purged）的試用租戶：清 purgedAt（業務資料本就未真刪）
  fastify.patch<{ Params: { id: string } }>('/tenants/:id/restore', guard, async (request) => {
    const result = await restorePurgedTenant(fastify.prismaAdmin, request.params.id);
    await writePlatformAudit(fastify.prismaAdmin, {
      platformUserId: request.platformUser!.id,
      action: 'tenant.trial.restore',
      targetType: 'tenant',
      targetId: result.id,
    });
    return success(result);
  });

  // 申請記錄：重寄驗證信
  fastify.post<{ Params: { id: string } }>('/trial-signups/:id/resend', guard, async (request) => {
    return success(await resendVerification(fastify.prismaAdmin, request.params.id));
  });

  // 申請記錄：標記 failed
  fastify.patch<{ Params: { id: string } }>('/trial-signups/:id/fail', guard, async (request) => {
    const { reason } = z.object({ reason: z.string().optional() }).parse(request.body ?? {});
    const result = await markSignupFailed(fastify.prismaAdmin, request.params.id, reason ?? '');
    await writePlatformAudit(fastify.prismaAdmin, {
      platformUserId: request.platformUser!.id,
      action: 'trial.signup.fail',
      targetType: 'trial_signup',
      targetId: result.id,
    });
    return success(result);
  });

  // ── 用量統計 ──
  const rangeSchema = z.object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  });

  // 跨租戶總覽
  fastify.get('/usage/overview', guard, async (request) => {
    const q = rangeSchema.parse(request.query);
    return success(await getUsageOverview(fastify.prismaAdmin, q));
  });
  // 各租戶排行
  fastify.get('/usage/tenants', guard, async (request) => {
    const q = rangeSchema.parse(request.query);
    return success(await getTenantUsageRanking(fastify.prismaAdmin, q));
  });
  // 單租戶鑽取
  fastify.get<{ Params: { tenantId: string } }>('/usage/tenants/:tenantId', guard, async (request) => {
    const q = rangeSchema.parse(request.query);
    return success(await getTenantUsageDetail(fastify.prismaAdmin, request.params.tenantId, q));
  });

  // ── 方案升級/加購申請審核 ──
  fastify.get('/plan-change-requests', guard, async () => {
    return success(await listPendingRequests(fastify.prismaAdmin));
  });
  fastify.patch<{ Params: { id: string } }>('/plan-change-requests/:id/approve', guard, async (request) => {
    const { note } = z.object({ note: z.string().optional() }).parse(request.body ?? {});
    const result = await approveRequest(fastify.prismaAdmin, request.params.id, request.platformUser!.id, note);
    await writePlatformAudit(fastify.prismaAdmin, {
      platformUserId: request.platformUser!.id,
      action: 'plan_change.approve',
      targetType: 'plan_change_request',
      targetId: result.id,
      payload: { type: result.type },
    });
    return success(result);
  });
  fastify.patch<{ Params: { id: string } }>('/plan-change-requests/:id/reject', guard, async (request) => {
    const { note } = z.object({ note: z.string().optional() }).parse(request.body ?? {});
    const result = await rejectRequest(fastify.prismaAdmin, request.params.id, request.platformUser!.id, note);
    await writePlatformAudit(fastify.prismaAdmin, {
      platformUserId: request.platformUser!.id,
      action: 'plan_change.reject',
      targetType: 'plan_change_request',
      targetId: result.id,
    });
    return success(result);
  });

  // Platform settings (KV)
  fastify.get<{ Params: { key: string } }>('/settings/:key', guard, async (request) => {
    return success(await getPlatformSetting(fastify.prismaAdmin, request.params.key));
  });
  fastify.put<{ Params: { key: string } }>('/settings/:key', guard, async (request) => {
    const { value } = z.object({ value: z.unknown() }).parse(request.body);
    await setPlatformSetting(fastify.prismaAdmin, request.params.key, value);
    await writePlatformAudit(fastify.prismaAdmin, {
      platformUserId: request.platformUser!.id,
      action: 'setting.update',
      targetType: 'setting',
      targetId: request.params.key,
    });
    return success({ key: request.params.key, value });
  });
}
