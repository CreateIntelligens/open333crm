/**
 * feature 測試呼叫收 TenantCtx 的 service 與 flow（AGENTS.md 結構規則 2）。
 *
 * - runInTenant：以真實 inTenant() 開租戶交易。
 * - ctxOf：測試已在 withTenant 的交易內時，用那個交易組出 TenantCtx。
 * - testIo、recordingIo：給 flow 的假 io，推播記在 pushed（或呼叫端給的陣列），測試可檢查房間、事件與內容。
 *   推播由 flow 在 commit 之後送出，service 不推播。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { inTenant, type TenantCtx, type TenantScope } from '#src/lib/tenant-ctx.js';

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

export function runInTenant<T>(prisma: PrismaClient, tenantId: string, fn: (scope: TenantScope) => Promise<T>): Promise<T> {
  return inTenant(prisma, tenantId, fn);
}

export function ctxOf(tx: unknown, tenantId: string): TenantCtx {
  return { tx: tx as TenantCtx['tx'], tenantId };
}
