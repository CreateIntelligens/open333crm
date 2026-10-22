/**
 * feature 測試呼叫收 TenantCtx 的 service（AGENTS.md 結構規則 2）。
 *
 * - runInTenant：以真實 inTenant() 開租戶交易；推播送到記錄用的假 io，commit 後才記錄。
 * - ctxOf：測試已在 withTenant 的交易內時，用那個交易組出 TenantCtx；推播立即記錄。
 *
 * 推播一律記在 pushed，測試可檢查房間、事件與內容。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { inTenant, type TenantCtx } from '#src/lib/tenant-ctx.js';
import { writeOutbox } from '@open333crm/core';
import { createOutboxPublisher } from '#src/events/outbox-publisher.js';
import { agentPushRoom, tenantPushRoom } from '#src/events/socket-push.js';

export interface PushRecord {
  room: string;
  event: string;
  data: unknown;
}

/** 本測試檔所有推播（每個測試檔各自一份模組實例） */
export const pushed: PushRecord[] = [];

export function recordingIo(records: PushRecord[] = pushed): Server {
  return {
    to(room: string) {
      return {
        emit(event: string, data: unknown) {
          records.push({ room, event, data });
          return true;
        },
      };
    },
  } as unknown as Server;
}

export const testIo = recordingIo();

export function runInTenant<T>(prisma: PrismaClient, tenantId: string, fn: (ctx: TenantCtx) => Promise<T>): Promise<T> {
  return inTenant({ prisma, io: testIo, events: createOutboxPublisher(prisma) }, tenantId, fn);
}

export function ctxOf(tx: unknown, tenantId: string): TenantCtx {
  return {
    tx: tx as TenantCtx['tx'],
    tenantId,
    notify(name, data) {
      pushed.push({ room: tenantPushRoom(tenantId), event: name, data });
    },
    notifyAgent(agentId, name, data) {
      pushed.push({ room: agentPushRoom(tenantId, agentId), event: name, data });
    },
    // 與 inTenant() 相同：事件與 job 寫進測試交易的 outbox，交易結束時跟著 commit 或 rollback
    async publish(name, payload) {
      await writeOutbox(tx as TenantCtx['tx'], { tenantId, kind: 'event', name, payload });
    },
    async enqueue(queueName, name, data, opts) {
      await writeOutbox(tx as TenantCtx['tx'], { tenantId, kind: 'job', queueName, name, payload: data, ...(opts ? { jobOptions: opts } : {}) });
    },
  };
}
