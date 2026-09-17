/**
 * 會員綁定 API。
 * - 後台設定：/api/v1/member-binding（需 settings.manage）
 * - 顧客端綁定：/api/v1/fan/member-binding（需 fan token）
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission } from '../../guards/rbac.guard.js';
import { verifyFanToken, type FanPayload } from '../portal/portal-auth.service.js';
import {
  getBindingConfig,
  saveBindingConfig,
  bindMember,
  getBinding,
  unbindMember,
} from './member-binding.service.js';
import { testConnection } from './member-lookup.service.js';
import type { MemberBindingConfig, BindingFailureReason } from './member-binding.types.js';

/** 對顧客的說明。技術細節留在 detail 欄位供後台排查，不外露。 */
const FAILURE_MESSAGES: Record<BindingFailureReason, string> = {
  UPSTREAM_UNREACHABLE: '會員系統暫時無法連線，請稍後再試',
  UPSTREAM_ERROR: '會員系統回應異常，請稍後再試或聯繫客服',
  MEMBER_NOT_FOUND: '查無此會員資料，請確認輸入是否正確',
  NOT_CONFIGURED: '尚未開放會員綁定',
  ALREADY_BOUND_TO_OTHER: '此會員編號已被其他帳號綁定，請聯繫客服',
};

/** 外部系統問題回 502，顧客輸入問題回 404／409 —— 讓監控能區分。 */
const FAILURE_STATUS: Record<BindingFailureReason, number> = {
  UPSTREAM_UNREACHABLE: 502,
  UPSTREAM_ERROR: 502,
  MEMBER_NOT_FOUND: 404,
  NOT_CONFIGURED: 400,
  ALREADY_BOUND_TO_OTHER: 409,
};

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

export default async function memberBindingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', { preHandler: [requirePermission('settings.manage')] }, async (request) => {
    const config = await getBindingConfig(app.prisma, request.agent.tenantId);
    return { success: true, data: maskConfig(config) };
  });

  app.put('/', { preHandler: [requirePermission('settings.manage')] }, async (request, reply) => {
    const body = request.body as MemberBindingConfig;
    if (body.enabled && !body.endpoint) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: '啟用會員綁定須填寫查詢端點' },
      });
    }
    if (body.enabled && !body.fieldMapping?.memberId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: '欄位對應須包含 memberId' },
      });
    }

    // 未重填憑證時沿用既有值——前端拿到的是遮蔽後的字串，直接存會把金鑰覆蓋成 ••••
    const existing = await getBindingConfig(app.prisma, request.agent.tenantId);
    const credential =
      body.auth?.credential && !body.auth.credential.startsWith('••')
        ? body.auth.credential
        : existing?.auth?.credential;

    await saveBindingConfig(app.prisma, request.agent.tenantId, {
      ...body,
      auth: { ...(body.auth ?? { type: 'none' }), credential },
    });
    return { success: true };
  });

  /**
   * 連線測試。存檔後可立刻驗證設定是否正確，而不是等顧客去踩雷。
   *
   * 用已存檔的憑證 + 請求帶的測試輸入。不接受請求直接帶憑證——
   * 否則此端點會變成用我們的伺服器對任意位址發送任意金鑰的跳板。
   */
  app.post('/test', { preHandler: [requirePermission('settings.manage')] }, async (request, reply) => {
    const body = request.body as { input?: Record<string, string> };
    const config = await getBindingConfig(app.prisma, request.agent.tenantId);
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
    const { contactId } = request.params as { contactId: string };
    const body = request.body as Record<string, string>;
    const result = await bindMember(app.prisma, request.agent.tenantId, contactId, body);
    if (!result.ok) {
      return reply.status(FAILURE_STATUS[result.reason]).send({
        success: false,
        error: { code: result.reason, message: FAILURE_MESSAGES[result.reason], detail: result.detail },
      });
    }
    return { success: true, data: { memberId: result.memberId } };
  });

  app.delete('/contacts/:contactId', { preHandler: [requirePermission('contact.update')] }, async (request) => {
    const { contactId } = request.params as { contactId: string };
    const result = await unbindMember(app.prisma, request.agent.tenantId, contactId);
    return { success: true, data: result };
  });
}

// ── 顧客端 ───────────────────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    fanBinding?: FanPayload;
  }
}

async function authenticateFan(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: '需要登入' } });
  }
  const payload = verifyFanToken(header.slice(7));
  if (!payload) {
    return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: '登入已失效' } });
  }
  request.fanBinding = payload;
}

export async function memberBindingFanRoutes(app: FastifyInstance) {
  /** 綁定頁需知道要讓顧客填什麼——由設定的佔位符推導。 */
  app.get('/fields', { preHandler: authenticateFan }, async (request) => {
    const fan = request.fanBinding!;
    const config = await getBindingConfig(app.prisma, fan.tenantId);
    if (!config?.enabled) {
      return { success: true, data: { enabled: false, fields: [] } };
    }
    // 從 endpoint 與 bodyTemplate 抽出 {{欄位}}，前端據此產生輸入框
    const source = `${config.endpoint} ${config.bodyTemplate ?? ''}`;
    const fields = [...new Set(Array.from(source.matchAll(/\{\{(\w+)\}\}/g), (m) => m[1]))];
    return { success: true, data: { enabled: true, fields } };
  });

  app.get('/', { preHandler: authenticateFan }, async (request) => {
    const fan = request.fanBinding!;
    const result = await getBinding(app.prisma, fan.tenantId, fan.contactId);
    return { success: true, data: result };
  });

  app.post('/', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fanBinding!;
    const body = request.body as Record<string, string>;
    const result = await bindMember(app.prisma, fan.tenantId, fan.contactId, body);
    if (!result.ok) {
      return reply.status(FAILURE_STATUS[result.reason]).send({
        success: false,
        // detail 不回給顧客——可能含外部系統的內部錯誤訊息
        error: { code: result.reason, message: FAILURE_MESSAGES[result.reason] },
      });
    }
    return { success: true, data: { memberId: result.memberId } };
  });
}
