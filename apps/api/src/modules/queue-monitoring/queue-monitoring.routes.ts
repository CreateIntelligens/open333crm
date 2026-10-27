/**
 * 佇列監控（change queue-monitoring，design 決策 1–3）：在 API 行程掛載 bull-board，
 * 列出 API 與 workers 兩個行程的佇列。
 *
 * 每個請求依序檢查：
 * 1. 來源 IP 在 QUEUE_DASHBOARD_ALLOWED_CIDRS 內（畫面、靜態檔、API 與換發 cookie 的端點都檢查）。
 * 2. 換發端點以平台 JWT 驗證；其他路徑以監控 cookie 驗證，再即時查平台帳號。
 * bull-board 的畫面與靜態檔不經過它的 handlerHooks，所以兩項檢查都寫成 Fastify 的 onRequest hook。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Queue } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { FastifyAdapter } from '@bull-board/fastify';
import { getConfig } from '../../config/env.js';
import { success } from '../../shared/utils/response.js';
import { isAllowedIp, parseAllowedCidrs } from './ip-allowlist.js';
import { QUEUE_SESSION_COOKIE, QUEUE_SESSION_TTL_SECONDS, signQueueSession, verifyQueueSession } from './queue-session.js';
import { auditJobRetry, getPlatformUserStatus } from './queue-monitoring.service.js';
import { allowQueueOperation, FailedOnlyRetryAdapter, RETRY_JOB_ROUTE } from './operation-allowlist.js';
import { maskJobData } from './mask-job-data.js';

export interface QueueMonitoringOptions {
  /** QUEUE_DASHBOARD_ALLOWED_CIDRS：以逗號分隔的網段；沒有設定時拒絕所有連線 */
  allowedCidrs?: string;
  /** 監控的佇列，只用來讀取與重送 */
  queues: Queue[];
}

/** 沒有 Origin 標頭，或 Origin 的 host 與請求的 host 相同 */
function isSameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    // 兩邊都轉成 URL 再比較，預設 port（:80、:443）才會一致
    return new URL(origin).host === new URL(`${request.protocol}://${request.host}`).host;
  } catch {
    return false;
  }
}

function deny(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ success: false, error: { code, message } });
}

export default async function queueMonitoringRoutes(fastify: FastifyInstance, opts: QueueMonitoringOptions) {
  const basePath = fastify.prefix;
  const allowList = parseAllowedCidrs(opts.allowedCidrs);

  // 網段檢查在登入檢查之前：網段外的請求不會碰到平台帳號的查詢
  fastify.addHook('onRequest', async (request, reply) => {
    if (!isAllowedIp(allowList, request.ip)) {
      return deny(reply, 403, 'FORBIDDEN', '此來源 IP 不能使用佇列監控');
    }
  });

  const blockIfMustChangePassword = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.platformUser?.mustChangePassword) {
      return deny(reply, 403, 'MUST_CHANGE_PASSWORD', '請先修改密碼後再繼續使用');
    }
  };
  const guard = { preHandler: [fastify.authenticatePlatformSuperuser, blockIfMustChangePassword] };

  // 以平台 JWT 換發監控 cookie。平台後台未啟用時，authenticatePlatformSuperuser 回 503
  fastify.post('/session', guard, async (request, reply) => {
    const secret = getConfig().PLATFORM_JWT_SECRET!;
    reply.setCookie(QUEUE_SESSION_COOKIE, signQueueSession(secret, request.platformUser!.id), {
      httpOnly: true,
      sameSite: 'strict',
      secure: 'auto',
      path: basePath,
      maxAge: QUEUE_SESSION_TTL_SECONDS,
    });
    return success({ expiresIn: QUEUE_SESSION_TTL_SECONDS });
  });

  await fastify.register(async (board) => {
    board.addHook('onRequest', async (request, reply) => {
      // SameSite=Strict 擋不住同一個上層網域的其他子網域，全域 CORS 又反射任何 Origin，
      // 所以帶 Origin 的請求必須來自監控畫面自己的來源。瀏覽器在跨來源請求一定會帶 Origin
      if (!isSameOrigin(request)) {
        return deny(reply, 403, 'FORBIDDEN', '只能從佇列監控畫面操作');
      }
      const secret = getConfig().PLATFORM_JWT_SECRET;
      if (!secret) {
        return deny(reply, 503, 'PLATFORM_DISABLED', '平台管理功能尚未啟用，請聯繫系統管理員');
      }
      const platformUserId = verifyQueueSession(secret, request.cookies[QUEUE_SESSION_COOKIE]);
      if (!platformUserId) {
        return deny(reply, 401, 'UNAUTHORIZED', '請從平台後台重新開啟佇列監控');
      }
      const status = await getPlatformUserStatus(fastify.prismaAdmin, platformUserId);
      if (status === 'not_found') return deny(reply, 401, 'UNAUTHORIZED', '請從平台後台重新開啟佇列監控');
      if (status === 'disabled') {
        return deny(reply, 401, 'PLATFORM_USER_DISABLED', '此平台帳號已被停用，請聯繫系統管理員');
      }
      if (status === 'must_change_password') {
        return deny(reply, 403, 'MUST_CHANGE_PASSWORD', '請先修改密碼後再繼續使用');
      }
      request.platformUser = { id: platformUserId, role: 'PLATFORM_SUPERUSER', mustChangePassword: false };
    });

    // 重送成功時寫入平台稽核（design 決策 5）。handlerHooks 拿不到 Fastify 的 request，所以寫在 onResponse
    const retryRoute = `${basePath}${RETRY_JOB_ROUTE}`;
    board.addHook('onResponse', async (request, reply) => {
      if (request.method !== 'PUT' || request.routeOptions.url !== retryRoute) return;
      if (reply.statusCode < 200 || reply.statusCode >= 300 || !request.platformUser) return;
      const { queueName, jobId } = request.params as { queueName: string; jobId: string };
      await auditJobRetry(fastify.prismaAdmin, { platformUserId: request.platformUser.id, queueName, jobId });
    });

    const serverAdapter = new FastifyAdapter();
    serverAdapter.setBasePath(basePath);
    createBullBoard({
      queues: opts.queues.map((queue) => {
        const adapter = new FailedOnlyRetryAdapter(queue);
        // job 資料可能含客人的個資，只顯示識別欄位（design 決策 6）
        adapter.setFormatter('data', maskJobData);
        return adapter;
      }),
      serverAdapter,
      options: {
        uiConfig: { boardTitle: 'open333CRM 佇列監控' },
        handlerHooks: { before: allowQueueOperation },
      },
    });
    await board.register(serverAdapter.registerPlugin());
  });
}
