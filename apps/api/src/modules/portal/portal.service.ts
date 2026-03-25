/**
 * Portal activity service — CRUD, submissions, draw.
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import { eventBus } from '../../events/event-bus.js';
import { addPointTransaction } from './points.service.js';

// ─── Activity CRUD ──────────────────────────────────────────────────────────

export async function listActivities(
  prisma: PrismaClient,
  tenantId: string,
  filters: { type?: string; status?: string; page?: number; limit?: number },
) {
  const where: Record<string, unknown> = { tenantId };
  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;

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

export async function getActivity(prisma: PrismaClient, id: string, tenantId: string) {
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
  prisma: PrismaClient,
  tenantId: string,
  createdById: string,
  data: {
    type: string;
    title: string;
    description?: string;
    coverImage?: string;
    settings?: Record<string, unknown>;
    startsAt?: string;
    endsAt?: string;
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
      startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
      endsAt: data.endsAt ? new Date(data.endsAt) : undefined,
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

export async function updateActivity(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
  data: {
    title?: string;
    description?: string;
    coverImage?: string;
    settings?: Record<string, unknown>;
    startsAt?: string;
    endsAt?: string;
    options?: Array<{ id?: string; label: string; imageUrl?: string; sortOrder?: number; isCorrect?: boolean }>;
    fields?: Array<{ id?: string; fieldKey: string; label: string; fieldType?: string; options?: unknown; isRequired?: boolean; sortOrder?: number }>;
  },
) {
  const activity = await prisma.portalActivity.findFirst({ where: { id, tenantId } });
  if (!activity) return null;
  if (activity.status !== 'DRAFT') throw new Error('Only DRAFT activities can be updated');

  // Replace options and fields if provided
  return prisma.$transaction(async (tx) => {
    if (data.options) {
      await tx.portalOption.deleteMany({ where: { activityId: id } });
      await tx.portalOption.createMany({
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
      await tx.portalField.deleteMany({ where: { activityId: id } });
      await tx.portalField.createMany({
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

    return tx.portalActivity.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        coverImage: data.coverImage,
        settings: data.settings as Prisma.InputJsonValue | undefined,
        startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
        endsAt: data.endsAt ? new Date(data.endsAt) : undefined,
      },
      include: {
        options: { orderBy: { sortOrder: 'asc' } },
        fields: { orderBy: { sortOrder: 'asc' } },
      },
    });
  });
}

export async function deleteActivity(prisma: PrismaClient, id: string, tenantId: string) {
  const activity = await prisma.portalActivity.findFirst({ where: { id, tenantId } });
  if (!activity) return null;
  if (activity.status !== 'DRAFT') throw new Error('Only DRAFT activities can be deleted');
  return prisma.portalActivity.delete({ where: { id } });
}

export async function publishActivity(prisma: PrismaClient, id: string, tenantId: string) {
  const activity = await prisma.portalActivity.findFirst({ where: { id, tenantId } });
  if (!activity) return null;
  if (activity.status !== 'DRAFT') throw new Error('Only DRAFT activities can be published');
  return prisma.portalActivity.update({
    where: { id },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
  });
}

export async function endActivity(prisma: PrismaClient, id: string, tenantId: string) {
  const activity = await prisma.portalActivity.findFirst({ where: { id, tenantId } });
  if (!activity) return null;
  if (activity.status !== 'PUBLISHED') throw new Error('Only PUBLISHED activities can be ended');
  return prisma.portalActivity.update({
    where: { id },
    data: { status: 'ENDED' },
  });
}

// ─── Submissions ────────────────────────────────────────────────────────────

export async function listSubmissions(
  prisma: PrismaClient,
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
  if (!activity) throw new Error('Activity not found or not published');

  // Check time range
  const now = new Date();
  if (activity.startsAt && now < activity.startsAt) throw new Error('Activity has not started yet');
  if (activity.endsAt && now > activity.endsAt) throw new Error('Activity has ended');

  // Check duplicate submission
  const settings = activity.settings as Record<string, unknown>;
  const allowMultiple = settings.allowMultiple ?? false;
  if (!allowMultiple) {
    const existing = await prisma.portalSubmission.findFirst({
      where: { activityId, contactId },
    });
    if (existing) throw new Error('Already submitted');
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
  prisma: PrismaClient,
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

export async function getActivityResult(prisma: PrismaClient, activityId: string) {
  const activity = await prisma.portalActivity.findFirst({
    where: { id: activityId },
    include: { options: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!activity) return null;

  const submissions = await prisma.portalSubmission.findMany({
    where: { activityId },
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
