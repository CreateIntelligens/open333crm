/**
 * 租戶資料存取的交易邊界（主規格 tenant-transaction-context，issue #337）。
 *
 * 入口（flow、route、背景工作）以 inTenant() 開一個綁定租戶的交易：
 * - 交易內的寫入一起成功或一起失敗，查詢都受 RLS 約束到 tenantId。
 * - 入口拿到 TenantScope：TenantCtx 加上 afterCommit。afterCommit 的動作在 commit 之後依登記順序執行，
 *   inTenant() 等它們完成才回傳；rollback 時不執行；失敗只記 log；最多一次。
 * - service 只收 TenantCtx（tx、tenantId），拿不到任何副作用的能力。
 *
 * 推播、事件、job、稽核是收 scope 的獨立函式，不是 scope 的方法（change migrate-role-agent-tenant-ctx，決策 6）：
 * notifyTenant / notifyAgent（events/socket-push.ts）、publishEvent / enqueueJob（events/outbox-publisher.ts）、
 * recordTenantAudit（modules/tenant-audit/tenant-audit.service.ts）。什麼時候用哪個，見 AGENTS.md 結構規則 2。
 *
 * service 不自己開交易，也不在交易內呼叫外部服務（LINE、LLM 等）。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteGenericInterface } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { withTenant } from './tenant-db.js';
import { AppError } from '../shared/utils/response.js';

/** service 收的參數：已設定 app.current_tenant 的交易與綁定的租戶 */
export interface TenantCtx {
  /** 已設定 app.current_tenant 的交易；查詢都要用它 */
  readonly tx: Prisma.TransactionClient;
  readonly tenantId: string;
}

/** 入口（flow、背景工作）在 inTenant() 內拿到的 scope */
export interface TenantScope extends TenantCtx {
  /**
   * commit 之後執行 fn，inTenant() 等它完成才回傳；rollback 時不執行。
   * 失敗只記 log，不補做。推播、outbox 的快路徑與清快取都經由這裡登記
   */
  afterCommit(label: string, fn: () => unknown): void;
}

export async function inTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (scope: TenantScope) => Promise<T>,
): Promise<T> {
  const effects: Array<{ label: string; run: () => unknown }> = [];

  const result = await withTenant(prisma, tenantId, (tx) =>
    fn({
      tx,
      tenantId,
      afterCommit(label, run) {
        effects.push({ label, run });
      },
    }),
  );

  // 走到這裡代表已經 commit：資料已寫入，送出失敗不能讓結果變成失敗
  for (const effect of effects) {
    try {
      await effect.run();
    } catch (err) {
      logger.error(`[inTenant] commit 後的動作失敗（${effect.label}）`, err);
    }
  }
  return result;
}

/**
 * 交易內程式拿到的 reply：只能設定狀態碼與 header，不能送出。
 * 在交易內送出回應，等於 commit 之前就告訴前端成功。
 * 方法回傳自己而不是 FastifyReply，避免 reply.code(201).send() 繞過限制。
 */
export interface TenantReply {
  code(statusCode: number): TenantReply;
  status(statusCode: number): TenantReply;
  header(key: string, value: unknown): TenantReply;
}

/**
 * 狀態碼與 header 先存起來，commit 之後才套用到真正的 reply。
 * 交易失敗時錯誤回應由 error handler 產生，不能帶著成功時才該有的 header（例如 Location）。
 */
function deferReply(): { reply: TenantReply; applyTo(reply: FastifyReply): void } {
  let statusCode: number | undefined;
  const headers: Array<[string, unknown]> = [];
  const restricted: TenantReply = {
    code(code) {
      statusCode = code;
      return restricted;
    },
    status(code) {
      statusCode = code;
      return restricted;
    },
    header(key, value) {
      headers.push([key, value]);
      return restricted;
    },
  };
  return {
    reply: restricted,
    applyTo(reply) {
      if (statusCode !== undefined) reply.code(statusCode);
      for (const [key, value] of headers) reply.header(key, value);
    },
  };
}

/**
 * 舊寫法：route 改成呼叫 flow（AGENTS.md 結構規則 2），沒有 route 使用之後刪除。
 * 包住 route handler：以 request.agent.tenantId 開綁定租戶的交易，commit 之後才送出回應。
 * 交易內程式回傳回應內容；丟出的錯誤交給 Fastify 的 error handler。
 */
export function tenantHandler<RouteGeneric extends RouteGenericInterface = RouteGenericInterface>(
  fastify: FastifyInstance,
  handler: (request: FastifyRequest<RouteGeneric>, reply: TenantReply, ctx: TenantCtx) => Promise<unknown>,
) {
  return async (request: FastifyRequest<RouteGeneric>, reply: FastifyReply) => {
    const tenantId = request.agent?.tenantId;
    if (!tenantId) throw new AppError('需要已登入的租戶身分', 'UNAUTHORIZED', 401);

    const deferred = deferReply();
    // handler 只拿到 TenantCtx：有副作用（稽核、推播、事件、快取、外部呼叫）的 route 要經過 flow
    const body = await inTenant(fastify.prisma, tenantId, ({ tx }) => handler(request, deferred.reply, { tx, tenantId }));
    deferred.applyTo(reply);
    return reply.send(body);
  };
}
