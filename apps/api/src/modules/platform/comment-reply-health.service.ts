/**
 * 平台留言自動私訊健康頁的資料（change add-comment-keyword-private-reply design D21、D25；
 * spec comment-reply-platform-controls「平台留言自動私訊頁」）。
 *
 * 平台層跨租戶唯讀：呼叫端傳入 prismaAdmin（BYPASSRLS，本檔在 modules/platform/，屬 check-prisma-admin-usage 白名單）。
 * 只讀資料庫與佇列數量，不呼叫 Meta：訂閱狀態、權杖狀態、最後收到留言時間都讀渠道 settings
 * （由 meta-token-health 與 comment-reply-health 排程寫入）。
 */
import type { PrismaClient } from '@prisma/client';
import { decryptCredentials } from '../channel/channel.service.js';

export type QueueCounts = Record<string, number>;

export interface CommentReplyHealthChannel {
  tenantId: string;
  tenantName: string | null;
  channelId: string;
  channelType: string;
  displayName: string;
  appMode: 'platform' | 'own_app';
  subscription: { status: string | null; checkedAt: string | null };
  tokenStatus: string | null;
  lastCommentEventAt: string | null;
  activeRules: number;
  sent24h: number;
  failed24h: number;
  pending24h: number;
  topFailureReason: string | null;
}

export interface CommentReplyHealth {
  summary: {
    matched24h: number;
    sent24h: number;
    /** 24 小時內 失敗 ÷（送出＋失敗），沒有資料時是 0 */
    failureRate24h: number;
    /** 佇列 comment-reply 各狀態數量；Redis 讀不到時為 null */
    queue: QueueCounts | null;
    oldestPendingAt: string | null;
  };
  channels: CommentReplyHealthChannel[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function obj(v: unknown): Record<string, any> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

/** 平台模式（平台 Meta App 連結）或自備 App／IG 手動權杖 */
export function channelAppMode(credentialsEncrypted: string | null): 'platform' | 'own_app' {
  if (!credentialsEncrypted) return 'own_app';
  try {
    return decryptCredentials(credentialsEncrypted).connectMode === 'platform' ? 'platform' : 'own_app';
  } catch {
    return 'own_app';
  }
}

/**
 * @description 平台健康頁：開啟留言接收的渠道與全平台 24 小時統計
 * @param admin prismaAdmin
 * @param queueCounts 讀 comment-reply 佇列數量（失敗回 null）
 */
export async function getCommentReplyHealth(
  admin: PrismaClient,
  queueCounts: () => Promise<QueueCounts | null>,
  now: Date = new Date(),
): Promise<CommentReplyHealth> {
  const since = new Date(now.getTime() - DAY_MS);

  const [matched24h, byStatus, oldest, queue] = await Promise.all([
    admin.commentReplyLog.count({ where: { createdAt: { gte: since } } }),
    admin.commentReplyLog.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    admin.commentReplyLog.findFirst({
      where: { status: { in: ['PENDING', 'SENDING'] } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    queueCounts().catch(() => null),
  ]);
  const statusCount = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const sent24h = statusCount('SENT');
  const failed24h = statusCount('FAILED');

  const channels = await admin.channel.findMany({
    where: {
      channelType: { in: ['FB', 'THREADS'] },
      settings: { path: ['commentReply', 'receiving'], equals: true },
    },
    select: {
      id: true,
      tenantId: true,
      channelType: true,
      displayName: true,
      settings: true,
      credentialsEncrypted: true,
      tenant: { select: { name: true } },
    },
    orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
  });
  const ids = channels.map((c) => c.id);

  const [rules, logStats, failures] = ids.length
    ? await Promise.all([
        admin.commentReplyRule.groupBy({
          by: ['channelId'],
          where: { channelId: { in: ids }, isActive: true, deletedAt: null },
          _count: { _all: true },
        }),
        admin.commentReplyLog.groupBy({
          by: ['channelId', 'status'],
          where: { channelId: { in: ids }, createdAt: { gte: since } },
          _count: { _all: true },
        }),
        admin.commentReplyLog.groupBy({
          by: ['channelId', 'reasonCode'],
          where: { channelId: { in: ids }, createdAt: { gte: since }, status: 'FAILED' },
          _count: { _all: true },
        }),
      ])
    : [[], [], []];

  const countOf = (channelId: string, statuses: string[]) =>
    logStats.filter((r) => r.channelId === channelId && statuses.includes(r.status)).reduce((n, r) => n + r._count._all, 0);
  const topFailure = (channelId: string) => {
    const rows = failures.filter((r) => r.channelId === channelId && r.reasonCode);
    rows.sort((a, b) => b._count._all - a._count._all || String(a.reasonCode).localeCompare(String(b.reasonCode)));
    return rows[0]?.reasonCode ?? null;
  };

  return {
    summary: {
      matched24h,
      sent24h,
      failureRate24h: sent24h + failed24h > 0 ? failed24h / (sent24h + failed24h) : 0,
      queue,
      oldestPendingAt: oldest?.createdAt.toISOString() ?? null,
    },
    channels: channels.map((c) => {
      const settings = obj(c.settings);
      const cr = obj(settings.commentReply);
      const sub = obj(cr.subscription);
      return {
        tenantId: c.tenantId,
        tenantName: c.tenant?.name ?? null,
        channelId: c.id,
        channelType: c.channelType,
        displayName: c.displayName,
        appMode: c.channelType === 'FB' ? channelAppMode(c.credentialsEncrypted) : 'own_app',
        subscription: { status: typeof sub.status === 'string' ? sub.status : null, checkedAt: typeof sub.checkedAt === 'string' ? sub.checkedAt : null },
        tokenStatus: typeof obj(settings.tokenHealth).status === 'string' ? obj(settings.tokenHealth).status : null,
        lastCommentEventAt: typeof cr.lastCommentEventAt === 'string' ? cr.lastCommentEventAt : null,
        activeRules: rules.find((r) => r.channelId === c.id)?._count._all ?? 0,
        sent24h: countOf(c.id, ['SENT']),
        failed24h: countOf(c.id, ['FAILED']),
        pending24h: countOf(c.id, ['PENDING', 'SENDING']),
        topFailureReason: topFailure(c.id),
      };
    }),
  };
}
