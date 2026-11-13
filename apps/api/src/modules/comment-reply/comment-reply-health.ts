/**
 * 留言自動私訊的健康排程（change add-comment-keyword-private-reply design D25）。
 *
 * 每 5 分鐘以 prismaAdmin 唯讀統計，依門檻發 ops-alert（合併鍵見下），並在需要時通知租戶管理員：
 * - comment-reply-auth:<channelId>：15 分鐘內 TOKEN_EXPIRED／PERMISSION_MISSING ≥ 3（另通知租戶管理員）
 * - comment-reply-failure-rate:<channelId>：15 分鐘內失敗 ≥ 20 且 > 50%，排除使用者端原因
 * - comment-reply-stuck：非排隊中的 PENDING 超過 30 分鐘（限流排隊是 Meta 的正常行為，不告警）
 * - comment-reply-expiring：PENDING 的留言時間超過 6 天
 * - comment-reply-subscription:<channelId>：開了接收、有啟用規則，但訂閱缺 feed／comments（另通知租戶）
 * - meta-webhook-signature：5 分鐘驗簽失敗 ≥ 50
 * 也把 Redis 的 `cr:last-event:<channelId>` 在值變動時同步到 settings.commentReply.lastCommentEventAt。
 *
 * evaluateCommentReplyHealth() 是純函式（單元測試），runCommentReplyHealth() 負責讀資料與送出。
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Server as SocketIOServer } from 'socket.io';
import { logger } from '@open333crm/core';
import type { OpsAlert } from '../ops-alert/ops-alert.service.js';
import { lastCommentEventKey } from './comment-reply-intake.flow.js';
import { signatureFailureKey, SIGNATURE_FAILURE_BUCKET_MS } from '../webhook/webhook-signature-failures.js';

export const HEALTH_WINDOW_MS = 15 * 60_000;
export const AUTH_FAILURE_THRESHOLD = 3;
export const FAILURE_RATE_MIN_FAILED = 20;
export const FAILURE_RATE_THRESHOLD = 0.5;
export const STUCK_PENDING_MS = 30 * 60_000;
export const EXPIRING_PENDING_MS = 6 * 86_400_000;
export const SIGNATURE_FAILURE_THRESHOLD = 50;

/** 使用者端原因：顧客封鎖、刪留言、對象是粉專、已在別處私訊過——不是系統壞了，不算進失敗率 */
export const USER_SIDE_REASONS: readonly string[] = ['USER_UNAVAILABLE', 'COMMENT_NOT_FOUND', 'RECIPIENT_IS_PAGE', 'ALREADY_REPLIED'];
const AUTH_REASONS = ['TOKEN_EXPIRED', 'PERMISSION_MISSING'];

export interface ChannelRef {
  channelId: string;
  tenantId: string;
  displayName?: string;
}

export interface HealthSnapshot {
  /** 15 分鐘內每個渠道的 FAILED 依原因計數、SENT 數 */
  channelStats: Array<ChannelRef & { sent: number; failedByReason: Record<string, number> }>;
  /** 非排隊中、超過 30 分鐘的 PENDING 筆數 */
  stuckPending: number;
  /** 留言時間超過 6 天的 PENDING 筆數 */
  expiringPending: number;
  /** 開了接收、有啟用規則，但訂閱缺留言欄位的渠道 */
  subscriptionMissing: ChannelRef[];
  /** 最近 5 分鐘的驗簽失敗次數 */
  signatureFailures: number;
}

export interface HealthAlert extends OpsAlert {
  /** 另外通知該租戶的管理員 */
  notifyTenant?: { tenantId: string; title: string; body: string };
}

