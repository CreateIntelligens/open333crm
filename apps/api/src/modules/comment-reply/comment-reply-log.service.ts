/**
 * 觸發紀錄的查詢與手動重試（change add-comment-keyword-private-reply design「API」；
 * spec comment-private-reply「觸發紀錄的查詢」「紀錄詳情的對話連結依權限顯示」「手動重試」）。
 *
 * 只含檢視者看得到的渠道；看不到或其他租戶的紀錄回 404 LOG_NOT_FOUND。
 * 重試只把紀錄改回 PENDING；排入工作（outbox）與稽核在 comment-reply.flow.ts。
 */
import type { CommentReplyLog, Prisma } from '@prisma/client';
import { isCommentReplyRetryable } from '@open333crm/shared';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { AppError } from '../../shared/utils/response.js';
import { escapeLikeKeyword } from '../../shared/utils/like-pattern.js';
import { canEditChannel, channelIdFilter, channelLevel, resolveViewerChannels, type CommentReplyViewer } from './comment-reply-access.js';
import { isCommentReplyWindowExpired } from './comment-reply-expiry.js';
import type { LogsQuery } from './comment-reply.schemas.js';

const LOG_NOT_FOUND = () => new AppError('找不到這筆觸發紀錄', 'LOG_NOT_FOUND', 404);
const TERMINAL = new Set(['SENT', 'FAILED', 'EXPIRED', 'SKIPPED', 'SKIPPED_DUPLICATE']);
const DAY_MS = 24 * 60 * 60 * 1000;

const logInclude = {
  rule: { select: { id: true, name: true, deletedAt: true, postSnapshots: true } },
  channel: { select: { id: true, channelType: true, displayName: true } },
} as const;
type LogRow = Prisma.CommentReplyLogGetPayload<{ include: typeof logInclude }>;

export interface LogItem {
  id: string;
  status: string;
  reasonCode: string | null;
  reasonMessage: string | null;
  commentId: string;
  commentText: string | null;
  commentCreatedAt: string;
  isReplyToComment: boolean;
  commenterName: string | null;
  commenterUsername: string | null;
  post: { postId: string; permalink: string | null; thumbnailUrl: string | null; excerpt: string | null };
  rule: { id: string; name: string; deleted: boolean };
  channel: { id: string; channelType: string; displayName: string };
  receivedAt: string;
  processedAt: string | null;
  matchedKeywords: string[];
  customerReplied: boolean;
  customerRepliedAt: string | null;
  sentAt: string | null;
  publicReplyStatus: string;
  retryable: boolean;
  holderLogId: string | null;
}

export interface LogDetail extends LogItem {
  conversationId?: string;
  sentContentSnapshot: unknown;
  publicReplyText: string | null;
  publicReplyReasonCode: string | null;
  metaErrorCode: number | null;
  metaErrorSubcode: number | null;
  commentPermalink: string | null;
}

/** 可手動重試：可重試的原因，且留言未滿 7 天減 10 分鐘（design D14） */
export function logRetryable(log: Pick<CommentReplyLog, 'status' | 'reasonCode' | 'commentCreatedAt'>, now: Date): boolean {
  return isCommentReplyRetryable(log.status, log.reasonCode) && !isCommentReplyWindowExpired(log.commentCreatedAt, now);
}

function postOf(log: LogRow): LogItem['post'] {
  const snaps = Array.isArray(log.rule.postSnapshots) ? (log.rule.postSnapshots as Array<Record<string, unknown>>) : [];
  const snap = snaps.find((s) => s && s.postId === log.postId);
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return { postId: log.postId, permalink: str(snap?.permalink), thumbnailUrl: str(snap?.thumbnailUrl), excerpt: str(snap?.excerpt) };
}

