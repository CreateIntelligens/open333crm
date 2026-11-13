/**
 * 留言自動私訊的 API 排程（change add-comment-keyword-private-reply design D2、D25、D26）。
 * 掛在既有 api-scheduler（每期只有一個實例執行），皆 withoutOverlapping。
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Server as SocketIOServer } from 'socket.io';
import type { JobScheduler } from '../../lib/job-scheduler.js';
import { sendOpsAlert } from '../ops-alert/ops-alert.service.js';
import { createAndDispatch } from '../notification/notification.service.js';
import { runCommentReplyRecover, runCommentReplyRetention } from './comment-reply-maintenance.flow.js';
import { runCommentReplyHealth, tenantAdminNotifier } from './comment-reply-health.js';

export interface CommentReplySchedulerDeps {
  admin: PrismaClient;
  prisma: PrismaClient;
  redis: Redis;
  io: SocketIOServer;
}

export function setupCommentReplySchedulers(scheduler: JobScheduler, deps: CommentReplySchedulerDeps): void {
  scheduler.registerSchedule({
    id: 'comment-reply-recover',
    every: 5 * 60_000,
    withoutOverlapping: { expiresInMs: 4 * 60_000 },
    run: () => runCommentReplyRecover({ admin: deps.admin, prisma: deps.prisma }),
  });
  scheduler.registerSchedule({
    id: 'comment-reply-health',
    every: 5 * 60_000,
    withoutOverlapping: { expiresInMs: 4 * 60_000 },
    run: () =>
      runCommentReplyHealth({
        admin: deps.admin,
        redis: deps.redis,
        sendAlert: (alert) => sendOpsAlert(alert, { redis: deps.redis }),
        notifyTenantAdmins: tenantAdminNotifier(deps.admin, deps.io, createAndDispatch as never),
      }),
  });
  scheduler.registerSchedule({
    id: 'comment-reply-retention',
    every: 60 * 60_000,
    withoutOverlapping: { expiresInMs: 5 * 60_000 },
    run: () => runCommentReplyRetention({ admin: deps.admin, prisma: deps.prisma }),
  });
}
