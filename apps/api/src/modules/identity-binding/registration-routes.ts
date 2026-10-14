/**
 * 識別值登記的公開端點產生器：email 與手機各註冊一組（change add-email-identity-merge design D4、
 * add-phone-identity-merge）。
 *
 * 顧客不登入，以一次性連結的 token 作為憑證。租戶由 token 決定，查詢一律以 withTenant 綁定該租戶
 * （不使用 BYPASSRLS 的 prismaAdmin）。
 */
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { AppError, success } from '../../shared/utils/response.js';
import { logger } from '@open333crm/core';
import { tenantScopedClient, withTenant } from '../../lib/tenant-db.js';
import { getBindingStore, type BindingStore } from './binding-code.js';
import type { BindingDeps } from './binding-common.js';
import {
  describeRegistration,
  isRegistrationEnabled,
  readRegistration,
  sendRegistrationNotices,
  submitRegistration,
  type RegistrationKind,
  type RegistrationPayload,
} from './identifier-registration.js';

export interface RegistrationRoutesOptions {
  /** 測試可注入記憶體版儲存與送訊息函式 */
  store?: BindingStore;
  deliver?: BindingDeps['deliver'];
}

/** 各種登記在 API 上的差異：請求欄位名稱與錯誤 */
export interface RegistrationRouteSpec {
  kind: RegistrationKind;
  /** 請求 body 的欄位名稱（`email`／`phone`） */
  field: string;
  expiredCode: string;
  invalid: { message: string; code: string };
}

const tokenParamsSchema = z.object({ token: z.string().max(64) });

export function createRegistrationRoutes(spec: RegistrationRouteSpec) {
  const { kind } = spec;
  const submitBodySchema = z.object({ [spec.field]: z.unknown() });
  const expired = () => new AppError('連結已失效，請回到對話重新取得', spec.expiredCode, 410);

  return async function registrationRoutes(fastify: FastifyInstance, opts: RegistrationRoutesOptions) {
    const store = () => opts.store ?? getBindingStore();
    const deps = (): BindingDeps => ({ store: store(), io: fastify.io, ...(opts.deliver ? { deliver: opts.deliver } : {}) });

    await fastify.register(rateLimit, {
      global: true,
      max: 20,
      timeWindow: '1 minute',
      keyGenerator: (request) => request.ip,
    });

    /** 讀取有效連結；不存在、過期或租戶已關閉這種登記一律 410，回應相同 */
    async function activePayload(token: string): Promise<RegistrationPayload> {
      const payload = await readRegistration(kind, store(), token);
      if (!payload) throw expired();
      const enabled = await withTenant(fastify.prisma, payload.tenantId, (tx) => isRegistrationEnabled(kind, tx, payload.tenantId));
      if (!enabled) throw expired();
      return payload;
    }

    // GET /:token — 登記頁顯示要登記的帳號
    fastify.get('/:token', async (request, reply) => {
      const { token } = tokenParamsSchema.parse(request.params);
      const payload = await activePayload(token);
      const info = await withTenant(fastify.prisma, payload.tenantId, (tx) => describeRegistration(tx, payload));
      if (!info) throw expired();
      return reply.send(success(info));
    });

    // POST /:token — 送出識別值
    fastify.post('/:token', async (request, reply) => {
      const { token } = tokenParamsSchema.parse(request.params);
      const value = submitBodySchema.parse(request.body ?? {})[spec.field];
      const payload = await activePayload(token);

      const { result, notices } = await withTenant(fastify.prisma, payload.tenantId, (tx) =>
        submitRegistration(kind, tx, deps(), token, value),
      );
      if (result.status === 'invalid_value') throw new AppError(spec.invalid.message, spec.invalid.code, 400);
      if (result.status === 'expired') throw expired();

      // 資料已寫入後才送通知。推播是外部呼叫，不放在交易內（交易逾時會連失敗紀錄一起回滾），
      // 每個查詢各自綁定租戶。通知失敗不影響已完成的登記或合併：送不出去的訊息已在對話標示，其他錯誤記 log
      try {
        await sendRegistrationNotices(kind, tenantScopedClient(fastify.prisma, payload.tenantId), deps(), payload.tenantId, notices);
      } catch (err) {
        logger.error(`[${kind.logTag}] 通知送出失敗，登記結果不受影響`, err);
      }
      return reply.send(success({ status: result.status }));
    });
  };
}
