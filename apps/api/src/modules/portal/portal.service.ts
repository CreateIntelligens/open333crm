/**
 * Portal activity service — CRUD, submissions, draw.
 *
 * 每個函式收呼叫端 flow 的 TenantCtx（#337 階段 3，AGENTS.md 結構規則 2）。
 * 送出活動的事件由 flow 寫進 outbox，見 portal.flow.ts。
 */

import type { PortalSubmission, Prisma } from '@prisma/client';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { addPointTransaction } from './points.service.js';
import { readActivitySettings } from './portal-settings.js';
import { AppError } from '../../shared/utils/response.js';

// ─── Activity CRUD ──────────────────────────────────────────────────────────

export async function listActivities(
  ctx: TenantCtx,
  filters: { type?: string; status?: string; page?: number; limit?: number },
) {
  const { tx: prisma, tenantId } = ctx;
  const where: Record<string, unknown> = { tenantId };
  if (filters.type) where.type = filters.type;
  if (filters.status) {
    where.status = filters.status;
  } else {
    // 預設不顯示已封存的活動；要看的話明確帶 status=ARCHIVED 查詢。
    // ENDED 活動原本無法刪除（只有 DRAFT 可刪），誤建的活動會永遠留在列表上。
    where.status = { not: 'ARCHIVED' };
  }

  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;

  // 同一個交易內依序查詢（交易用戶端不支援並行查詢）
  const items = await prisma.portalActivity.findMany({
    where,
    include: { _count: { select: { submissions: true } } },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await prisma.portalActivity.count({ where });

  return { items, total, page, limit };
}

export async function getActivity(ctx: TenantCtx, id: string) {
  return ctx.tx.portalActivity.findFirst({
    where: { id, tenantId: ctx.tenantId },
    include: {
      options: { orderBy: { sortOrder: 'asc' } },
      fields: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { submissions: true } },
    },
  });
}

export async function createActivity(
  ctx: TenantCtx,
  createdById: string,
  data: {
    type: string;
    title: string;
    description?: string;
    coverImage?: string;
    settings?: Record<string, unknown>;
    // routes 用 z.coerce.date() 驗完直接給 Date；null = 清除，undefined = 不動
    startsAt?: Date | null;
    endsAt?: Date | null;
    options?: Array<{ label: string; imageUrl?: string; sortOrder?: number; isCorrect?: boolean }>;
    fields?: Array<{ fieldKey: string; label: string; fieldType?: string; options?: unknown; isRequired?: boolean; sortOrder?: number }>;
  },
) {
  return ctx.tx.portalActivity.create({
    data: {
      tenantId: ctx.tenantId,
      createdById,
      type: data.type as 'POLL' | 'FORM' | 'QUIZ',
      title: data.title,
      description: data.description,
      coverImage: data.coverImage,
      settings: (data.settings ?? {}) as Prisma.InputJsonValue,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      options: data.options
        ? { create: data.options.map((o, i) => ({ label: o.label, imageUrl: o.imageUrl, sortOrder: o.sortOrder ?? i, isCorrect: o.isCorrect ?? false })) }
        : undefined,
      fields: data.fields
        ? { create: data.fields.map((f, i) => ({ fieldKey: f.fieldKey, label: f.label, fieldType: f.fieldType ?? 'text', options: (f.options ?? []) as Prisma.InputJsonValue, isRequired: f.isRequired ?? false, sortOrder: f.sortOrder ?? i })) }
        : undefined,
    },
    include: {
      options: { orderBy: { sortOrder: 'asc' } },
      fields: { orderBy: { sortOrder: 'asc' } },
    },
  });
}

/**
 * 鎖住活動列到交易結束，回傳鎖住之後的活動；活動不存在（或等鎖期間被刪除）時回 null。
 *
 * 改變活動狀態或內容的函式都先呼叫這支，再檢查狀態：只讀不鎖時，另一個交易可以在檢查之後、
 * 寫入之前改掉狀態，例如發布還沒 commit 時開始編輯，等發布 commit 後換掉已發布活動的選項。
 * 抽獎也鎖同一列，兩次同時抽獎依序執行，不會抽到同一批人。粉絲送出不鎖活動列，見 submitActivity。
 */
async function lockActivity(ctx: TenantCtx, id: string) {
  const { tx, tenantId } = ctx;
  // 先以 Prisma 查一次：id 格式不對時與其他查詢的錯誤相同，不會在原生 SQL 轉型時才失敗
  if (!(await tx.portalActivity.findFirst({ where: { id, tenantId }, select: { id: true } }))) return null;
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM portal_activities WHERE id = ${id}::uuid AND "tenantId" = ${tenantId}::uuid FOR UPDATE`;
  if (locked.length === 0) return null;
  // read committed：鎖住之後的查詢讀得到對方 commit 的狀態
  return tx.portalActivity.findFirst({ where: { id, tenantId } });
}

// 選項與欄位的刪除、重建和活動的更新在呼叫端 flow 的同一個交易內完成
export async function updateActivity(
  ctx: TenantCtx,
  id: string,
  data: {
    title?: string;
    description?: string;
    coverImage?: string;
    settings?: Record<string, unknown>;
    // routes 用 z.coerce.date() 驗完直接給 Date；null = 清除，undefined = 不動
    startsAt?: Date | null;
    endsAt?: Date | null;
    options?: Array<{ id?: string; label: string; imageUrl?: string; sortOrder?: number; isCorrect?: boolean }>;
    fields?: Array<{ id?: string; fieldKey: string; label: string; fieldType?: string; options?: unknown; isRequired?: boolean; sortOrder?: number }>;
  },
) {
  const { tx: prisma } = ctx;
  const activity = await lockActivity(ctx, id);
  if (!activity) return null;
  if (activity.status !== 'DRAFT') throw new AppError('僅草稿狀態的活動可以編輯', 'INVALID_ACTIVITY_STATUS', 409);

  // 起訖先後檢查必須在這裡做，不能只靠 routes 的 schema：
  // schema 只看得到這次送來的欄位，使用者若只改 endsAt，
  // 就無從跟 DB 既有的 startsAt 比對（實測確認會漏放）。
  // undefined = 這欄不動 → 沿用 DB 現值；null = 清除 → 該側不設限。
  const nextStartsAt = data.startsAt === undefined ? activity.startsAt : data.startsAt;
  const nextEndsAt = data.endsAt === undefined ? activity.endsAt : data.endsAt;
  if (nextStartsAt && nextEndsAt && nextEndsAt <= nextStartsAt) {
    throw new AppError('結束時間必須晚於開始時間', 'INVALID_DATE_RANGE', 400);
  }

  // Replace options and fields if provided
  if (data.options) {
    await prisma.portalOption.deleteMany({ where: { activityId: id } });
    await prisma.portalOption.createMany({
      data: data.options.map((o, i) => ({
        activityId: id,
        label: o.label,
        imageUrl: o.imageUrl,
        sortOrder: o.sortOrder ?? i,
        isCorrect: o.isCorrect ?? false,
      })),
    });
  }
  if (data.fields) {
    await prisma.portalField.deleteMany({ where: { activityId: id } });
    await prisma.portalField.createMany({
      data: data.fields.map((f, i) => ({
        activityId: id,
        fieldKey: f.fieldKey,
        label: f.label,
        fieldType: f.fieldType ?? 'text',
        options: (f.options ?? []) as Prisma.InputJsonValue,
        isRequired: f.isRequired ?? false,
        sortOrder: f.sortOrder ?? i,
      })),
    });
  }

  return prisma.portalActivity.update({
    where: { id },
    data: {
      title: data.title,
      description: data.description,
      coverImage: data.coverImage,
      settings: data.settings as Prisma.InputJsonValue | undefined,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
    },
    include: {
      options: { orderBy: { sortOrder: 'asc' } },
      fields: { orderBy: { sortOrder: 'asc' } },
    },
  });
}

export async function deleteActivity(ctx: TenantCtx, id: string) {
  const { tx: prisma } = ctx;
  const activity = await lockActivity(ctx, id);
  if (!activity) return null;
  if (activity.status !== 'DRAFT') throw new AppError('僅草稿狀態的活動可以刪除', 'INVALID_ACTIVITY_STATUS', 409);
  return prisma.portalActivity.delete({ where: { id } });
}

export async function publishActivity(ctx: TenantCtx, id: string) {
  const { tx: prisma } = ctx;
  const activity = await lockActivity(ctx, id);
  if (!activity) return null;
  if (activity.status !== 'DRAFT') throw new AppError('僅草稿狀態的活動可以發布', 'INVALID_ACTIVITY_STATUS', 409);
  return prisma.portalActivity.update({
    where: { id },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
  });
}

export async function endActivity(ctx: TenantCtx, id: string) {
  const { tx: prisma } = ctx;
  const activity = await lockActivity(ctx, id);
  if (!activity) return null;
  if (activity.status !== 'PUBLISHED') throw new AppError('僅已發布的活動可以結束', 'INVALID_ACTIVITY_STATUS', 409);
  return prisma.portalActivity.update({
    where: { id },
    data: { status: 'ENDED' },
  });
}

/**
 * 封存活動：把已結束（或草稿）的活動從列表收起來。
 *
 * 為什麼不是直接刪除：PortalSubmission 對 PortalActivity 是
 * onDelete: Cascade，硬刪會連帶清掉所有參與者的提交紀錄與積分依據。
 * 活動辦完了要「從列表消失」，不該以銷毀客戶資料為代價。
 *
 * 已發布中（PUBLISHED）的活動不可封存——那是還在進行的活動，
 * 要先按「結束」。
 */
export async function archiveActivity(ctx: TenantCtx, id: string) {
  const { tx: prisma } = ctx;
  const activity = await lockActivity(ctx, id);
  if (!activity) return null;
  if (activity.status === 'PUBLISHED') {
    throw new AppError('進行中的活動請先結束再封存', 'INVALID_ACTIVITY_STATUS', 409);
  }
  if (activity.status === 'ARCHIVED') {
    throw new AppError('此活動已封存', 'INVALID_ACTIVITY_STATUS', 409);
  }
  return prisma.portalActivity.update({
    where: { id },
    data: { status: 'ARCHIVED' },
  });
}

/** 取消封存：把活動放回列表（回到 ENDED） */
export async function unarchiveActivity(ctx: TenantCtx, id: string) {
  const { tx: prisma } = ctx;
  const activity = await lockActivity(ctx, id);
  if (!activity) return null;
  if (activity.status !== 'ARCHIVED') {
    throw new AppError('此活動未封存', 'INVALID_ACTIVITY_STATUS', 409);
  }
  return prisma.portalActivity.update({
    where: { id },
    data: { status: 'ENDED' },
  });
}

// ─── Submissions ────────────────────────────────────────────────────────────

export async function listSubmissions(
  ctx: TenantCtx,
  activityId: string,
  page = 1,
  limit = 20,
) {
  const { tx: prisma, tenantId } = ctx;
  const items = await prisma.portalSubmission.findMany({
    where: { activityId, tenantId },
    include: { contact: { select: { id: true, displayName: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await prisma.portalSubmission.count({ where: { activityId, tenantId } });

  return { items, total, page, limit };
}

/** 送出活動的結果：flow 依 activityType 組 portal.activity.submitted 事件 */
export interface SubmittedActivity {
  submission: PortalSubmission;
  activityType: string;
}

export async function submitActivity(
  ctx: TenantCtx,
  activityId: string,
  contactId: string,
  answers: { optionIds?: string[]; fields?: Record<string, string> },
): Promise<SubmittedActivity> {
  const { tx: prisma, tenantId } = ctx;
  const activity = await prisma.portalActivity.findFirst({
    where: { id: activityId, tenantId, status: 'PUBLISHED' },
    include: { options: true },
  });
  if (!activity) throw new AppError('活動不存在或尚未開放', 'ACTIVITY_NOT_AVAILABLE', 404);

  // Check time range
  const now = new Date();
  if (activity.startsAt && now < activity.startsAt) throw new AppError('活動尚未開始，請於開始後再試', 'ACTIVITY_NOT_STARTED', 409);
  if (activity.endsAt && now > activity.endsAt) throw new AppError('活動已結束', 'ACTIVITY_ENDED', 409);

  // Check duplicate submission
  // 設定不合法時採用安全的預設值：不允許重複參加、不給積分（portal-settings.ts）
  const { allowMultiple, pointsPerSubmit } = readActivitySettings(activity.settings);
  if (!allowMultiple) {
    // 先鎖「活動＋聯絡人」再查：同一位粉絲同時送出時，後一次等前一次 commit 後才查得到它的作答。
    // 不鎖活動列，否則所有粉絲的送出都要排隊。
    // 鎖鍵是字串，uuid 的大小寫不同就是另一把鎖：活動 id 用資料庫回傳的值，聯絡人 id 轉成小寫
    await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`portal-submit:${activity.id}:${contactId.toLowerCase()}`}, 0))`;
    const existing = await prisma.portalSubmission.findFirst({
      where: { activityId, contactId },
    });
    if (existing) throw new AppError('您已參加過這個活動', 'ALREADY_SUBMITTED', 409);
  }

  // Calculate score for QUIZ
  let score: number | undefined;
  if (activity.type === 'QUIZ' && answers.optionIds) {
    const correctIds = new Set(activity.options.filter((o) => o.isCorrect).map((o) => o.id));
    score = answers.optionIds.filter((id) => correctIds.has(id)).length;
  }

  const submission = await prisma.portalSubmission.create({
    data: {
      activityId,
      contactId,
      tenantId,
      answers: answers as unknown as Prisma.InputJsonValue,
      score,
      pointsEarned: pointsPerSubmit,
    },
  });

  // Add points if configured
  if (pointsPerSubmit > 0) {
    await addPointTransaction(ctx, {
      contactId,
      amount: pointsPerSubmit,
      type: 'activity_submit',
      refId: submission.id,
      note: `參加活動「${activity.title}」`,
    });
  }

  return { submission, activityType: activity.type };
}

