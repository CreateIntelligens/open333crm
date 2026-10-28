/**
 * 單元測試呼叫 flow 用的假依賴（#337 階段 3）。
 *
 * - mockTransactionPrisma：prisma.$transaction 以 mock 模擬。callback resolve 之後記一筆 'commit'；
 *   callback 丟出錯誤時記一筆 'rollback'，再把錯誤丟回去。inTenant() 因此照常在 commit 之後執行 afterCommit。
 * - recordingPublisher：假的 EventPublisher。事件寫入時記 'event:<name>'，快路徑送出時記 'dispatch:<name>'。
 * - recordingIo：假的 Socket.IO，推播時記 'push:<event>'。
 *
 * 三者寫進同一個 log，測試可以檢查先後順序，例如推播在 commit 之後。
 */
import type { Server } from 'socket.io';
import type { EventPublisher } from '#src/events/outbox-publisher.js';

export interface FlowLog {
  /** 依發生順序記錄 */
  entries: string[];
  /** 寫進 outbox 的事件 */
  events: Array<{ name: string; payload: Record<string, unknown> }>;
  /** 推播的事件與內容 */
  pushes: Array<{ room: string; event: string; data: unknown }>;
}

export function createFlowLog(): FlowLog {
  return { entries: [], events: [], pushes: [] };
}

export function mockTransactionPrisma(log: FlowLog, tx: Record<string, unknown>) {
  const txWithTenant = { $executeRaw: async () => 1, ...tx };
  return {
    async $transaction(cb: (t: unknown) => Promise<unknown>) {
      try {
        const result = await cb(txWithTenant);
        log.entries.push('commit');
        return result;
      } catch (err) {
        log.entries.push('rollback');
        throw err;
      }
    },
  } as never;
}

export function recordingPublisher(log: FlowLog): EventPublisher {
  return {
    async write(_tx, input) {
      log.entries.push(`event:${input.name}`);
      if (input.kind === 'event') log.events.push({ name: input.name, payload: input.payload as Record<string, unknown> });
      return {
        id: `outbox-${log.entries.length}`,
        tenantId: input.tenantId,
        kind: input.kind,
        name: input.name,
        queueName: input.kind === 'job' ? input.queueName : null,
        payload: input.payload as never,
        jobOptions: null,
        createdAt: new Date(),
      };
    },
    async dispatch(rows) {
      for (const row of rows) log.entries.push(`dispatch:${row.name}`);
    },
  };
}

export function recordingIo(log: FlowLog): Server {
  return {
    to(room: string) {
      return {
        emit(event: string, data: unknown) {
          log.entries.push(`push:${event}`);
          log.pushes.push({ room, event, data });
          return true;
        },
      };
    },
  } as unknown as Server;
}
