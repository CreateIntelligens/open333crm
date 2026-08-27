import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { withTenant, tenantScopedClient } from '../../lib/tenant-db.js';
import type { Prisma } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import type { CaseStatus, Priority } from '@open333crm/shared';
import { addMinutes } from 'date-fns';
import { validateTransition } from './case-state-machine.js';
import { AppError } from '../../shared/utils/response.js';
import { eventBus } from '../../events/event-bus.js';
import { trackBroadcastCase } from '../marketing/broadcast.tracking.js';
import { autoAssignCase } from './assignment.service.js';
import { logger } from '@open333crm/core';

type PrismaExecutor = TenantDb;

export interface CaseFilters {
  status?: string;
  priority?: string;
  assigneeId?: string;
  category?: string;
  slaStatus?: 'normal' | 'warning' | 'breached';
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export async function listCases(
  prisma: TenantDb,
  tenantId: string,
  filters: CaseFilters,
  pagination: PaginationParams,
) {
  const now = new Date();
  const where: Prisma.CaseWhereInput = {
    tenantId,
  };

  if (filters.status) {
    where.status = filters.status as any;
  }
  if (filters.priority) {
    where.priority = filters.priority as any;
  }
  if (filters.assigneeId) {
    where.assigneeId = filters.assigneeId;
  }
  if (filters.category) {
    where.category = filters.category;
  }
  if (filters.slaStatus) {
    const activeStatuses = { status: { notIn: ['CLOSED', 'RESOLVED'] as any[] } };
    if (filters.slaStatus === 'breached') {
      Object.assign(where, activeStatuses);
      where.slaDueAt = { lt: now };
    } else if (filters.slaStatus === 'warning') {
      const warningThreshold = addMinutes(now, 30);
      Object.assign(where, activeStatuses);
      where.slaDueAt = { gte: now, lte: warningThreshold };
    }
    // 'normal' = no extra SLA filter
  }

  // Determine sort order
  const sortBy = filters.sortBy || 'slaDueAt';
  const sortOrder = filters.sortOrder || 'asc';
  let orderBy: Prisma.CaseOrderByWithRelationInput[];
  if (sortBy === 'slaDueAt') {
    orderBy = [{ slaDueAt: { sort: sortOrder, nulls: 'last' } }, { createdAt: 'desc' }];
  } else if (sortBy === 'priority') {
    orderBy = [{ priority: sortOrder }, { createdAt: 'desc' }];
  } else if (sortBy === 'createdAt') {
    orderBy = [{ createdAt: sortOrder }];
  } else {
    orderBy = [{ slaDueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }];
  }

  const [cases, total] = await Promise.all([
    prisma.case.findMany({
      where,
      include: {
        contact: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            phone: true,
            email: true,
          },
        },
        assignee: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        },
        team: {
          select: {
            id: true,
            name: true,
          },
        },
        tags: {
          include: {
            tag: {
              select: {
                id: true,
                name: true,
                color: true,
                type: true,
                scope: true,
              },
            },
          },
        },
      },
      orderBy,
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    }),
    prisma.case.count({ where }),
  ]);

  return { cases, total };
}

export async function getCase(
  prisma: TenantDb,
  id: string,
  tenantId: string,
) {
  const caseRecord = await prisma.case.findFirst({
    where: { id, tenantId },
    include: {
      contact: {
        select: {
          id: true,
          displayName: true,
          avatarUrl: true,
          phone: true,
          email: true,
          channelIdentities: {
            select: {
              id: true,
              channelType: true,
              uid: true,
              profileName: true,
            },
          },
          tags: {
            include: {
              tag: {
                select: {
                  id: true,
                  name: true,
                  color: true,
                },
              },
            },
          },
        },
      },
      assignee: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          role: true,
        },
      },
      team: {
        select: {
          id: true,
          name: true,
        },
      },
      tags: {
        include: {
          tag: {
            select: {
              id: true,
              name: true,
              color: true,
              type: true,
              scope: true,
            },
          },
        },
      },
      events: {
        orderBy: { createdAt: 'desc' },
        include: {
          actor: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      notes: {
        orderBy: { createdAt: 'desc' },
      },
      conversations: {
        select: {
          id: true,
          channelType: true,
          status: true,
          lastMessageAt: true,
        },
      },
    },
  });

  if (!caseRecord) {
    throw new AppError('Case not found', 'NOT_FOUND', 404);
  }

  // Look up SLA policy details for first response / resolution targets
  let slaPolicyData = null;
  if (caseRecord.slaPolicy) {
    slaPolicyData = await prisma.slaPolicy.findFirst({
      where: {
        tenantId,
        name: caseRecord.slaPolicy,
      },
      select: {
        firstResponseMinutes: true,
        resolutionMinutes: true,
      },
    });
  }

  return {
    ...caseRecord,
    conversation: caseRecord.conversations[0] ?? null,
    slaPolicyData,
  };
}

