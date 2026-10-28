import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod/v3';
import { AppError, success } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { getConfig } from '../../config/env.js';
import { writeTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import {
  buildWebTalkSession,
  getWebTalkSettings,
  resolveWebTalkServerConfig,
  rotateWebTalkRoom,
  updateWebTalkSettings,
  type WebTalkServerConfig,
} from './webtalk.service.js';

export interface WebTalkRoutesOptions {
  /** 測試用：取代從環境變數讀取的伺服器設定 */
  resolveConfig?: () => WebTalkServerConfig | null;
}

const updateSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    aiEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((data) => data.enabled !== undefined || data.aiEnabled !== undefined, {
    message: '請至少提供一個要更新的設定',
  });

const AI_DISABLED_MESSAGE = '此租戶已停用 WebTalk AI 摘要，如需使用請聯繫管理員。';

/** WebTalk 只提供給登入的真人成員；Partner API key 與 CLI session 不能取得房間代號。 */
function assertHumanAgent(request: FastifyRequest): void {
  if (request.agent?.isPartnerKey || request.agent?.isCliSession) {
    throw new AppError('WebTalk 只提供給登入後台的成員使用', 'FORBIDDEN', 403);
  }
}

/**
 * WebTalk 協作工具列（change webtalk-multi-tenant）。
 * 前綴：/api/v1/webtalk
 */
export default async function webtalkRoutes(fastify: FastifyInstance, opts: WebTalkRoutesOptions) {
  const resolveConfig = opts.resolveConfig ?? (() => resolveWebTalkServerConfig(getConfig()));
  const manage = requirePermission('settings.manage');

  // POST /api/v1/webtalk/ai-disabled
  // 租戶未開啟 AI 摘要時，前端把 SDK 的 aiEndpoint 指到這裡（SDK 的 AI 按鈕無法隱藏）。
  // SDK 送出的 body 含整頁文字（可能有顧客個資），所以在 onRequest 階段、解析 body 之前就回應，不讀也不記錄內容。
  // SDK 呼叫時不帶 Authorization，此端點不需登入，也不做任何事。
  fastify.post('/ai-disabled', {
    onRequest: async (_request, reply) => {
      return reply.status(403).send({
        success: false,
        error: { code: 'WEBTALK_AI_DISABLED', message: AI_DISABLED_MESSAGE },
      });
    },
  }, async () => {
    // onRequest 已回應，不會執行到這裡
    throw new AppError(AI_DISABLED_MESSAGE, 'WEBTALK_AI_DISABLED', 403);
  });

  // GET /api/v1/webtalk/session — 前端掛載 WebTalk 前取得房間代號與 SDK 設定。
  // 租戶一律取自登入身分；伺服器未設定或租戶停用時回 enabled: false（fail-closed）。
  fastify.get('/session', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    assertHumanAgent(request);
    const session = await buildWebTalkSession(request.tenantPrisma, request.agent.tenantId, resolveConfig());
    return reply.send(success(session));
  });

  // GET /api/v1/webtalk/settings
  fastify.get('/settings', { preHandler: [fastify.authenticate, manage] }, async (request, reply) => {
    const { enabled, aiEnabled } = await getWebTalkSettings(request.tenantPrisma, request.agent.tenantId);
    return reply.send(success({ enabled, aiEnabled }));
  });

  // PUT /api/v1/webtalk/settings
  fastify.put('/settings', { preHandler: [fastify.authenticate, manage] }, async (request, reply) => {
    const data = updateSettingsSchema.parse(request.body);
    const tenantId = request.agent.tenantId;
    const result = await updateWebTalkSettings(request.tenantPrisma, tenantId, data);
    await writeTenantAudit(request.tenantPrisma, {
      tenantId,
      actorId: request.agent.id,
      action: 'settings.update',
      targetType: 'settings',
      payload: { section: 'webtalk', enabled: result.enabled, aiEnabled: result.aiEnabled },
      ip: request.ip,
    });
    return reply.send(success(result));
  });

  // POST /api/v1/webtalk/settings/rotate-room — 重新產生房間代號（例如成員離職後）
  fastify.post('/settings/rotate-room', { preHandler: [fastify.authenticate, manage] }, async (request, reply) => {
    const tenantId = request.agent.tenantId;
    await rotateWebTalkRoom(request.tenantPrisma, tenantId);
    await writeTenantAudit(request.tenantPrisma, {
      tenantId,
      actorId: request.agent.id,
      action: 'settings.update',
      targetType: 'settings',
      payload: { section: 'webtalk', rotateRoom: true },
      ip: request.ip,
    });
    return reply.send(success({ rotated: true }));
  });
}
