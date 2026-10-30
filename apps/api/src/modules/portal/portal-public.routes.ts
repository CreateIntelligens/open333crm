/**
 * Fan Public API routes — public portal access with fan JWT.
 * Prefix: /api/v1/fan
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod/v3';
import type { EventPublisher } from '../../events/outbox-publisher.js';
import { verifyFanToken, type FanPayload } from './portal-auth.service.js';
import {
  getActivityForFanFlow,
  getActivityResultFlow,
  getFanPointsFlow,
  listContactSubmissionsFlow,
  listOpenActivitiesForFanFlow,
  submitActivityFlow,
} from './portal.flow.js';

// Extend FastifyRequest with fan payload
declare module 'fastify' {
  interface FastifyRequest {
    fan?: FanPayload;
  }
}

/**
 * Authenticate fan JWT from Authorization header.
 */
async function authenticateFan(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: '請先完成身分驗證' } });
  }
  const token = authHeader.slice(7);
  const payload = verifyFanToken(token);
  if (!payload) {
    return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: '登入已失效，請重新開啟連結' } });
  }
  request.fan = payload;
}

// 每個輸入欄位都以 Zod 解析，不以 as 轉型（AGENTS.md Conventions 的 Validation）。這是公開端點
const idParams = z.object({ id: z.string().uuid('活動識別格式不正確') });

/** 作答：optionIds 是選項 id；fields 是表單欄位，鍵是 fieldKey，值是填寫的文字 */
const submitBody = z.object({
  optionIds: z.array(z.string().uuid('選項識別格式不正確')).max(100, '選項不可超過 100 個').optional(),
  fields: z
    .record(z.string().max(100, '欄位代碼不可超過 100 字'), z.string().max(5000, '填寫內容不可超過 5000 字'))
    .refine((f) => Object.keys(f).length <= 100, '欄位不可超過 100 個')
    .optional(),
});

export interface PortalPublicRoutesOptions {
  /** 測試用：取代寫 outbox 的 publisher */
  events?: EventPublisher;
}

export default async function portalPublicRoutes(app: FastifyInstance, opts: PortalPublicRoutesOptions = {}) {
  // 粉絲門戶是公開端點（訪客持 fanToken，非租戶客服登入）。租戶取自已驗簽的 fanToken，
  // flow 以該租戶開交易，查詢走 RLS（不使用 BYPASSRLS 的 prismaAdmin）：
  // 查詢條件漏帶 tenantId 時仍有 RLS 兜底（原本 getPointBalance 就漏帶，AUDIT RLS-07 的 code review）。

  // 已移除 POST /auth：舊版憑任意 {contactId, tenantId} 即簽發 fanToken，
  // 不驗證呼叫者身分（任何人都能冒充任一顧客）。fanToken 改由經平台驗證的流程
  // 簽發（見 openspec change add-cross-channel-one-id）。

  // ── Protected routes (fan JWT) ────────────────────────────────────────────

  app.get('/activities', { preHandler: authenticateFan }, async (request) => {
    const fan = request.fan!;
    const activities = await listOpenActivitiesForFanFlow(app, fan.tenantId);
    return { success: true, data: activities };
  });

  app.get('/activities/:id', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fan!;
    const { id } = idParams.parse(request.params);
    const activity = await getActivityForFanFlow(app, fan.tenantId, id, fan.contactId);
    if (!activity) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此活動，可能已結束或被下架' } });
    return { success: true, data: activity };
  });

  app.post('/activities/:id/submit', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fan!;
    const { id } = idParams.parse(request.params);
    // 在 try 之外解析：不合法的輸入回 400 VALIDATION_ERROR，不被下面的 catch 改成 BAD_REQUEST（PORTAL-02）
    const body = submitBody.parse(request.body ?? {});
    try {
      const submission = await submitActivityFlow({ prisma: app.prisma, events: opts.events }, fan, id, body);
      return { success: true, data: submission };
    } catch (err: unknown) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    }
  });

  app.get('/activities/:id/result', { preHandler: authenticateFan }, async (request, reply) => {
    const fan = request.fan!;
    const { id } = idParams.parse(request.params);
    const result = await getActivityResultFlow(app, fan.tenantId, id);
    if (!result) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此活動，可能已結束或被下架' } });
    return { success: true, data: result };
  });

  app.get('/me/activities', { preHandler: authenticateFan }, async (request) => {
    const fan = request.fan!;
    const submissions = await listContactSubmissionsFlow(app, fan.tenantId, fan.contactId);
    return { success: true, data: submissions };
  });

  app.get('/me/points', { preHandler: authenticateFan }, async (request) => {
    const fan = request.fan!;
    const { balance, transactions } = await getFanPointsFlow(app, fan);
    return { success: true, data: { balance, transactions: transactions.items } };
  });
}