async function createCaseRecord(
  prisma: PrismaExecutor,
  tenantId: string,
  agentId: string,
  data: {
    contactId: string;
    channelId: string;
    title: string;
    description?: string;
    priority?: Priority;
    category?: string;
    assigneeId?: string;
    teamId?: string;
    slaPolicyId?: string;
  },
) {
  const priority = data.priority ?? 'MEDIUM';

  const slaPolicy = data.slaPolicyId
    ? await prisma.slaPolicy.findFirst({
        where: {
          id: data.slaPolicyId,
          tenantId,
        },
      })
    : await prisma.slaPolicy.findFirst({
        where: {
          tenantId,
          priority,
        },
      });

  if (data.slaPolicyId && !slaPolicy) {
    throw new AppError('SLA policy not found', 'NOT_FOUND', 404);
  }

  let slaDueAt: Date | null = null;
  if (slaPolicy) {
    slaDueAt = addMinutes(new Date(), slaPolicy.resolutionMinutes);
  }

  const caseRecord = await prisma.case.create({
    data: {
      tenantId,
      contactId: data.contactId,
      channelId: data.channelId,
      title: data.title,
      description: data.description,
      priority,
      category: data.category,
      status: 'OPEN',
      assigneeId: data.assigneeId,
      teamId: data.teamId,
      slaPolicy: slaPolicy?.name ?? null,
      slaDueAt,
    },
    include: {
      contact: {
        select: {
          id: true,
          displayName: true,
        },
      },
      assignee: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  await prisma.caseEvent.create({
    data: {
      caseId: caseRecord.id,
      actorType: 'agent',
      actorId: agentId,
      eventType: 'created',
      payload: {
        title: data.title,
        priority,
        category: data.category ?? null,
        slaPolicyId: data.slaPolicyId ?? null,
      },
    },
  });

  return caseRecord;
}

function emitCaseCreated(
  io: SocketIOServer,
  tenantId: string,
  caseRecord: {
    id: string;
    contactId: string;
    channelId: string;
    title: string;
    status: string;
    priority: string;
    assigneeId: string | null;
    teamId: string | null;
  },
  conversationId?: string | null,
) {
  // Emit WebSocket event
  const wsPayload = {
    id: caseRecord.id,
    status: caseRecord.status,
    priority: caseRecord.priority,
    assigneeId: caseRecord.assigneeId,
    title: caseRecord.title,
  };

  io.to(`tenant:${tenantId}`).emit('case.created', wsPayload);

  // Publish to EventBus for automation
  eventBus.publish({
    name: 'case.created',
    tenantId,
    timestamp: new Date(),
    payload: {
      caseId: caseRecord.id,
      contactId: caseRecord.contactId,
      channelId: caseRecord.channelId,
      title: caseRecord.title,
      priority: caseRecord.priority,
      status: caseRecord.status,
      ...(conversationId ? { conversationId } : {}),
    },
  });
}

export async function createCase(
  prisma: TenantDb,
  io: SocketIOServer,
  tenantId: string,
  agentId: string,
  data: {
    contactId: string;
    channelId: string;
    title: string;
    description?: string;
    priority?: Priority;
    category?: string;
    assigneeId?: string;
    teamId?: string;
    slaPolicyId?: string;
  },
) {
  const caseRecord = await createCaseRecord(prisma, tenantId, agentId, data);
  emitCaseCreated(io, tenantId, caseRecord, null);

  // Track broadcast → case attribution (non-blocking)
  trackBroadcastCase(prisma, data.contactId, caseRecord.id).catch(() => {});

  // Auto-assign if no assignee specified and teamId is set
  if (!data.assigneeId && caseRecord.teamId) {
    autoAssignCase(prisma, io, caseRecord.id, tenantId, caseRecord.teamId).catch((err) => {
      logger.error(`[createCase] Auto-assign failed for case ${caseRecord.id}:`, err);
    });
  }

  return caseRecord;
}

export async function assignCase(
  prisma: TenantDb,
  io: SocketIOServer,
  caseId: string,
  tenantId: string,
  agentId: string,
  assigneeId: string,
) {
  const caseRecord = await prisma.case.findFirst({
    where: { id: caseId, tenantId },
    include: {
      conversations: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!caseRecord) {
    throw new AppError('Case not found', 'NOT_FOUND', 404);
  }

  // Verify assignee exists
  const assignee = await prisma.agent.findFirst({
    where: { id: assigneeId, tenantId },
  });
  if (!assignee) {
    throw new AppError('Assignee agent not found', 'NOT_FOUND', 404);
  }

  // If case is OPEN, auto-transition to IN_PROGRESS
  const newStatus: CaseStatus =
    caseRecord.status === 'OPEN' ? 'IN_PROGRESS' : (caseRecord.status as CaseStatus);

  const updated = await prisma.case.update({
    where: { id: caseId },
    data: {
      assigneeId,
      status: newStatus,
    },
    include: {
      assignee: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // Create assigned event
  await prisma.caseEvent.create({
    data: {
      caseId,
      actorType: 'agent',
      actorId: agentId,
      eventType: 'assigned',
      payload: {
        assigneeId,
        assigneeName: assignee.name,
      },
    },
  });

  // If status changed, also create a status_changed event
  if (newStatus !== caseRecord.status) {
    await prisma.caseEvent.create({
      data: {
        caseId,
        actorType: 'agent',
        actorId: agentId,
        eventType: 'status_changed',
        payload: {
          from: caseRecord.status,
          to: newStatus,
        },
      },
    });
  }

  // Emit WebSocket event
  const wsPayload = {
    id: updated.id,
    status: updated.status,
    priority: updated.priority,
    assigneeId: updated.assigneeId,
  };

  io.to(`tenant:${tenantId}`).emit('case.updated', wsPayload);

  // Publish case.assigned event for notifications
  eventBus.publish({
    name: 'case.assigned',
    tenantId,
    timestamp: new Date(),
    payload: { caseId, assigneeId, title: updated.title },
  });

  return updated;
}

export async function transitionCase(
  prisma: TenantDb,
  io: SocketIOServer,
  caseId: string,
  tenantId: string,
  agentId: string,
  toStatus: CaseStatus,
) {
  const caseRecord = await prisma.case.findFirst({
    where: { id: caseId, tenantId },
    include: {
      conversations: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!caseRecord) {
    throw new AppError('Case not found', 'NOT_FOUND', 404);
  }

  validateTransition(caseRecord.status as CaseStatus, toStatus);

  const now = new Date();
  const updateData: Prisma.CaseUpdateInput = {
    status: toStatus,
  };

  if (toStatus === 'RESOLVED') {
    updateData.resolvedAt = now;
  }
  if (toStatus === 'CLOSED') {
    updateData.closedAt = now;
  }

  const updated = await prisma.case.update({
    where: { id: caseId },
    data: updateData,
    include: {
      contact: {
        select: {
          id: true,
          displayName: true,
        },
      },
      assignee: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // Create status_changed event
  await prisma.caseEvent.create({
    data: {
      caseId,
      actorType: 'agent',
      actorId: agentId,
      eventType: 'status_changed',
      payload: {
        from: caseRecord.status,
        to: toStatus,
      },
    },
  });

  // Emit WebSocket event
  const wsPayload = {
    id: updated.id,
    status: updated.status,
    priority: updated.priority,
    assigneeId: updated.assigneeId,
  };

  io.to(`tenant:${tenantId}`).emit('case.updated', wsPayload);

  // Publish case.resolved / case.closed events for CSAT and automation
  if (toStatus === 'RESOLVED') {
    const conversationId = caseRecord.conversations[0]?.id ?? null;
    eventBus.publish({
      name: 'case.resolved',
      tenantId,
      timestamp: now,
      payload: {
        caseId: updated.id,
        contactId: caseRecord.contactId,
        channelId: caseRecord.channelId,
        assigneeId: caseRecord.assigneeId,
        title: caseRecord.title,
        ...(conversationId ? { conversationId } : {}),
      },
    });
  }

  if (toStatus === 'CLOSED') {
    const conversationId = caseRecord.conversations[0]?.id ?? null;
    eventBus.publish({
      name: 'case.closed',
      tenantId,
      timestamp: now,
      payload: {
        caseId: updated.id,
        contactId: caseRecord.contactId,
        channelId: caseRecord.channelId,
        assigneeId: caseRecord.assigneeId,
        title: caseRecord.title,
        ...(conversationId ? { conversationId } : {}),
      },
    });
  }

  return updated;
}

export async function escalateCase(
  prisma: TenantDb,
  io: SocketIOServer,
  caseId: string,
  tenantId: string,
  agentId: string,
  body?: {
    reason: string;
    note?: string;
    newPriority: Priority;
    assigneeId?: string;
    notifyTargets?: string[];
  },
) {
  const caseRecord = await prisma.case.findFirst({
    where: { id: caseId, tenantId },
  });

  if (!caseRecord) {
    throw new AppError('Case not found', 'NOT_FOUND', 404);
  }

  // Validate transition to ESCALATED
  validateTransition(caseRecord.status as CaseStatus, 'ESCALATED');

  // Determine new priority from body or auto-bump
  let newPriority: string;
  if (body?.newPriority) {
    newPriority = body.newPriority;
  } else {
    const priorityOrder: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
    const currentIndex = priorityOrder.indexOf(caseRecord.priority as Priority);
    newPriority = currentIndex < priorityOrder.length - 1
      ? priorityOrder[currentIndex + 1]
      : caseRecord.priority;
  }

  const updateData: Prisma.CaseUpdateInput = {
    status: 'ESCALATED',
    priority: newPriority as any,
  };

  // If assigneeId provided, reassign
  if (body?.assigneeId) {
    const assignee = await prisma.agent.findFirst({
      where: { id: body.assigneeId, tenantId },
    });
    if (!assignee) {
      throw new AppError('Assignee agent not found', 'NOT_FOUND', 404);
    }
    updateData.assignee = { connect: { id: body.assigneeId } };
  }

  const updated = await prisma.case.update({
    where: { id: caseId },
    data: updateData,
    include: {
      contact: {
        select: {
          id: true,
          displayName: true,
        },
      },
      assignee: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // Create escalated event with full payload
  await prisma.caseEvent.create({
    data: {
      caseId,
      actorType: 'agent',
      actorId: agentId,
      eventType: 'escalated',
      payload: {
        from: caseRecord.status,
        previousPriority: caseRecord.priority,
        newPriority,
        reason: body?.reason ?? null,
        note: body?.note ?? null,
        notifyTargets: body?.notifyTargets ?? [],
        assigneeId: body?.assigneeId ?? null,
      },
    },
  });

  // Emit WebSocket event
  const wsPayload = {
    id: updated.id,
    status: updated.status,
    priority: updated.priority,
    assigneeId: updated.assigneeId,
  };

  io.to(`tenant:${tenantId}`).emit('case.updated', wsPayload);

  // Publish to EventBus for automation
  eventBus.publish({
    name: 'case.escalated',
    tenantId,
    timestamp: new Date(),
    payload: {
      caseId: updated.id,
      contactId: caseRecord.contactId,
      previousPriority: caseRecord.priority,
      newPriority: updated.priority,
      status: updated.status,
      reason: body?.reason ?? null,
    },
  });

  return updated;
}

export async function addNote(
  prisma: TenantDb,
  caseId: string,
  agentId: string,
  content: string,
  isInternal: boolean = true,
) {
  const note = await prisma.caseNote.create({
    data: {
      caseId,
      agentId,
      content,
      isInternal,
    },
  });

  return note;
}

export async function getCaseEvents(
  prisma: TenantDb,
  caseId: string,
) {
  const events = await prisma.caseEvent.findMany({
    where: { caseId },
    include: {
      actor: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return events;
}

// 收 base PrismaClient：DB 寫入包在 withTenant 交易內（RLS + 原子），
// fire-and-forget 副作用（trackBroadcastCase/autoAssignCase）在交易「之後」用 base client
// 執行——它們未 await，若用交易內的 tx 會在 commit 後才跑而 tx 連線已關（"Transaction closed"）。
export async function createCaseFromConversation(
  prisma: PrismaClient,
  io: SocketIOServer,
  conversationId: string,
  tenantId: string,
  agentId: string,
  caseData: {
    title: string;
    description?: string;
    priority?: Priority;
    category?: string;
    assigneeId?: string;
    teamId?: string;
    slaPolicyId?: string;
  },
) {
  const caseRecord = await withTenant(prisma, tenantId, async (tx) => {
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { contact: true, channel: true },
    });
    if (!conversation) {
      throw new AppError('Conversation not found', 'NOT_FOUND', 404);
    }
    if (conversation.caseId) {
      throw new AppError('Conversation already has a linked case', 'CONFLICT', 409);
    }
    const created = await createCaseRecord(tx, tenantId, agentId, {
      contactId: conversation.contactId,
      channelId: conversation.channelId,
      ...caseData,
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { caseId: created.id },
    });
    return created;
  });

  emitCaseCreated(io, tenantId, caseRecord, conversationId);

  // 交易外執行副作用（用 base prisma，長連線）——各自綁定租戶（tenantScopedClient 自動）
  const bg = tenantScopedClient(prisma, tenantId);
  trackBroadcastCase(bg, caseRecord.contactId, caseRecord.id).catch(() => {});
  if (!caseData.assigneeId && caseRecord.teamId) {
    autoAssignCase(bg, io, caseRecord.id, tenantId, caseRecord.teamId).catch((err) => {
      logger.error(`[createCaseFromConversation] Auto-assign failed for case ${caseRecord.id}:`, err);
    });
  }

  return caseRecord;
}

export async function linkConversationToCase(
  prisma: TenantDb,
  io: SocketIOServer,
  caseId: string,
  conversationId: string,
  tenantId: string,
  agentId: string,
) {
  // 外層 withTenant 交易保證原子（不自開 $transaction，避免巢狀）
  const [caseRecord, conversation] = await Promise.all([
    prisma.case.findFirst({ where: { id: caseId, tenantId } }),
    prisma.conversation.findFirst({ where: { id: conversationId, tenantId } }),
  ]);

  if (!caseRecord || !conversation) {
    throw new AppError('Case or conversation not found', 'NOT_FOUND', 404);
  }

  if (conversation.caseId) {
    throw new AppError('Conversation already has a linked case', 'CONFLICT', 409);
  }

  const updatedConversation = await prisma.conversation.update({
    where: { id: conversationId },
    data: { caseId },
    select: {
      id: true,
      caseId: true,
      channelType: true,
      status: true,
      lastMessageAt: true,
    },
  });

  await prisma.caseEvent.create({
    data: {
      caseId,
      actorType: 'agent',
      actorId: agentId,
      eventType: 'conversation_linked',
      payload: { conversationId },
    },
  });

  io.to(`tenant:${tenantId}`).emit('case.updated', {
    id: caseId,
    conversationId,
  });

  return updatedConversation;
}

// 收 TenantDb：呼叫端以 withTenant 包在綁定租戶交易內；內部依序解除關聯+刪除即為原子。
export async function deleteCase(
  prisma: TenantDb,
  io: SocketIOServer,
  caseId: string,
  tenantId: string,
) {
  const caseRecord = await prisma.case.findFirst({
    where: { id: caseId, tenantId },
    select: {
      id: true,
      status: true,
      priority: true,
      assigneeId: true,
      title: true,
    },
  });

  if (!caseRecord) {
    throw new AppError('Case not found', 'NOT_FOUND', 404);
  }

  // 外層 withTenant 交易保證原子（不自開 $transaction，避免巢狀）
  await prisma.conversation.updateMany({
    where: { tenantId, caseId },
    data: { caseId: null },
  });
  await prisma.case.delete({ where: { id: caseId } });

  io.to(`tenant:${tenantId}`).emit('case.deleted', {
    id: caseRecord.id,
    status: caseRecord.status,
    priority: caseRecord.priority,
    assigneeId: caseRecord.assigneeId,
    title: caseRecord.title,
  });

  return { id: caseRecord.id };
}

export async function getCaseStats(
  prisma: TenantDb,
  tenantId: string,
) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const warningThreshold = addMinutes(now, 30);

  const [openCount, breachedCount, warningCount, resolvedTodayCount, statusCountsRaw] = await Promise.all([
    prisma.case.count({
      where: {
        tenantId,
        status: { in: ['OPEN', 'IN_PROGRESS'] as any[] },
      },
    }),
    prisma.case.count({
      where: {
        tenantId,
        status: { notIn: ['CLOSED', 'RESOLVED'] as any[] },
        slaDueAt: { lt: now },
      },
    }),
    prisma.case.count({
      where: {
        tenantId,
        status: { notIn: ['CLOSED', 'RESOLVED'] as any[] },
        slaDueAt: { gte: now, lte: warningThreshold },
      },
    }),
    prisma.case.count({
      where: {
        tenantId,
        resolvedAt: { gte: todayStart },
      },
    }),
    // groupBy 在 TenantDb 聯集型別下 TS 無法解析多載（union of overloads 限制），
    // 這裡對 delegate 做局部 cast；執行語意不變、仍走 RLS 注入的 tenantPrisma。
    (prisma.case as any).groupBy({
      by: ['status'],
      where: { tenantId },
      _count: true,
    }) as Promise<Array<{ status: string; _count: number }>>,
  ]);

  const statusCounts: Record<string, number> = {};
  for (const row of statusCountsRaw) {
    statusCounts[row.status] = row._count;
  }

  return { openCount, breachedCount, warningCount, resolvedTodayCount, statusCounts };
}

export async function updateCase(
  prisma: TenantDb,
  io: SocketIOServer,
  id: string,
  tenantId: string,
  data: {
    title?: string;
    description?: string;
    priority?: string;
    category?: string;
    status?: string;
    assigneeId?: string | null;
    teamId?: string | null;
  },
) {
  const caseRecord = await prisma.case.findFirst({
    where: { id, tenantId },
  });

  if (!caseRecord) {
    throw new AppError('Case not found', 'NOT_FOUND', 404);
  }

  const updateData: Prisma.CaseUpdateInput = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.priority !== undefined) updateData.priority = data.priority as any;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.assigneeId !== undefined) {
    updateData.assignee = data.assigneeId ? { connect: { id: data.assigneeId } } : { disconnect: true };
  }
  if (data.teamId !== undefined) {
    updateData.team = data.teamId ? { connect: { id: data.teamId } } : { disconnect: true };
  }
  if (data.status !== undefined) {
    validateTransition(caseRecord.status as CaseStatus, data.status as CaseStatus);
    updateData.status = data.status as any;
    if (data.status === 'RESOLVED') updateData.resolvedAt = new Date();
    if (data.status === 'CLOSED') updateData.closedAt = new Date();
  }

  const updated = await prisma.case.update({
    where: { id },
    data: updateData,
    include: {
      contact: {
        select: {
          id: true,
          displayName: true,
        },
      },
      assignee: {
        select: {
          id: true,
          name: true,
        },
      },
      team: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // Emit WebSocket event
  const wsPayload = {
    id: updated.id,
    status: updated.status,
    priority: updated.priority,
    assigneeId: updated.assigneeId,
  };

  io.to(`tenant:${tenantId}`).emit('case.updated', wsPayload);

  return updated;
}
