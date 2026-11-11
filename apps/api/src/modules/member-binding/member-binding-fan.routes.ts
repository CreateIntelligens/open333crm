/**
 * 會員綁定顧客端 API：/api/v1/fan/member-binding（需 fan token）。
 * 與後台路由分檔：部署前的 OpenAPI 產生器以檔案對應掛載路徑，同一檔案註冊兩組路由會產生重複的端點。
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { verifyFanToken, type FanPayload } from '../portal/portal-auth.service.js';
import { bindMember, getBindingConfigFlow, getBindingFlow } from './member-binding.flow.js';
import { FAILURE_MESSAGES, FAILURE_STATUS, lookupInputSchema } from './member-binding-http.js';

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

export default async function memberBindingFanRoutes(app: FastifyInstance) {
  // 每次綁定都會呼叫客戶的會員 API，且回應分得出查無會員與已被綁定：限制頻率，避免被拿來列舉會員編號
  await app.register(rateLimit, { global: false });
  /** 綁定頁需知道要讓顧客填什麼——由設定的佔位符推導。 */
  app.get('/fields', { preHandler: authenticateFan }, async (request) => {
    const fan = request.fanBinding!;
    const config = await getBindingConfigFlow(app, fan.tenantId);
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
    const result = await getBindingFlow(app, fan.tenantId, fan.contactId);
    return { success: true, data: result };
  });

  app.post('/', {
    preHandler: authenticateFan,
    config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (request) => request.ip } },
  }, async (request, reply) => {
    const fan = request.fanBinding!;
    const body = lookupInputSchema.parse(request.body ?? {});
    const result = await bindMember({ prisma: app.prisma, io: app.io }, fan.tenantId, fan.contactId, body);
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
