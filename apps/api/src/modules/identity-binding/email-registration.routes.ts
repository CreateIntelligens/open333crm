/**
 * Email 登記公開端點（change add-email-identity-merge，design D4）。
 * Prefix: /api/v1/public/email-registration
 *
 * 顧客不登入，以一次性連結的 token 作為憑證。租戶由 token 決定，查詢一律以 withTenant 綁定該租戶
 * （不使用 BYPASSRLS 的 prismaAdmin）。
 */
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { AppError, success } from '../../shared/utils/response.js';
import { withTenant } from '../../lib/tenant-db.js';
import { getBindingStore, type BindingStore } from './binding-code.js';
import type { BindingDeps } from './binding-common.js';
import {
  describeEmailRegistration,
  isEmailRegistrationEnabled,
  readEmailRegistration,
  sendEmailRegistrationNotices,
  submitEmailRegistration,
  type EmailRegistrationPayload,
} from './email-registration.service.js';

export interface EmailRegistrationRoutesOptions {
  /** 測試可注入記憶體版儲存與送訊息函式 */
  store?: BindingStore;
  deliver?: BindingDeps['deliver'];
}

const tokenParamsSchema = z.object({ token: z.string().max(64) });
const submitBodySchema = z.object({ email: z.unknown() });

const expired = () => new AppError('連結已失效，請回到對話重新取得', 'EMAIL_REGISTRATION_EXPIRED', 410);

export default async function emailRegistrationRoutes(fastify: FastifyInstance, opts: EmailRegistrationRoutesOptions) {
  const store = () => opts.store ?? getBindingStore();
  const deps = (): BindingDeps => ({ store: store(), io: fastify.io, ...(opts.deliver ? { deliver: opts.deliver } : {}) });

  await fastify.register(rateLimit, {
    global: true,
    max: 20,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });

  /** 讀取有效連結；不存在、過期或租戶已關閉 email 登記一律 410，回應相同 */
  async function activePayload(token: string): Promise<EmailRegistrationPayload> {
    const payload = await readEmailRegistration(store(), token);
    if (!payload) throw expired();
    const enabled = await withTenant(fastify.prisma, payload.tenantId, (tx) => isEmailRegistrationEnabled(tx, payload.tenantId));
    if (!enabled) throw expired();
    return payload;
  }

  // GET /:token — 登記頁顯示要登記的帳號
  fastify.get('/:token', async (request, reply) => {
    const { token } = tokenParamsSchema.parse(request.params);
    const payload = await activePayload(token);
    const info = await withTenant(fastify.prisma, payload.tenantId, (tx) => describeEmailRegistration(tx, payload));
    if (!info) throw expired();
    return reply.send(success(info));
  });

  // POST /:token — 送出 email
  fastify.post('/:token', async (request, reply) => {
    const { token } = tokenParamsSchema.parse(request.params);
    const { email } = submitBodySchema.parse(request.body ?? {});
    const payload = await activePayload(token);

    const { result, notices } = await withTenant(fastify.prisma, payload.tenantId, (tx) =>
      submitEmailRegistration(tx, deps(), token, email),
    );
    if (result.status === 'invalid_email') throw new AppError('email 格式不正確', 'INVALID_EMAIL', 400);
    if (result.status === 'expired') throw expired();

    // 資料已寫入後才送通知：推播是外部呼叫，不放在合併的交易內
    await withTenant(fastify.prisma, payload.tenantId, (tx) => sendEmailRegistrationNotices(tx, deps(), payload.tenantId, notices));
    return reply.send(success({ status: result.status }));
  });
}
