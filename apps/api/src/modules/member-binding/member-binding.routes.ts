/**
 * 會員綁定後台 API：/api/v1/member-binding（需 settings.manage）。
 * 顧客端綁定在 member-binding-fan.routes.ts。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../../guards/rbac.guard.js';
import { tenantHandler } from '../../lib/tenant-ctx.js';
import {
  getBindingConfig,
  saveBindingConfig,
  unbindMember,
} from './member-binding.service.js';
import { bindMember } from './member-binding.flow.js';
import { testConnection } from './member-lookup.service.js';
import { FAILURE_MESSAGES, FAILURE_STATUS, lookupInputSchema, contactParams, runInTenant } from './member-binding-http.js';
import type { MemberBindingConfig } from './member-binding.types.js';

/** 設定含認證憑證，回傳給前端時遮蔽——避免後台頁面外洩客戶的 API 金鑰。 */
function maskConfig(config: MemberBindingConfig | null) {
  if (!config) return null;
  return {
    ...config,
    auth: config.auth
      ? { ...config.auth, credential: config.auth.credential ? '••••••••' : undefined }
      : { type: 'none' as const },
  };
}

/** 設定的結構（member-binding.types.ts MemberBindingConfig）；網址的 SSRF 檢查在 saveBindingConfig */
const configSchema = z.object({
  enabled: z.boolean(),
  endpoint: z.string().max(2000),
  method: z.enum(['GET', 'POST'], { errorMap: () => ({ message: '查詢方式須為 GET 或 POST' }) }),
  auth: z.object({
    type: z.enum(['none', 'bearer', 'api_key', 'basic']),
    credential: z.string().max(4000).optional(),
    headerName: z.string().max(100).optional(),
  }).default({ type: 'none' }),
  headers: z.record(z.string().max(2000)).optional(),
  bodyTemplate: z.string().max(10_000).optional(),
  fieldMapping: z.record(z.string().max(200)),
  notFoundWhen: z.object({
    fieldIsEmpty: z.string().max(200).optional(),
    fieldEquals: z.object({ path: z.string().max(200), value: z.union([z.string(), z.number(), z.boolean()]) }).optional(),
  }).optional(),
  attributeKey: z.string().max(100).optional(),
  bindTagId: z.string().uuid('標籤識別格式不正確').nullable().optional(),
  timeoutMs: z.number().int().min(500).max(30_000).optional(),
});

export default async function memberBindingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', { preHandler: [requirePermission('settings.manage')] }, tenantHandler(app, async (_request, _reply, ctx) => {
    const config = await getBindingConfig(ctx);
    return { success: true, data: maskConfig(config) };
  }));

  app.put('/', { preHandler: [requirePermission('settings.manage')] }, tenantHandler(app, async (request, reply, ctx) => {
    const body: MemberBindingConfig = configSchema.parse(request.body);
    if (body.enabled && !body.endpoint) {
      reply.code(400);
      return { success: false, error: { code: 'VALIDATION_ERROR', message: '啟用會員綁定須填寫查詢端點' } };
    }
    if (body.enabled && !body.fieldMapping?.memberId) {
      reply.code(400);
      return { success: false, error: { code: 'VALIDATION_ERROR', message: '欄位對應須包含 memberId' } };
    }

    // 未重填憑證時沿用既有值——前端拿到的是遮蔽後的字串，直接存會把金鑰覆蓋成 ••••
    const existing = await getBindingConfig(ctx);
    const credential =
      body.auth?.credential && !body.auth.credential.startsWith('••')
        ? body.auth.credential
        : existing?.auth?.credential;

    await saveBindingConfig(ctx, { ...body, auth: { ...body.auth, credential } });
    return { success: true };
  }));

  /**
   * 連線測試。存檔後可立刻驗證設定是否正確，而不是等顧客去踩雷。
   *
   * 用已存檔的憑證 + 請求帶的測試輸入。不接受請求直接帶憑證——
   * 否則此端點會變成用我們的伺服器對任意位址發送任意金鑰的跳板。
   */
  app.post('/test', { preHandler: [requirePermission('settings.manage')] }, async (request, reply) => {
    const body = z.object({ input: lookupInputSchema.optional() }).parse(request.body ?? {});
    // 讀設定在交易內，連線測試（外部呼叫）在交易外
    const config = await runInTenant(app, request.agent.tenantId, (ctx) => getBindingConfig(ctx));
    if (!config) {
      return reply.status(400).send({
        success: false,
        error: { code: 'NOT_CONFIGURED', message: '尚未儲存會員綁定設定' },
      });
    }

    // 測試時忽略 enabled，讓管理員可以先測通再啟用
    const result = await testConnection({ ...config, enabled: true }, body.input ?? {});
    if (!result.ok) {
      return reply.status(200).send({
        success: true,
        data: {
          ok: false,
          reason: result.reason,
          message: FAILURE_MESSAGES[result.reason],
          // 測試端點回 detail——這是給管理員排查用的，非顧客端
          detail: result.detail,
        },
      });
    }
    return {
      success: true,
      data: {
        ok: true,
        memberId: result.memberId,
        // 回傳取到的欄位，讓管理員確認 fieldMapping 對不對
        attributes: result.attributes,
      },
    };
  });

  /** 後台代顧客綁定（客服協助情境）。 */
  app.post('/contacts/:contactId', { preHandler: [requirePermission('contact.update')] }, async (request, reply) => {
    const { contactId } = contactParams.parse(request.params);
    const body = lookupInputSchema.parse(request.body ?? {});
    const result = await bindMember({ prisma: app.prisma, io: app.io }, request.agent.tenantId, contactId, body);
    if (!result.ok) {
      return reply.status(FAILURE_STATUS[result.reason]).send({
        success: false,
        error: { code: result.reason, message: FAILURE_MESSAGES[result.reason], detail: result.detail },
      });
    }
    return { success: true, data: { memberId: result.memberId } };
  });

  app.delete('/contacts/:contactId', { preHandler: [requirePermission('contact.update')] }, tenantHandler(app, async (request, _reply, ctx) => {
    const { contactId } = contactParams.parse(request.params);
    return { success: true, data: await unbindMember(ctx, contactId) };
  }));
}
