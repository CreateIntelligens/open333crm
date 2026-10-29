/**
 * 手機回報 LIFF 測試結果（change add-liff-config-test）。Prefix: /api/v1/fan/liff-test
 *
 * 不需要登入：testId 是 32 bytes 隨機值，本身就是這次測試的憑證，租戶與渠道只由它決定（design D2）。
 */
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod/v3';
import { AppError } from '../../shared/utils/response.js';
import { getBindingStore } from '../identity-binding/binding-code.js';
import { checkLineIdToken } from '../coupon/line-id-token.js';
import { LIFF_TEST_CLIENT_FAILURES, reportLiffTestFlow, type LiffTestDeps } from './liff-test.flow.js';

export interface LiffTestPublicRoutesOptions {
  /** 測試注入 Redis 替身、向 LINE 驗證的替身與時鐘 */
  liffTest?: Partial<LiffTestDeps>;
}

export const liffTestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, '測試連結格式不正確');

const reportSchema = z.union([
  z.object({ testId: liffTestIdSchema, idToken: z.string().min(1).max(4096) }).strict(),
  z.object({ testId: liffTestIdSchema, failure: z.enum(LIFF_TEST_CLIENT_FAILURES) }).strict(),
]);

export default async function liffTestPublicRoutes(app: FastifyInstance, opts: LiffTestPublicRoutesOptions = {}) {
  const deps = (): LiffTestDeps => ({
    prisma: app.prisma,
    checkIdToken: checkLineIdToken,
    ...opts.liffTest,
    store: opts.liffTest?.store ?? getBindingStore(),
  });

  await app.register(rateLimit, { global: true, max: 30, timeWindow: '1 minute', keyGenerator: (request) => request.ip });

  app.post('/', async (request) => {
    const input = reportSchema.parse(request.body ?? {});
    const outcome = await reportLiffTestFlow(deps(), input);
    if (!outcome) throw new AppError('測試連結已過期，請回後台重新產生', 'LIFF_TEST_EXPIRED', 410);
    return { success: true, data: outcome };
  });
}
