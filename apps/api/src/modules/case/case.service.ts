import type { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import type { CaseStatus, Priority } from '@open333crm/shared';
import { addMinutes } from 'date-fns';
import { validateTransition } from './case-state-machine.js';
import { AppError } from '../../shared/utils/response.js';
import { eventBus } from '../../events/event-bus.js';
import { trackBroadcastCase } from '../marketing/broadcast.tracking.js';
import { autoAssignCase } from './assignment.service.js';

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
  prisma: PrismaClient,
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
  prisma: PrismaClient,
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
      conversation: {
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

  return { ...caseRecord, slaPolicyData };
}

export async function createCase(
  prisma: PrismaClient,
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
  },
) {
  const priority = data.priority ?? 'MEDIUM';

  // Look up SLA policy for the given priority
  const slaPolicy = await prisma.slaPolicy.findFirst({
    where: {
      tenantId,
      priority,
    },
  });

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

  // Create the 'created' event
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
      },
    },
  });

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
      contactId: data.contactId,
      channelId: data.channelId,
      title: caseRecord.title,
      priority: caseRecord.priority,
      status: caseRecord.status,
    },
  });

  // Track broadcast → case attribution (non-blocking)
  trackBroadcastCase(prisma, data.contactId, caseRecord.id).catch(() => {});

  // Auto-assign if no assignee specified and teamId is set
  if (!data.assigneeId && caseRecord.teamId) {
    autoAssignCase(prisma, io, caseRecord.id, tenantId, caseRecord.teamId).catch((err) => {
      console.error(`[createCase] Auto-assign failed for case ${caseRecord.id}:`, err);
    });
  }

  return caseRecord;
}

export async function assignCase(
  prisma: PrismaClient,
  io: SocketIOServer,
  caseId: string,
  tenantId: string,
  agentId: string,
  assigneeId: string,
) {
  const caseRecord = await prisma.case.findFirst({
    where: { id: caseId, tenantId },
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
  prisma: PrismaClient,
  io: SocketIOServer,
  caseId: string,
  tenantId: string,
  agentId: string,
  toStatus: CaseStatus,
) {
  const caseRecord = await prisma.case.findFirst({
    where: { id: caseId, tenantId },
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
    eventBus.publish({
      name: 'case.resolved',
      tenantId,
      timestamp: now,
      payload: {
        caseId: updated.id,
        contactId: caseRecord.contactId,
        channelId: caseRecord.channelId,
        conversationId: caseRecord.conversationId,
        assigneeId: caseRecord.assigneeId,
        title: caseRecord.title,
      },
    });
  }

  if (toStatus === 'CLOSED') {
    eventBus.publish({
      name: 'case.closed',
      tenantId,
      timestamp: now,
      payload: {
        caseId: updated.id,
        contactId: caseRecord.contactId,
        channelId: caseRecord.channelId,
        conversationId: caseRecord.conversationId,
        assigneeId: caseRecord.assigneeId,
        title: caseRecord.title,
      },
    });
  }

  return updated;
}

export async function escalateCase(
  prisma: PrismaClient,
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
  prisma: PrismaClient,
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
  prisma: PrismaClient,
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
  },
) {
  // Find the conversation
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: {
      contact: true,
      channel: true,
    },
  });

  if (!conversation) {
    throw new AppError('Conversation not found', 'NOT_FOUND', 404);
  }

  // Check if conversation already has a case
  if (conversation.caseId) {
    throw new AppError('Conversation already has a linked case', 'CONFLICT', 409);
  }

  // Create the case
  const caseRecord = await createCase(prisma, io, tenantId, agentId, {
    contactId: conversation.contactId,
    channelId: conversation.channelId,
    ...caseData,
  });

  // Link conversation to case
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { caseId: caseRecord.id },
  });

  return caseRecord;
}

export async function getCaseStats(
  prisma: PrismaClient,
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
    prisma.case.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: true,
    }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const row of statusCountsRaw) {
    statusCounts[row.status] = row._count;
  }

  return { openCount, breachedCount, warningCount, resolvedTodayCount, statusCounts };
}

export async function updateCase(
  prisma: PrismaClient,
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
