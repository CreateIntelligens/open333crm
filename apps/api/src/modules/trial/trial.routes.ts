import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod/v3';
import { success } from '../../shared/utils/response.js';
import { AppError } from '../../shared/utils/response.js';
import { getVerifyStatus, requestTrial, resendTrial, verifyAndProvision } from './trial.service.js';

// 申請不收密碼（AUDIT TRIAL-05）。舊頁面仍可能送 password：z.object 預設丟掉未定義的欄位，不會進到 service。
const signupSchema = z.object({
  email: z.string().email(),
  siteName: z.string().trim().min(1).max(100),
});
// 密碼在點驗證連結之後設定；規則與成員密碼相同（至少 8 碼）
const completeSchema = z.object({
  token: z.string().min(1, '缺少驗證連結的 token'),
  password: z.string().min(8, '密碼至少需要 8 個字元'),
  siteName: z.string().trim().min(1, '請輸入站台名稱').max(100, '站台名稱最多 100 個字').optional(),
});
const resendSchema = z.object({ email: z.string().email() });

// 防枚舉統一回應
const GENERIC_ACCEPTED = { message: '若此 email 可申請，驗證信已寄出，請至信箱完成驗證。' };

export default async function trialRoutes(fastify: FastifyInstance) {
  await fastify.register(rateLimit, {
    global: false,
    max: 20,
    timeWindow: '10 minutes',
    keyGenerator: (request) => request.ip,
  });

  // POST /api/v1/trial/signups — 公開申請（防枚舉：一律 202 同文案）
  fastify.post(
    '/signups',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = signupSchema.parse(request.body);
      try {
        await requestTrial(fastify.prismaAdmin, {
          email: body.email,
          siteName: body.siteName,
          requestIp: request.ip,
        });
      } catch (err) {
        // 總開關關閉是唯一對外可見的差異（非枚舉面）
        if (err instanceof AppError && err.code === 'TRIAL_CLOSED') {
          return reply.status(403).send({ success: false, error: { code: 'TRIAL_CLOSED', message: '目前暫不開放試用申請' } });
        }
        // 其餘內部錯誤不外洩，仍回 generic（避免依錯誤推斷 email 狀態）
        fastify.log.error(err);
      }
      return reply.status(202).send(success(GENERIC_ACCEPTED));
    },
  );

  // POST /api/v1/trial/resend — 重寄（節流；一律 202）
  fastify.post(
    '/resend',
    { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = resendSchema.parse(request.body);
      try {
        await resendTrial(fastify.prismaAdmin, body.email);
      } catch (err) {
        fastify.log.error(err);
      }
      return reply.status(202).send(success(GENERIC_ACCEPTED));
    },
  );

  // GET /api/v1/trial/verify?token= — 驗證頁查詢連結（只讀，不消耗 token、不開通）
  fastify.get<{ Querystring: { token?: string } }>(
    '/verify',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const token = request.query.token;
      if (!token) throw new AppError('缺少 token', 'BAD_REQUEST', 400);
      const result = await getVerifyStatus(fastify.prismaAdmin, token);
      return reply.send(success(result));
    },
  );

  // POST /api/v1/trial/verify — 設定密碼並開通（原子消耗 token）
  fastify.post(
    '/verify',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = completeSchema.parse(request.body);
      const result = await verifyAndProvision(fastify.prismaAdmin, body);
      return reply.send(success(result));
    },
  );
}
