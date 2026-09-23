/**
 * Portal activity service — CRUD, submissions, draw.
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { eventBus } from '../../events/event-bus.js';
import { addPointTransaction } from './points.service.js';
import { AppError } from '../../shared/utils/response.js';

// ─── Activity CRUD ──────────────────────────────────────────────────────────

export async function listActivities(
  prisma: TenantDb,
  tenantId: string,
  filters: { type?: string; status?: string; page?: number; limit?: number },
) {
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

  const [items, total] = await Promise.all([
    prisma.portalActivity.findMany({
      where,
      include: { _count: { select: { submissions: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.portalActivity.count({ where }),
  ]);

  return { items, total, page, limit };
}

export async function getActivity(prisma: TenantDb, id: string, tenantId: string) {
  return prisma.portalActivity.findFirst({
    where: { id, tenantId },
    include: {
      options: { orderBy: { sortOrder: 'asc' } },
      fields: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { submissions: true } },
    },
  });
}

export async function createActivity(
  prisma: TenantDb,
  tenantId: string,
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
  return prisma.portalActivity.create({
    data: {
      tenantId,
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

// ⚠️ 呼叫端須先用 withTenant(fastify.prisma, tenantId, tx => updateActivity(tx, ...)) 開好
// 綁定 RLS 的交易，本函式在該 tx 內直接操作（不可再自開 $transaction，交易不可巢狀）。
export async function updateActivity(
  prisma: TenantDb,
  id: string,
  tenantId: string,
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
  const activity = await prisma.portalActivity.findFirst({ where: { id, tenantId } });
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

export async function deleteActivity(prisma: TenantDb, id: string, tenantId: string) {
  const activity = await prisma.portalActivity.findFirst({ where: { id, tenantId } });
  if (!activity) return null;
  if (activity.status !== 'DRAFT') throw new AppError('僅草稿狀態的活動可以刪除', 'INVALID_ACTIVITY_STATUS', 409);
  return prisma.portalActivity.delete({ where: { id } });
}

export async function publishActivity(prisma: TenantDb, id: string, tenantId: string) {
  const activity = await prisma.portalActivity.findFirst({ where: { id, tenantId } });
  if (!activity) return null;
  if (activity.status !== 'DRAFT') throw new AppError('僅草稿狀態的活動可以發布', 'INVALID_ACTIVITY_STATUS', 409);
  return prisma.portalActivity.update({
    where: { id },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
  });
}

export async function endActivity(prisma: TenantDb, id: string, tenantId: string) {
  const activity = await prisma.portalActivity.findFirst({ where: { id, tenantId } });
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
export async function archiveActivity(prisma: TenantDb, id: string, tenantId: string) {
  const activity = await prisma.portalActivity.findFirst({ where: { id, tenantId } });
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
export async function unarchiveActivity(prisma: TenantDb, id: string, tenantId: string) {
  const activity = await prisma.portalActivity.findFirst({ where: { id, tenantId } });
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
  prisma: TenantDb,
  activityId: string,
  tenantId: string,
  page = 1,
  limit = 20,
) {
  const [items, total] = await Promise.all([
    prisma.portalSubmission.findMany({
      where: { activityId, tenantId },
      include: { contact: { select: { id: true, displayName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.portalSubmission.count({ where: { activityId, tenantId } }),
  ]);

  return { items, total, page, limit };
}

export async function submitActivity(
  prisma: PrismaClient,
  activityId: string,
  contactId: string,
  tenantId: string,
  answers: { optionIds?: string[]; fields?: Record<string, string> },
) {
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
  const settings = activity.settings as Record<string, unknown>;
  const allowMultiple = settings.allowMultiple ?? false;
  if (!allowMultiple) {
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

  // Award points
  const pointsPerSubmit = (settings.pointsPerSubmit as number) ?? 0;

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
    await addPointTransaction(prisma, {
      tenantId,
      contactId,
      amount: pointsPerSubmit,
      type: 'activity_submit',
      refId: submission.id,
      note: `參加活動「${activity.title}」`,
    });
  }

  // Publish event
  eventBus.publish({
    name: 'portal.activity.submitted',
    tenantId,
    timestamp: new Date(),
    payload: { activityId, contactId, submissionId: submission.id, activityType: activity.type },
  });

  return submission;
}

// ─── Draw (random winners) ──────────────────────────────────────────────────

export async function drawWinners(
  prisma: TenantDb,
  activityId: string,
  tenantId: string,
  count: number,
) {
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

// ─── Activity result stats (public) ─────────────────────────────────────────

export async function getActivityResult(
  prisma: PrismaClient,
  activityId: string,
  tenantId: string,
) {
  // tenantId 為必填：本函式的唯一呼叫端是公開的粉絲門戶（走 prismaAdmin
  // 繞過 RLS），若不在查詢條件內限定租戶，任何粉絲都能拿活動 id 讀到
  // 其他租戶的投票／問卷結果。
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
