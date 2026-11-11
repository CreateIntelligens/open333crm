import type { PrismaClient } from '@prisma/client';
import { processResumeQueue } from '@open333crm/core';
import type { JobScheduler } from '../../lib/job-scheduler.js';
import { withTenant } from '../../lib/tenant-db.js';

const POLL_INTERVAL_MS = 60_000;
// 這一期最久會跑多久。上一期還沒跑完時，下一期略過
const MAX_RUN_MS = 10 * 60_000;

interface CanvasSchedulerClients {
  /** BYPASSRLS：跨租戶找出到期的等待 */
  admin: PrismaClient;
  /** app_tenant：每筆在租戶交易內以條件更新認領（issue #334） */
  prisma: PrismaClient;
}

export function setupCanvasScheduler(scheduler: JobScheduler, { admin, prisma }: CanvasSchedulerClients) {
  scheduler.registerSchedule({
    id: 'canvas-resume',
    every: POLL_INTERVAL_MS,
    withoutOverlapping: { expiresInMs: MAX_RUN_MS },
    run: () =>
      processResumeQueue({
        admin,
        inTenant: (tenantId, fn) => withTenant(prisma, tenantId, fn),
      }),
  });
}
