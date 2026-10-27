/**
 * 背景匯出完成或失敗時的站內通知（add-coupon-system design D22）：寫入通知，commit 後推播給匯出者。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { inTenant } from '../../lib/tenant-ctx.js';
import { notifyAgent } from '../../events/socket-push.js';
import { recordExportNotice, type ExportNotice } from './coupon-export.service.js';

export async function notifyExportResult(deps: { prisma: PrismaClient; io: Server }, notice: ExportNotice): Promise<void> {
  await inTenant(deps.prisma, notice.tenantId, async (scope) => {
    const notification = await recordExportNotice(scope, notice);
    notifyAgent(scope, deps.io, notice.agentId, 'notification.new', notification);
  });
}