function toItem(log: LogRow, now: Date): LogItem {
  return {
    id: log.id,
    status: log.status,
    reasonCode: log.reasonCode,
    reasonMessage: log.reasonMessage,
    commentId: log.commentId,
    commentText: log.commentText,
    commentCreatedAt: log.commentCreatedAt.toISOString(),
    isReplyToComment: Boolean(log.parentCommentId),
    commenterName: log.commenterName,
    commenterUsername: log.commenterUsername,
    post: postOf(log),
    rule: { id: log.rule.id, name: log.rule.name, deleted: log.rule.deletedAt !== null },
    channel: { id: log.channel.id, channelType: log.channel.channelType, displayName: log.channel.displayName },
    receivedAt: log.receivedAt.toISOString(),
    processedAt: TERMINAL.has(log.status) ? log.updatedAt.toISOString() : null,
    matchedKeywords: log.matchedKeywords,
    customerReplied: log.customerRepliedAt !== null || log.conversationId !== null,
    customerRepliedAt: log.customerRepliedAt?.toISOString() ?? null,
    sentAt: log.sentAt?.toISOString() ?? null,
    publicReplyStatus: log.publicReplyStatus,
    retryable: logRetryable(log, now),
    holderLogId: log.holderLogId,
  };
}

// ─── cursor：依建立時間與 id 由新到舊，同一毫秒的紀錄也不重複、不遺漏 ─────────────

function encodeCursor(log: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ c: log.createdAt.toISOString(), i: log.id })).toString('base64url');
}

function decodeCursor(cursor: string): { c: Date; i: string } {
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { c?: string; i?: string };
    const c = new Date(String(raw.c));
    if (Number.isNaN(c.getTime()) || typeof raw.i !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw.i)) throw new Error('bad');
    return { c, i: raw.i };
  } catch {
    throw new AppError('分頁參數不正確，請重新整理', 'VALIDATION_ERROR', 400, { field: 'cursor' });
  }
}

/** 篩選條件（不含 cursor）；includeStatus=false 時不套狀態（摘要的各狀態筆數） */
function buildWhere(
  ctx: TenantCtx,
  visible: { in: string[] } | undefined,
  q: LogsQuery,
  opts: { includeStatus?: boolean } = {},
): Prisma.CommentReplyLogWhereInput {
  const and: Prisma.CommentReplyLogWhereInput[] = [{ tenantId: ctx.tenantId }];
  if (visible) and.push({ channelId: visible });
  if (q.channelId) and.push({ channelId: q.channelId });
  if (q.ruleId) and.push({ ruleId: q.ruleId });
  if (opts.includeStatus !== false && q.status?.length) and.push({ status: { in: q.status } });
  if (q.from || q.to) and.push({ createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } });
  if (q.since) and.push({ createdAt: { gt: q.since } });
  if (q.q) {
    const kw = escapeLikeKeyword(q.q);
    and.push({
      OR: [
        { commenterName: { contains: kw, mode: 'insensitive' } },
        { commenterUsername: { contains: kw, mode: 'insensitive' } },
        { commentText: { contains: kw, mode: 'insensitive' } },
      ],
    });
  }
  return { AND: and };
}

/** GET /logs：`{ items, nextCursor }`；countOnly 時回 `{ count }`（since 之後的新紀錄數） */
export async function listLogs(
  ctx: TenantCtx,
  viewer: CommentReplyViewer,
  q: LogsQuery,
  now: Date = new Date(),
): Promise<{ items: LogItem[]; nextCursor: string | null } | { count: number }> {
  const channels = await resolveViewerChannels(ctx, viewer);
  const where = buildWhere(ctx, channelIdFilter(channels), q);
  if (q.countOnly) return { count: await ctx.tx.commentReplyLog.count({ where }) };

  const and = [where];
  if (q.cursor) {
    const { c, i } = decodeCursor(q.cursor);
    and.push({ OR: [{ createdAt: { lt: c } }, { createdAt: c, id: { lt: i } }] });
  }
  const rows = await ctx.tx.commentReplyLog.findMany({
    where: { AND: and },
    include: logInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  });
  const page = rows.slice(0, q.limit);
  return {
    items: page.map((r) => toItem(r, now)),
    nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1]) : null,
  };
}