export function evaluateCommentReplyHealth(s: HealthSnapshot): HealthAlert[] {
  const alerts: HealthAlert[] = [];
  for (const ch of s.channelStats) {
    const auth = AUTH_REASONS.reduce((n, r) => n + (ch.failedByReason[r] ?? 0), 0);
    if (auth >= AUTH_FAILURE_THRESHOLD) {
      alerts.push({
        key: `comment-reply-auth:${ch.channelId}`,
        title: '留言自動私訊：渠道權杖或權限連續失效',
        fields: { tenantId: ch.tenantId, channelId: ch.channelId, count15m: auth },
        notifyTenant: {
          tenantId: ch.tenantId,
          title: `渠道「${ch.displayName ?? ch.channelId}」的留言自動私訊無法送出`,
          body: '粉專連結已失效或授權不足，留言私訊會一直失敗。請到渠道管理重新連結，之後可在觸發紀錄重試。',
        },
      });
    }
    const failed = Object.entries(ch.failedByReason)
      .filter(([reason]) => !USER_SIDE_REASONS.includes(reason))
      .reduce((n, [, c]) => n + c, 0);
    const total = failed + ch.sent;
    if (failed >= FAILURE_RATE_MIN_FAILED && total > 0 && failed / total > FAILURE_RATE_THRESHOLD) {
      alerts.push({
        key: `comment-reply-failure-rate:${ch.channelId}`,
        title: '留言自動私訊：失敗率過高',
        fields: { tenantId: ch.tenantId, channelId: ch.channelId, failed15m: failed, total15m: total },
      });
    }
  }
  if (s.stuckPending > 0) {
    alerts.push({ key: 'comment-reply-stuck', title: '留言自動私訊：處理中的紀錄卡住超過 30 分鐘', fields: { count: s.stuckPending } });
  }
  if (s.expiringPending > 0) {
    alerts.push({ key: 'comment-reply-expiring', title: '留言自動私訊：有紀錄排隊超過 6 天，即將過期', fields: { count: s.expiringPending } });
  }
  for (const ch of s.subscriptionMissing) {
    alerts.push({
      key: `comment-reply-subscription:${ch.channelId}`,
      title: '留言自動私訊：粉專的留言訂閱不見了',
      fields: { tenantId: ch.tenantId, channelId: ch.channelId },
      notifyTenant: {
        tenantId: ch.tenantId,
        title: `渠道「${ch.displayName ?? ch.channelId}」收不到留言`,
        body: 'Meta 上的留言訂閱已被取消，留言不會觸發自動私訊。請到「留言自動私訊」重新開啟留言接收。',
      },
    });
  }
  if (s.signatureFailures >= SIGNATURE_FAILURE_THRESHOLD) {
    alerts.push({ key: 'meta-webhook-signature', title: 'Meta webhook 驗簽失敗次數過多', fields: { count5m: s.signatureFailures } });
  }
  return alerts;
}

export interface HealthDeps {
  admin: PrismaClient;
  redis: Pick<Redis, 'get'>;
  sendAlert: (alert: OpsAlert) => Promise<unknown>;
  notifyTenantAdmins?: (tenantId: string, title: string, body: string) => Promise<void>;
  now?: () => Date;
}

/** 讀出健康快照（跨租戶唯讀） */
export async function collectHealthSnapshot(deps: Pick<HealthDeps, 'admin' | 'redis' | 'now'>): Promise<HealthSnapshot> {
  const now = deps.now?.() ?? new Date();
  const since = new Date(now.getTime() - HEALTH_WINDOW_MS);
  const rows = await deps.admin.$queryRaw<Array<{ channelId: string; tenantId: string; status: string; reasonCode: string | null; n: bigint }>>`
    SELECT "channelId", "tenantId", status::text AS status, "reasonCode", count(*) AS n
    FROM comment_reply_logs
    WHERE "updatedAt" >= ${since} AND status IN ('SENT', 'FAILED')
    GROUP BY 1, 2, 3, 4`;
  const byChannel = new Map<string, HealthSnapshot['channelStats'][number]>();
  for (const r of rows) {
    const ch = byChannel.get(r.channelId) ?? { channelId: r.channelId, tenantId: r.tenantId, sent: 0, failedByReason: {} };
    if (r.status === 'SENT') ch.sent += Number(r.n);
    else ch.failedByReason[r.reasonCode ?? 'UNKNOWN'] = (ch.failedByReason[r.reasonCode ?? 'UNKNOWN'] ?? 0) + Number(r.n);
    byChannel.set(r.channelId, ch);
  }
  if (byChannel.size > 0) {
    const names = await deps.admin.channel.findMany({ where: { id: { in: [...byChannel.keys()] } }, select: { id: true, displayName: true } });
    for (const n of names) byChannel.get(n.id)!.displayName = n.displayName;
  }

  const stuckBefore = new Date(now.getTime() - STUCK_PENDING_MS);
  const [{ n: stuck }] = await deps.admin.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM comment_reply_logs
    WHERE status = 'PENDING' AND "reasonCode" IS DISTINCT FROM 'RATE_LIMIT_QUEUED' AND "updatedAt" < ${stuckBefore}`;
  const expiringBefore = new Date(now.getTime() - EXPIRING_PENDING_MS);
  const [{ n: expiring }] = await deps.admin.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM comment_reply_logs WHERE status = 'PENDING' AND "commentCreatedAt" < ${expiringBefore}`;

  const receiving = await receivingChannels(deps.admin);
  const subscriptionMissing: ChannelRef[] = [];
  for (const ch of receiving) {
    const cr = commentReplySettings(ch.settings);
    if (cr.subscription?.status !== 'missing') continue;
    const hasRule = await deps.admin.commentReplyRule.count({ where: { tenantId: ch.tenantId, channelId: ch.id, isActive: true, deletedAt: null } });
    if (hasRule > 0) subscriptionMissing.push({ channelId: ch.id, tenantId: ch.tenantId, displayName: ch.displayName });
  }

  let signatureFailures = 0;
  try {
    const t = now.getTime();
    const [cur, prev] = await Promise.all([deps.redis.get(signatureFailureKey(t)), deps.redis.get(signatureFailureKey(t - SIGNATURE_FAILURE_BUCKET_MS))]);
    signatureFailures = Math.max(Number(cur ?? 0), Number(prev ?? 0));
  } catch {
    signatureFailures = 0;
  }

  return { channelStats: [...byChannel.values()], stuckPending: Number(stuck), expiringPending: Number(expiring), subscriptionMissing, signatureFailures };
}