// ─── Draw (random winners) ──────────────────────────────────────────────────

export async function drawWinners(
  ctx: TenantCtx,
  activityId: string,
  count: number,
) {
  const { tx: prisma, tenantId } = ctx;
  // 鎖住活動到交易結束：同時抽獎時，後一次等前一次 commit 後才讀未中獎名單
  if (!(await lockActivity(ctx, activityId))) return [];
  // Get all non-winner submissions
  const eligible = await prisma.portalSubmission.findMany({
    where: { activityId, tenantId, isWinner: false },
    select: { id: true },
  });

  if (eligible.length === 0) return [];

  // Shuffle and pick
  const shuffled = eligible.sort(() => Math.random() - 0.5);
  const winners = shuffled.slice(0, Math.min(count, shuffled.length));
  const winnerIds = winners.map((w) => w.id);

  await prisma.portalSubmission.updateMany({
    where: { id: { in: winnerIds } },
    data: { isWinner: true },
  });

  return prisma.portalSubmission.findMany({
    where: { id: { in: winnerIds } },
    include: { contact: { select: { id: true, displayName: true } } },
  });
}

// ─── Fan portal (public) ────────────────────────────────────────────────────

/** 粉絲看得到的選項欄位：不含 isCorrect（測驗的正確答案） */
const fanOptionSelect = { id: true, label: true, imageUrl: true, sortOrder: true } as const;

