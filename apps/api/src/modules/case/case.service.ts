/**
 * 工單的業務規則與查詢（#337 階段 3）。
 *
 * 收 TenantCtx，不推播、不發事件：回傳 flow 需要的結果，推播與事件由 case.flow.ts 經 case-effects.ts 送出。
 * 例外：markCaseFirstResponse 仍收 TenantDb，因為呼叫端 conversation.service.ts 還沒搬（階段 4）。
 */
import type { TenantDb } from '../../lib/tenant-db.js';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { channelIdWhereFilter, type AccessibleChannels } from '../../services/channel-visibility.js';
import type { Prisma } from '@prisma/client';
import type { CaseStatus, Priority } from '@open333crm/shared';
import { addMinutes } from 'date-fns';
import { validateTransition } from './case-state-machine.js';
import { AppError } from '../../shared/utils/response.js';
import { notFound } from '../../shared/messages/resource.js';

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
  ctx: TenantCtx,
  filters: CaseFilters,
  pagination: PaginationParams,
  /** CM-173 渠道級可見性：ALL_CHANNELS→不過濾；Set→只回可見渠道（空＝fail-closed）。 */
  /** 必填：呼叫端明確決定可見範圍，不受限時傳 ALL_CHANNELS（漏傳會編譯失敗，而不是悄悄不過濾） */
  accessibleChannels: AccessibleChannels,
) {
  const { tx: prisma, tenantId } = ctx;
  const now = new Date();
  const where: Prisma.CaseWhereInput = {
    tenantId,
  };

  const filter = channelIdWhereFilter(accessibleChannels);
  if (filter) where.channelId = filter;

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

export async function getCase(ctx: TenantCtx, id: string) {
  const { tx: prisma, tenantId } = ctx;
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
    throw new AppError(notFound('case'), 'NOT_FOUND', 404);
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
  ctx: TenantCtx,
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
  const { tx: prisma, tenantId } = ctx;
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
        // 「設為此優先級預設」的政策優先，沒有預設時取最早建立的（G20，AUDIT SLA-03）
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });

  if (data.slaPolicyId && !slaPolicy) {
    throw new AppError(notFound('slaPolicy'), 'NOT_FOUND', 404);
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

/** 建立工單。自動派案與廣播歸因由 flow 在 commit 之後另開交易執行 */
export async function createCase(
  ctx: TenantCtx,
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
  // S10：工單渠道必須是聯絡人所在的渠道。原本前端取第一個渠道，工單被歸到任意渠道，
  // 影響渠道可見範圍、報表歸因與 CSAT 從哪個渠道送出
  const identity = await ctx.tx.channelIdentity.findFirst({
    where: { contactId: data.contactId, channelId: data.channelId, contact: { tenantId: ctx.tenantId } },
    select: { id: true },
  });
  if (!identity) {
    throw new AppError(
      '這位聯絡人不在所選的渠道，請改選聯絡人所在的渠道',
      'CONTACT_NOT_ON_CHANNEL',
      400,
    );
  }

  return createCaseRecord(ctx, agentId, data);
}

export async function assignCase(
  ctx: TenantCtx,
  caseId: string,
  agentId: string,
  assigneeId: string,
) {
  const { tx: prisma, tenantId } = ctx;
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
    throw new AppError(notFound('case'), 'NOT_FOUND', 404);
  }

  // Verify assignee exists
  const assignee = await prisma.agent.findFirst({
    where: { id: assigneeId, tenantId },
  });
  if (!assignee) {
    throw new AppError(notFound('assignee'), 'NOT_FOUND', 404);
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

  return updated;
}

/** 轉換狀態。回傳轉換後的工單與轉換前的資料，flow 依此發 case.resolved、case.closed */
export async function transitionCase(
  ctx: TenantCtx,
  caseId: string,
  agentId: string,
  toStatus: CaseStatus,
) {
  const { tx: prisma, tenantId } = ctx;
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
    throw new AppError(notFound('case'), 'NOT_FOUND', 404);
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

  return { updated, before: caseRecord, toStatus };
}

/** 升級工單。回傳升級後的工單、升級前的資料與輸入，flow 依此發 case.escalated */
export async function escalateCase(
  ctx: TenantCtx,
  caseId: string,
  agentId: string,
  body?: {
    reason: string;
    note?: string;
    newPriority: Priority;
    assigneeId?: string;
    notifyTargets?: string[];
  },
) {
  const { tx: prisma, tenantId } = ctx;
  const caseRecord = await prisma.case.findFirst({
    where: { id: caseId, tenantId },
  });

  if (!caseRecord) {
    throw new AppError(notFound('case'), 'NOT_FOUND', 404);
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
      throw new AppError(notFound('assignee'), 'NOT_FOUND', 404);
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

  return { updated, before: caseRecord, agentId, body };
}

export async function addNote(
  ctx: TenantCtx,
  caseId: string,
  agentId: string,
  content: string,
  isInternal: boolean = true,
) {
  const note = await ctx.tx.caseNote.create({
    data: {
      caseId,
      agentId,
      content,
      isInternal,
    },
  });

  return note;
}

export async function getCaseEvents(ctx: TenantCtx, caseId: string) {
  const events = await ctx.tx.caseEvent.findMany({
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

/** 從對話建立工單，並把對話掛到這張工單。自動派案與廣播歸因由 flow 在 commit 之後執行 */
export async function createCaseFromConversation(
  ctx: TenantCtx,
  conversationId: string,
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
  const { tx } = ctx;
  const conversation = await tx.conversation.findFirst({
    where: { id: conversationId, tenantId: ctx.tenantId },
    include: { contact: true, channel: true },
  });
  if (!conversation) {
    throw new AppError(notFound('conversation'), 'NOT_FOUND', 404);
  }
  if (conversation.caseId) {
    throw new AppError('這則對話已建立過案件', 'CONFLICT', 409);
  }
  const created = await createCaseRecord(ctx, agentId, {
    contactId: conversation.contactId,
    channelId: conversation.channelId,
    ...caseData,
  });
  await tx.conversation.update({
    where: { id: conversationId },
    data: { caseId: created.id },
  });
  return created;
}

export async function linkConversationToCase(
  ctx: TenantCtx,
  caseId: string,
  conversationId: string,
  agentId: string,
) {
  const { tx: prisma, tenantId } = ctx;
  const [caseRecord, conversation] = await Promise.all([
    prisma.case.findFirst({ where: { id: caseId, tenantId } }),
    prisma.conversation.findFirst({ where: { id: conversationId, tenantId } }),
  ]);

  if (!caseRecord || !conversation) {
    throw new AppError('找不到此案件或其關聯對話，可能已被刪除', 'NOT_FOUND', 404);
  }

  if (conversation.caseId) {
    throw new AppError('這則對話已建立過案件', 'CONFLICT', 409);
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

  // 客服可能在掛上工單前就已回覆：補上首次回應，否則 SLA 會判定逾時
  await syncFirstResponseFromConversation(ctx, caseId, conversationId, caseRecord.createdAt);

  return updatedConversation;
}

/** 刪除工單並解除對話的關聯。回傳刪除前的摘要，flow 依此推播 case.deleted */
export async function deleteCase(ctx: TenantCtx, caseId: string) {
  const { tx: prisma, tenantId } = ctx;
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
    throw new AppError(notFound('case'), 'NOT_FOUND', 404);
  }

  await prisma.conversation.updateMany({
    where: { tenantId, caseId },
    data: { caseId: null },
  });
  await prisma.case.delete({ where: { id: caseId } });

  return caseRecord;
}

export async function getCaseStats(ctx: TenantCtx) {
  const { tx: prisma, tenantId } = ctx;
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

/**
 * @description 就地編輯工單欄位（詳情頁的下拉與標題）。
 * 狀態改變時和頂部按鈕走同一條路徑（S06）：改成已升級交給 escalateCase，其餘交給 transitionCase，
 * 才會寫時間軸事件；flow 依回傳的 change 發布 case.resolved／case.closed／case.escalated
 * （CSAT、自動化、升級通知依此觸發）。
 * @param options.actorId 操作的客服；改狀態時必填，寫進時間軸事件
 * @returns result 是更新後的工單；change 說明 flow 要送出哪些推播與事件
 */
export async function updateCase(
  ctx: TenantCtx,
  id: string,
  data: {
    title?: string;
    description?: string;
    priority?: string;
    category?: string;
    status?: string;
    assigneeId?: string | null;
    teamId?: string | null;
  },
  options: { actorId?: string } = {},
) {
  const { tx: prisma, tenantId } = ctx;
  const caseRecord = await prisma.case.findFirst({
    where: { id, tenantId },
  });

  if (!caseRecord) {
    throw new AppError(notFound('case'), 'NOT_FOUND', 404);
  }

  const { status, ...fields } = data;
  // 先驗證狀態轉換，避免其他欄位已經存了、狀態才被擋下
  if (status !== undefined) {
    validateTransition(caseRecord.status as CaseStatus, status as CaseStatus);
    if (!options.actorId) {
      throw new AppError('缺少操作的客服，無法變更工單狀態', 'INTERNAL_ERROR', 500);
    }
  }

  const updateData: Prisma.CaseUpdateInput = {};
  if (fields.title !== undefined) updateData.title = fields.title;
  if (fields.description !== undefined) updateData.description = fields.description;
  if (fields.priority !== undefined) updateData.priority = fields.priority as any;
  if (fields.category !== undefined) updateData.category = fields.category;
  if (fields.assigneeId !== undefined) {
    updateData.assignee = fields.assigneeId ? { connect: { id: fields.assigneeId } } : { disconnect: true };
  }
  if (fields.teamId !== undefined) {
    updateData.team = fields.teamId ? { connect: { id: fields.teamId } } : { disconnect: true };
  }

  const include = {
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
  } satisfies Prisma.CaseInclude;

  if (status === undefined || Object.keys(updateData).length > 0) {
    const updated = await prisma.case.update({
      where: { id },
      data: updateData,
      include,
    });

    if (status === undefined) {
      return { result: updated, change: { kind: 'fields' as const, updated } };
    }
  }

  // 狀態改變：與頂部按鈕同一條路徑（flow 依 change 送出和頂部按鈕相同的推播與事件）
  const change =
    status === 'ESCALATED'
      ? { kind: 'escalated' as const, ...(await escalateCase(ctx, id, options.actorId!)) }
      : { kind: 'transitioned' as const, ...(await transitionCase(ctx, id, options.actorId!, status as CaseStatus)) };

  const result = await prisma.case.findFirst({
    where: { id, tenantId },
    include,
  });
  if (!result) {
    throw new AppError(notFound('case'), 'NOT_FOUND', 404);
  }
  return { result, change };
}

/**
 * 記錄工單的首次回應時間（AUDIT SLA-01）：客服在工單關聯的對話送出訊息時呼叫。
 * 只在回應時間不早於工單建立、且比已記錄的更早（或尚未記錄）時寫入；單一條件式 UPDATE，並發送出也不會寫錯。
 * 首次回應只算客服（AI 與系統自動回覆不算），且在送到渠道之前就記錄：客服已經回覆，渠道送出失敗另有失敗標示。
 * 原本沒有任何寫入端，套了 SLA 的工單時間一到必定判定首次回應逾時。
 */
export async function markCaseFirstResponse(prisma: TenantDb, tenantId: string, caseId: string, respondedAt: Date): Promise<void> {
  await prisma.case.updateMany({
    where: {
      id: caseId,
      tenantId,
      createdAt: { lte: respondedAt },
      OR: [{ firstResponseAt: null }, { firstResponseAt: { gt: respondedAt } }],
    },
    data: { firstResponseAt: respondedAt },
  });
}

/** 對話掛到既有工單時：該對話中工單建立後最早的客服回覆，也算這張工單的首次回應 */
async function syncFirstResponseFromConversation(ctx: TenantCtx, caseId: string, conversationId: string, caseCreatedAt: Date) {
  const { tx, tenantId } = ctx;
  const firstReply = await tx.message.findFirst({
    where: {
      conversationId,
      conversation: { tenantId },
      direction: 'OUTBOUND',
      senderType: 'AGENT',
      createdAt: { gte: caseCreatedAt },
    },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  if (firstReply) await markCaseFirstResponse(tx, tenantId, caseId, firstReply.createdAt);
}
