/**
 * 租戶資料存取的交易邊界（主規格 tenant-transaction-context，issue #337）。
 *
 * 入口（route、背景工作）以 inTenant() 開一個綁定租戶的交易，service 只收 TenantCtx：
 * - 交易內的寫入一起成功或一起失敗，查詢都受 RLS 約束到 ctx.tenantId。
 * - 事件（publish）與佇列 job（enqueue）在交易內寫進 outbox，與業務資料一起 commit；
 *   commit 之後交給快路徑送進佇列，沒送出的由 outbox-relay 補送（至少一次，change outbox-event-delivery）。
 * - 推播（notify）只先登記，commit 之後才送出，rollback 時丟棄；推播是最多一次。
 * - commit 之後的推播與快路徑依登記的順序執行。
 *
 * service 不自己開交易，也不在交易內呼叫外部服務（LINE、LLM 等）。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteGenericInterface } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { JobsOptions } from 'bullmq';
import type { Server } from 'socket.io';
import { logger, type OutboxInput, type OutboxRow } from '@open333crm/core';
import type { AppEventName } from '../events/event-bus.js';
import { createOutboxPublisher } from '../events/outbox-publisher.js';
import { agentPushRoom, tenantPushRoom, type AgentPushName, type TenantPushName } from '../events/socket-push.js';
import { withTenant } from './tenant-db.js';
import { AppError } from '../shared/utils/response.js';

export interface TenantCtx {
  /** 已設定 app.current_tenant 的交易；ctx 內的查詢都要用它 */
  readonly tx: Prisma.TransactionClient;
  readonly tenantId: string;
  /** commit 之後推播到本租戶的房間；失敗只記 log，不補送 */
  notify(name: TenantPushName, data: unknown): void;
  /** commit 之後推播給一位客服人員；房間帶交易綁定的租戶 ID，別的租戶的客服人員收不到 */
  notifyAgent(agentId: string, name: AgentPushName, data: unknown): void;
  /** 在交易內寫進 outbox，事件的 tenantId 由 ctx 填入；commit 之後送給訂閱者。保證是至少一次 */
  publish(name: AppEventName, payload: Record<string, unknown>): Promise<void>;
  /**
   * 在交易內寫進 outbox；commit 之後送進 queueName 的佇列，job id 是 outbox id。保證是至少一次。
   * opts 不接受 jobId、deduplication、debounce：這些選項會讓 BullMQ 不建立這筆 job
   */
  enqueue(queueName: string, name: string, data: unknown, opts?: OutboxJobOptions): Promise<void>;
}

export type OutboxJobOptions = Omit<JobsOptions, 'jobId' | 'deduplication' | 'debounce'>;

/** 業務事件與 job 的送出方式。正式程式用 createOutboxPublisher()，單元測試注入假的實作 */
export interface EventPublisher {
  /** 在交易內寫入一筆 outbox */
  write(tx: Prisma.TransactionClient, input: OutboxInput): Promise<OutboxRow>;
  /** commit 之後的快路徑：送進佇列並標記已送出。失敗的資料列留給 relay 補送 */
  dispatch(rows: OutboxRow[]): Promise<void>;
}

export interface TenantCtxDeps {
  prisma: PrismaClient;
  /** 沒有 io 的背景工作不能推播 */
  io?: Server;
  events: EventPublisher;
}

export async function inTenant<T>(
  deps: TenantCtxDeps,
  tenantId: string,
  fn: (ctx: TenantCtx) => Promise<T>,
): Promise<T> {
  const effects: Array<{ label: string; run: () => void }> = [];

  function push(room: string, name: string, data: unknown) {
    const io = deps.io;
    // 寫錯程式：在交易內丟錯讓它 rollback，不要等到 commit 後才默默丟掉推播
    if (!io) throw new Error(`inTenant: 沒有 io，不能推播 ${name}`);
    effects.push({ label: `push ${name}`, run: () => io.to(room).emit(name, data) });
  }

  function dispatchEffect(label: string, row: OutboxRow) {
    return {
      label,
      // 不 await：Redis 沒有回應時 add() 可能一直不結束，回應不能跟著卡住。
      // 失敗只記 log：資料列已在 outbox，relay 會補送
      run: () => {
        deps.events.dispatch([row]).catch((err: unknown) => {
          logger.error(`[inTenant] commit 後送出失敗，留給 relay 補送（${label}）`, err);
        });
      },
    };
  }

  const result = await withTenant(deps.prisma, tenantId, (tx) =>
    fn({
      tx,
      tenantId,
      notify(name, data) {
        push(tenantPushRoom(tenantId), name, data);
      },
      notifyAgent(agentId, name, data) {
        push(agentPushRoom(tenantId, agentId), name, data);
      },
      async publish(name, payload) {
        const row = await deps.events.write(tx, { tenantId, kind: 'event', name, payload });
        effects.push(dispatchEffect(`publish ${name}`, row));
      },
      async enqueue(queueName, name, data, opts) {
        const row = await deps.events.write(tx, {
          tenantId,
          kind: 'job',
          queueName,
          name,
          payload: data,
          ...(opts ? { jobOptions: opts as Record<string, unknown> } : {}),
        });
        effects.push(dispatchEffect(`enqueue ${name}`, row));
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
    const events = createOutboxPublisher(fastify.prisma);
    const body = await inTenant({ prisma: fastify.prisma, io: fastify.io, events }, tenantId, (ctx) =>
      handler(request, deferred.reply, ctx),
    );
    deferred.applyTo(reply);
    return reply.send(body);
  };
}