/** 粉絲門戶的活動列表：已發布、已開始、還沒結束 */
export async function listOpenActivitiesForFan(ctx: TenantCtx) {
  const now = new Date();
  const activities = await ctx.tx.portalActivity.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: 'PUBLISHED',
      OR: [
        { startsAt: null },
        { startsAt: { lte: now } },
      ],
    },
    include: {
      _count: { select: { submissions: true } },
      options: { orderBy: { sortOrder: 'asc' }, select: fanOptionSelect },
      fields: { orderBy: { sortOrder: 'asc' } },
    },
    orderBy: { publishedAt: 'desc' },
  });

  // Filter out activities that have ended
  return activities.filter((a) => !a.endsAt || a.endsAt > now);
}

/** 粉絲門戶的活動詳情，附上這位粉絲自己的作答；活動不存在或沒有發布時回 null */
export async function getActivityForFan(ctx: TenantCtx, id: string, contactId: string) {
  const { tx: prisma, tenantId } = ctx;
  const activity = await prisma.portalActivity.findFirst({
    where: { id, tenantId, status: 'PUBLISHED' },
    include: {
      options: { orderBy: { sortOrder: 'asc' }, select: fanOptionSelect },
      fields: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { submissions: true } },
    },
  });
  if (!activity) return null;
  // Check if fan has already submitted
  const mySubmission = await prisma.portalSubmission.findFirst({
    where: { activityId: id, contactId, tenantId },
  });
  return { ...activity, mySubmission };
}