/** GET /logs/summary：各狀態筆數（套用狀態以外的篩選）＋近 24 小時失敗數 */
export async function summarizeLogs(
  ctx: TenantCtx,
  viewer: CommentReplyViewer,
  q: LogsQuery,
  now: Date = new Date(),
): Promise<{ counts: Record<string, number>; failed24h: number }> {
  const channels = await resolveViewerChannels(ctx, viewer);
  const visible = channelIdFilter(channels);
  const [groups, failed24h] = await Promise.all([
    ctx.tx.commentReplyLog.groupBy({ by: ['status'], where: buildWhere(ctx, visible, q, { includeStatus: false }), _count: { _all: true } }),
    ctx.tx.commentReplyLog.count({
      where: { AND: [buildWhere(ctx, visible, { ...q, status: undefined, from: undefined, to: undefined, since: undefined }), { status: 'FAILED', createdAt: { gte: new Date(now.getTime() - DAY_MS) } }] },
    }),
  ]);
  return { counts: Object.fromEntries(groups.map((g) => [g.status, g._count._all])), failed24h };
}

/** GET /logs/:id：conversationId 只在檢視者有 inbox.view 且看得到渠道時回傳 */
export async function getLog(ctx: TenantCtx, viewer: CommentReplyViewer, id: string, now: Date = new Date()): Promise<LogDetail> {
  const channels = await resolveViewerChannels(ctx, viewer);
  const log = await ctx.tx.commentReplyLog.findFirst({ where: { id, tenantId: ctx.tenantId }, include: logInclude });
  if (!log || channelLevel(channels, log.channelId) === null) throw LOG_NOT_FOUND();
  return {
    ...toItem(log, now),
    ...(viewer.canViewInbox && log.conversationId ? { conversationId: log.conversationId } : {}),
    sentContentSnapshot: log.sentContentSnapshot,
    publicReplyText: log.publicReplyText,
    publicReplyReasonCode: log.publicReplyReasonCode,
    metaErrorCode: log.metaErrorCode,
    metaErrorSubcode: log.metaErrorSubcode,
    commentPermalink: null,
  };
}

export type RetryRejectReason = 'NOT_FAILED' | 'NOT_RETRYABLE' | 'EXPIRED';

/**
 * POST /logs/:id/retry 的資料變更：可重試的 FAILED，或原因 PLAN_QUOTA_EXCEEDED 的 SKIPPED，留言未過期 → 改回 PENDING。
 * 以條件更新（狀態與原因未變）避免兩個請求同時重試；排入工作由 flow 在同一交易寫 outbox。
 */
export async function markLogForRetry(
  ctx: TenantCtx,
  viewer: CommentReplyViewer,
  id: string,
  now: Date = new Date(),
): Promise<{ id: string; channelId: string; previousStatus: string; previousReasonCode: string | null }> {
  const channels = await resolveViewerChannels(ctx, viewer);
  const log = await ctx.tx.commentReplyLog.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { id: true, channelId: true, status: true, reasonCode: true, commentCreatedAt: true },
  });
  if (!log || channelLevel(channels, log.channelId) === null) throw LOG_NOT_FOUND();
  if (!canEditChannel(channels, viewer, log.channelId)) {
    throw new AppError('你對這個渠道只有檢視權限，無法重試', 'CHANNEL_ACCESS_DENIED', 403);
  }
  const reject = (reason: RetryRejectReason, message: string) => new AppError(message, 'RETRY_NOT_ALLOWED', 409, { reason });
  if (log.status !== 'FAILED' && log.status !== 'SKIPPED') throw reject('NOT_FAILED', '這筆紀錄不是失敗狀態，不需要重試');
  if (!isCommentReplyRetryable(log.status, log.reasonCode)) throw reject('NOT_RETRYABLE', '這個原因重試也不會成功');
  if (isCommentReplyWindowExpired(log.commentCreatedAt, now)) throw reject('EXPIRED', '留言已超過 7 天，Meta 不允許私訊');

  const updated = await ctx.tx.commentReplyLog.updateMany({
    where: { id: log.id, tenantId: ctx.tenantId, status: log.status, reasonCode: log.reasonCode },
    data: {
      status: 'PENDING',
      reasonCode: null,
      reasonMessage: null,
      metaErrorCode: null,
      metaErrorSubcode: null,
      metaTraceId: null,
      metaRateLimitHits: 0,
      nextAttemptAt: null,
      sendAttemptedAt: null,
    },
  });
  if (updated.count === 0) throw reject('NOT_FAILED', '這筆紀錄的狀態已變更，請重新整理');
  return { id: log.id, channelId: log.channelId, previousStatus: log.status, previousReasonCode: log.reasonCode };
}
