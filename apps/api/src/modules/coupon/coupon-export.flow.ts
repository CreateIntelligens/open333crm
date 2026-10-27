/**
 * 序號明細匯出（add-coupon-system design D22）：查券與筆數、決定直接下載或背景產生，
 * 背景產生完成或失敗時寫入站內通知並在 commit 後推播給匯出者。
 * 明細分頁讀，每頁一個交易（避開 5 秒的交易時限）。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { inTenant, type TenantCtx } from '../../lib/tenant-ctx.js';
import { notifyAgent } from '../../events/socket-push.js';
import type { BindingStore } from '../identity-binding/binding-code.js';
import { getCoupon } from './coupon.service.js';
import { exportInstancesCsv } from './coupon-stats.service.js';
import { countInstances, recordExportNotice, startBackgroundExport, type ExportNotice } from './coupon-export.service.js';

export interface InstanceExportDeps {
  prisma: PrismaClient;
  io: Server;
  store: BindingStore;
  /** 超過這個筆數改背景產生 */
  syncLimit: number;
  /** 測試用：背景產生前執行，可丟錯模擬失敗 */
  beforeGenerate?: () => Promise<void>;
}

export type InstanceExportResult =
  | { kind: 'not_found' }
  | { kind: 'background'; jobId: string }
  | { kind: 'file'; couponName: string; csv: string };

/** 匯出一張券的序號明細：筆數不超過 syncLimit 時直接回傳 CSV，否則背景產生 */
export async function exportInstancesFlow(
  deps: InstanceExportDeps,
  actor: { tenantId: string; agentId: string },
  couponId: string,
): Promise<InstanceExportResult> {
  const runInTenant = <T>(fn: (ctx: TenantCtx) => Promise<T>) => inTenant(deps.prisma, actor.tenantId, fn);
  const found = await runInTenant(async (ctx) => {
    const coupon = await getCoupon(ctx, couponId);
    return coupon ? { name: coupon.name, count: await countInstances(ctx, couponId) } : null;
  });
  if (!found) return { kind: 'not_found' };

  if (found.count > deps.syncLimit) {
    const { jobId } = startBackgroundExport(
      {
        store: deps.store,
        notify: (notice) => notifyExportResult(deps, notice),
        runInTenant,
        beforeGenerate: deps.beforeGenerate,
      },
      { tenantId: actor.tenantId, agentId: actor.agentId, couponId, couponName: found.name, fileName: found.name },
    );
    return { kind: 'background', jobId };
  }
  return { kind: 'file', couponName: found.name, csv: await exportInstancesCsv(runInTenant, couponId) };
}

export async function notifyExportResult(deps: { prisma: PrismaClient; io: Server }, notice: ExportNotice): Promise<void> {
  await inTenant(deps.prisma, notice.tenantId, async (scope) => {
    const notification = await recordExportNotice(scope, notice);
    notifyAgent(scope, deps.io, notice.agentId, 'notification.new', notification);
  });
}