interface CommentReplyChannelSettings {
  receiving?: boolean;
  lastCommentEventAt?: string;
  subscription?: { status?: string };
}

export function commentReplySettings(settings: unknown): CommentReplyChannelSettings {
  const s = (settings ?? {}) as Record<string, unknown>;
  const cr = s.commentReply;
  return cr && typeof cr === 'object' ? (cr as CommentReplyChannelSettings) : {};
}

async function receivingChannels(admin: PrismaClient) {
  return admin.channel.findMany({
    where: { isActive: true, settings: { path: ['commentReply', 'receiving'], equals: true } },
    select: { id: true, tenantId: true, displayName: true, settings: true },
  });
}

/** Redis 的最後留言事件時間 → settings.commentReply.lastCommentEventAt（只在值變動時寫入） */
export async function syncLastCommentEventAt(deps: Pick<HealthDeps, 'admin' | 'redis'>): Promise<number> {
  let updated = 0;
  for (const ch of await receivingChannels(deps.admin)) {
    const raw = await deps.redis.get(lastCommentEventKey(ch.id)).catch(() => null);
    if (!raw) continue;
    const iso = new Date(Number(raw)).toISOString();
    if (commentReplySettings(ch.settings).lastCommentEventAt === iso) continue;
    await deps.admin.$executeRaw`
      UPDATE channels
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{commentReply,lastCommentEventAt}', to_jsonb(${iso}::text), true)
      WHERE id = ${ch.id}::uuid AND "tenantId" = ${ch.tenantId}::uuid AND settings ? 'commentReply'`;
    updated += 1;
  }
  return updated;
}

export async function runCommentReplyHealth(deps: HealthDeps): Promise<HealthAlert[]> {
  await syncLastCommentEventAt(deps).catch((err: unknown) =>
    logger.error('[comment-reply-health] 同步最後留言時間失敗', { error: err instanceof Error ? err.message : String(err) }),
  );
  const alerts = evaluateCommentReplyHealth(await collectHealthSnapshot(deps));
  for (const alert of alerts) {
    const { notifyTenant, ...opsAlert } = alert;
    const sent = await deps.sendAlert(opsAlert).catch((err: unknown) => {
      logger.error('[comment-reply-health] 告警送出失敗', { key: alert.key, error: err instanceof Error ? err.message : String(err) });
      return false;
    });
    // 租戶通知跟著 ops-alert 的合併（10 分鐘內同一個鍵只通知一次）
    if (notifyTenant && sent && deps.notifyTenantAdmins) {
      await deps.notifyTenantAdmins(notifyTenant.tenantId, notifyTenant.title, notifyTenant.body).catch((err: unknown) =>
        logger.error('[comment-reply-health] 通知租戶管理員失敗', { tenantId: notifyTenant.tenantId, error: String(err) }),
      );
    }
  }
  return alerts;
}

/** 租戶管理員的站內通知（admin 連線，排程在白名單） */
export function tenantAdminNotifier(
  admin: PrismaClient,
  io: SocketIOServer,
  createAndDispatch: (prisma: PrismaClient, io: SocketIOServer, input: { tenantId: string; agentId: string; type: string; title: string; body: string; clickUrl?: string }) => Promise<unknown>,
) {
  return async (tenantId: string, title: string, body: string) => {
    const admins = await admin.agent.findMany({ where: { tenantId, role: 'ADMIN', isActive: true }, select: { id: true } });
    for (const a of admins) {
      await createAndDispatch(admin, io, { tenantId, agentId: a.id, type: 'comment_reply_alert', title, body, clickUrl: '/dashboard/comment-replies' });
    }
  };
}