/** 粉絲自己參加過的活動 */
export async function listContactSubmissions(ctx: TenantCtx, contactId: string) {
  return ctx.tx.portalSubmission.findMany({
    where: { contactId, tenantId: ctx.tenantId },
    include: { activity: { select: { id: true, title: true, type: true, status: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

// ─── Activity result stats (public) ─────────────────────────────────────────

export async function getActivityResult(ctx: TenantCtx, activityId: string) {
  // 本函式的唯一呼叫端是公開的粉絲門戶。flow 以 fanToken 的租戶開交易，
  // 查詢條件仍明確限定租戶，不只倚賴 RLS。
  const { tx: prisma, tenantId } = ctx;
  // 已知問題（AUDIT PORTAL-01）：回傳測驗選項的 isCorrect，也不看活動狀態。
  const activity = await prisma.portalActivity.findFirst({
    where: { id: activityId, tenantId },
    include: { options: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!activity) return null;

  const submissions = await prisma.portalSubmission.findMany({
    where: { activityId, tenantId },
    select: { answers: true, score: true },
  });

  // Count votes per option (for POLL/QUIZ)
  const optionCounts: Record<string, number> = {};
  for (const opt of activity.options) {
    optionCounts[opt.id] = 0;
  }
  for (const sub of submissions) {
    const ans = sub.answers as Record<string, unknown>;
    const optionIds = (ans.optionIds as string[]) ?? [];
    for (const oid of optionIds) {
      if (optionCounts[oid] !== undefined) optionCounts[oid]++;
    }
  }

  return {
    activityId,
    type: activity.type,
    totalSubmissions: submissions.length,
    options: activity.options.map((o) => ({
      id: o.id,
      label: o.label,
      votes: optionCounts[o.id] ?? 0,
      isCorrect: o.isCorrect,
    })),
    averageScore: activity.type === 'QUIZ' && submissions.length > 0
      ? submissions.reduce((sum, s) => sum + (s.score ?? 0), 0) / submissions.length
      : undefined,
  };
}
