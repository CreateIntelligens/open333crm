/**
 * 租戶資料存取的交易邊界（主規格 tenant-transaction-context，issue #337）。
 *
 * 入口（route、背景工作）以 inTenant() 開一個綁定租戶的交易，service 只收 TenantCtx：
 * - 交易內的寫入一起成功或一起失敗，查詢都受 RLS 約束到 ctx.tenantId。
 * - 推播（emit）與事件（publish）只先登記，commit 之後才依序送出；rollback 時全部丟棄。
 *
 * service 不自己開交易，也不在交易內呼叫外部服務（LINE、LLM 等）。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteGenericInterface } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { logger } from '@open333crm/core';
import { eventBus, type AppEventName } from '../events/event-bus.js';
import { withTenant } from './tenant-db.js';
import { AppError } from '../shared/utils/response.js';

export interface TenantCtx {
  /** 已設定 app.current_tenant 的交易；ctx 內的查詢都要用它 */
  readonly tx: Prisma.TransactionClient;
  readonly tenantId: string;
  /** commit 之後推播到 Socket.IO 房間；失敗只記 log，不補送 */
  emit(room: string, event: string, data: unknown): void;
  /** commit 之後交給 eventBus；事件的 tenantId 與時間由 ctx 填入。保證是最多一次 */
  publish(name: AppEventName, payload: Record<string, unknown>): void;
}

export interface TenantCtxDeps {
  prisma: PrismaClient;
  /** 沒有 io 的背景工作不能 emit */
  io?: Server;
}

export async function inTenant<T>(
  deps: TenantCtxDeps,
  tenantId: string,
  fn: (ctx: TenantCtx) => Promise<T>,
): Promise<T> {
  const effects: Array<{ label: string; run: () => void }> = [];

  const result = await withTenant(deps.prisma, tenantId, (tx) =>
    fn({
      tx,
      tenantId,
      emit(room, event, data) {
        const io = deps.io;
        // 寫錯程式：在交易內丟錯讓它 rollback，不要等到 commit 後才默默丟掉推播
        if (!io) throw new Error(`inTenant: 沒有 io，不能推播 ${event}`);
        // conversation:、agent: 等房間沒有租戶前綴，這裡擋不到；只擋明顯推到別的租戶
        if (room.startsWith('tenant:') && room !== `tenant:${tenantId}`) {
          throw new Error(`inTenant: 不能推播 ${event} 到別的租戶房間 ${room}`);
        }
        effects.push({ label: `emit ${event}`, run: () => io.to(room).emit(event, data) });
      },
      publish(name, payload) {
        effects.push({
          label: `publish ${name}`,
          run: () => eventBus.publish({ name, tenantId, timestamp: new Date(), payload }),
        });
      },
    }),
  );

  // 走到這裡代表已經 commit：資料已寫入，送出失敗不能讓結果變成失敗
  for (const effect of effects) {
    try {
      effect.run();
    } catch (err) {
      logger.error(`[inTenant] commit 後送出失敗（${effect.label}）`, err);
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
    const body = await inTenant({ prisma: fastify.prisma, io: fastify.io }, tenantId, (ctx) =>
      handler(request, deferred.reply, ctx),
    );
    deferred.applyTo(reply);
    return reply.send(body);
  };
}
