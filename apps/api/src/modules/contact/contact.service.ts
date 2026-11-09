import type { Prisma } from '@prisma/client';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { AppError } from '../../shared/utils/response.js';
import { notFound } from '../../shared/messages/resource.js';
import { encodeMessageCursor, MESSAGE_NEWEST_FIRST, olderThanCursor, parseMessageCursor } from '../../shared/utils/message-cursor.js';
import { ALL_CHANNELS, channelIdWhere, channelIdWhereFilter, type AccessibleChannels } from '../../services/channel-visibility.js';

export interface ContactFilters {
  q?: string;
  tagId?: string;
  channelType?: string;
  excludeChannelType?: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

function parseExcludedChannelTypes(channelType?: string) {
  return new Set(
    channelType
      ?.split(',')
      .map((type) => type.trim().toUpperCase())
      .filter(Boolean) ?? [],
  );
}

function combineChannelIdentityFilters(filters: Prisma.ChannelIdentityWhereInput[]) {
  if (filters.length === 1) return filters[0];
  return { AND: filters };
}

function combineIdentityInclude(
  base: Prisma.ChannelIdentityWhereInput | undefined,
  channelId: { in: string[] } | undefined,
): Prisma.ChannelIdentityWhereInput | undefined {
  const parts = [...(base ? [base] : []), ...(channelId ? [{ channelId }] : [])];
  if (parts.length === 0) return undefined;
  return combineChannelIdentityFilters(parts);
}

export async function listContacts(
  ctx: TenantCtx,
  filters: ContactFilters,
  pagination: PaginationParams,
  /** CM-173 渠道級可見性，必填：呼叫端要明確決定可見範圍，不受限時傳 ALL_CHANNELS（避免新呼叫端漏傳而外洩其他渠道資料） */
  accessibleChannels: AccessibleChannels,
) {
  const { tx: prisma, tenantId } = ctx;
  const where: Prisma.ContactWhereInput = {
    tenantId,
    isArchived: false,
  };

  if (filters.q) {
    where.OR = [
      { displayName: { contains: filters.q, mode: 'insensitive' } },
      { phone: { contains: filters.q, mode: 'insensitive' } },
      { email: { contains: filters.q, mode: 'insensitive' } },
    ];
  }

  if (filters.tagId) {
    where.tags = {
      some: { tagId: filters.tagId },
    };
  }

  // 依渠道類型篩選只比對可見渠道的身份：否則會藉篩選看出聯絡人在其他分店有這種帳號
  const visibleIdentity = visibleIdentityInclude(accessibleChannels).where ?? {};
  if (filters.channelType) {
    where.channelIdentities = {
      some: { channelType: filters.channelType as any, ...visibleIdentity },
    };
  }

  const excludedChannelTypes = parseExcludedChannelTypes(filters.excludeChannelType);
  const excludedChannelTypeValues = Array.from(excludedChannelTypes);
  const channelIdentityWhere = excludedChannelTypeValues.length > 0
    ? {
        AND: [
          { channelType: { notIn: excludedChannelTypeValues as any } },
          { channel: { is: { channelType: { notIn: excludedChannelTypeValues as any } } } },
        ],
      }
    : undefined;

  if (channelIdentityWhere) {
    where.channelIdentities = {
      some: combineChannelIdentityFilters([
        ...(filters.channelType ? [{ channelType: filters.channelType as any, ...visibleIdentity }] : []),
        channelIdentityWhere,
      ]),
    };
  }

  // 列出的渠道身份只含可見渠道（CM-173）：否則分店帳號會看到其他分店渠道的名稱與 uid。
  // 聯絡人本身依 visibleContactWhere() 過濾：只在其他渠道有身份的聯絡人不列出。
  const visibleChannelId = channelIdWhereFilter(accessibleChannels);
  const visibleWhere = visibleContactWhere(accessibleChannels);
  if (visibleWhere) where.AND = [visibleWhere];
  const includedIdentityWhere = combineIdentityInclude(channelIdentityWhere, visibleChannelId);

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      include: {
        channelIdentities: {
          ...(includedIdentityWhere ? { where: includedIdentityWhere } : {}),
          select: {
            id: true,
            channelType: true,
            uid: true,
            profileName: true,
            channel: {
              select: {
                id: true,
                displayName: true,
                channelType: true,
              },
            },
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
      orderBy: { updatedAt: 'desc' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    }),
    prisma.contact.count({ where }),
  ]);

  return { contacts, total };
}

export async function getContact(
  ctx: TenantCtx,
  id: string,
  /** CM-173 渠道級可見性，必填：呼叫端要明確決定可見範圍，不受限時傳 ALL_CHANNELS（避免新呼叫端漏傳而外洩其他渠道資料） */
  accessibleChannels: AccessibleChannels,
) {
  const { tx: prisma, tenantId } = ctx;
  const contact = await prisma.contact.findFirst({
    where: { id, tenantId },
    include: {
      channelIdentities: {
        // 只回傳可見渠道的身份（CM-173），避免分店看到其他渠道的名稱、uid 與暱稱
        ...visibleIdentityInclude(accessibleChannels),
        include: {
          channel: {
            select: {
              id: true,
              displayName: true,
              channelType: true,
            },
          },
        },
      },
      tags: {
        include: {
          tag: true,
        },
      },
      attributes: true,
    },
  });

  if (!contact || !(await isContactVisible(ctx, id, accessibleChannels))) {
    throw new AppError(notFound('contact'), 'NOT_FOUND', 404);
  }

  return contact;
}

/**
 * 聯絡人在可見渠道有身分、或沒有任何渠道身分且沒有被合併（客服手動建立）時視為看得到
 * （channel-scoped-visibility「聯絡人依渠道身份判斷可見」）。ALL_CHANNELS 回 undefined，不加條件。
 * 已被合併的聯絡人依直接保留方判斷，Prisma 沒有 mergedIntoId 的關聯表達不了，見 isContactVisible()；
 * 這裡只用在本來就排除封存聯絡人的查詢（列表、分眾）。報表以 analytics.service 的 contactSql() 判斷同一套規則。
 */
export function visibleContactWhere(accessibleChannels: AccessibleChannels): Prisma.ContactWhereInput | undefined {
  const channelId = channelIdWhereFilter(accessibleChannels);
  if (!channelId) return undefined;
  return { OR: [{ channelIdentities: { some: { channelId } } }, { channelIdentities: { none: {} }, mergedIntoId: null }] };
}

/** include 渠道身分時只取可見渠道（ALL_CHANNELS 回空物件） */
export function visibleIdentityInclude(accessibleChannels: AccessibleChannels): { where?: { channelId?: { in: string[] } } } {
  const where = channelIdWhere(accessibleChannels);
  return where.channelId ? { where } : {};
}

type VisibilityRow = { mergedIntoId: string | null; channelIdentities: Array<{ channelId: string }> };

async function loadVisibilityRow(ctx: TenantCtx, id: string): Promise<VisibilityRow | null> {
  return ctx.tx.contact.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { mergedIntoId: true, channelIdentities: { select: { channelId: true } } },
  });
}

/** 不看合併：有可見身分，或沒有身分且沒有被合併 */
function directlyVisible(row: VisibilityRow, accessible: Set<string>): boolean {
  if (row.channelIdentities.some((i) => accessible.has(i.channelId))) return true;
  return row.channelIdentities.length === 0 && !row.mergedIntoId;
}

/**
 * 規則同 visibleContactWhere()；已被合併、身分都移走的聯絡人依直接保留方判斷，保留方也已被合併時看不到
 * （只看一層，與報表的 SQL 一致）。不存在的聯絡人回 true，讓呼叫端照原本的流程回 404。
 */
async function isContactVisible(ctx: TenantCtx, contactId: string, accessibleChannels: AccessibleChannels): Promise<boolean> {
  if (accessibleChannels === ALL_CHANNELS) return true;
  const row = await loadVisibilityRow(ctx, contactId);
  if (!row) return true;
  if (directlyVisible(row, accessibleChannels)) return true;
  if (row.channelIdentities.length > 0 || !row.mergedIntoId) return false;
  const survivor = await loadVisibilityRow(ctx, row.mergedIntoId);
  return survivor !== null && directlyVisible(survivor, accessibleChannels);
}

/**
 * 合併、合併預覽與解除合併前的檢查：任一位聯絡人在不可見渠道還有身分、對話或工單時回 403。
 * 合併會搬動兩位聯絡人在所有渠道的資料，包括其他分店的，所以只能由總店處理。
 * 身分被移走或解除綁定後，對話與工單可能還留在其他分店的渠道，所以三者都要檢查。
 */
export async function assertNoOtherChannelIdentities(
  ctx: TenantCtx,
  contactIds: string[],
  accessibleChannels: AccessibleChannels,
): Promise<void> {
  const channelId = channelIdWhereFilter(accessibleChannels);
  if (!channelId) return;
  const otherChannel = { notIn: channelId.in };
  // 同一個交易的查詢依序執行（互動式交易只有一條連線）
  const identity = await ctx.tx.channelIdentity.findFirst({
    where: { contactId: { in: contactIds }, contact: { tenantId: ctx.tenantId }, channelId: otherChannel },
    select: { id: true },
  });
  const conversation = identity ? null : await ctx.tx.conversation.findFirst({
    where: { contactId: { in: contactIds }, tenantId: ctx.tenantId, channelId: otherChannel },
    select: { id: true },
  });
  const caseRow = identity || conversation ? null : await ctx.tx.case.findFirst({
    where: { contactId: { in: contactIds }, tenantId: ctx.tenantId, channelId: otherChannel },
    select: { id: true },
  });
  if (identity || conversation || caseRow) {
    throw new AppError('這位聯絡人在其他分店的渠道也有資料，合併或解除合併請由總店處理', 'CONTACT_HAS_OTHER_CHANNELS', 403);
  }
}

/**
 * 以 ID 讀取或操作聯絡人之前的檢查：任一位看不到就回 404，與聯絡人不存在相同，
 * 不透露這位聯絡人在其他渠道存在（channel-scoped-visibility「單筆讀取與操作的存取檢查」）。
 */
export async function assertContactsVisible(
  ctx: TenantCtx,
  contactIds: string[],
  accessibleChannels: AccessibleChannels,
): Promise<void> {
  for (const id of contactIds) {
    if (!(await isContactVisible(ctx, id, accessibleChannels))) {
      throw new AppError(notFound('contact'), 'NOT_FOUND', 404);
    }
  }
}

export async function updateContact(
  ctx: TenantCtx,
  id: string,
  data: {
    displayName?: string;
    phone?: string | null;
    email?: string | null;
    language?: string;
    isBlocked?: boolean;
    /** email 與其他聯絡人重複時，客服確認仍要儲存（不合併） */
    allowDuplicateEmail?: boolean;
  },
  /** 看不到這位聯絡人時回 404；CM-173：email 撞到的聯絡人只在看不到的渠道有身分時，409 不帶對方的 id 與名稱 */
  accessibleChannels: AccessibleChannels = ALL_CHANNELS,
) {
  const { tx: prisma, tenantId } = ctx;
  const { allowDuplicateEmail, ...fields } = data;
  const contact = await prisma.contact.findFirst({
    where: { id, tenantId },
  });

  if (!contact || !(await isContactVisible(ctx, id, accessibleChannels))) {
    throw new AppError(notFound('contact'), 'NOT_FOUND', 404);
  }

  // email 與同租戶另一位聯絡人相同時先讓客服決定：合併、仍要儲存或取消（change add-email-identity-merge）
  // email 沒有改變（不分大小寫）時不檢查：先前已確認共用的 email，重存時不再詢問
  const emailChanged = (fields.email ?? '').toLowerCase() !== (contact.email ?? '').toLowerCase();
  if (fields.email && emailChanged && !allowDuplicateEmail) {
    const other = await prisma.contact.findFirst({
      where: { tenantId, isArchived: false, id: { not: id }, email: { equals: fields.email, mode: 'insensitive' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, displayName: true },
    });
    if (other) {
      const visible = await isContactVisible(ctx, other.id, accessibleChannels);
      throw new AppError(
        '此 email 已由其他聯絡人使用',
        'EMAIL_IN_USE',
        409,
        visible ? { contactId: other.id, displayName: other.displayName } : undefined,
      );
    }
  }

  const updated = await prisma.contact.update({
    where: { id },
    data: fields,
    include: {
      channelIdentities: {
        ...visibleIdentityInclude(accessibleChannels),
        select: {
          id: true,
          channelType: true,
          uid: true,
          profileName: true,
        },
      },
      tags: {
        include: {
          tag: true,
        },
      },
    },
  });

  return updated;
}

/**
 * 聯絡人在所有可見渠道的訊息，依時間排成一條（change add-email-identity-merge，design D9）。
 * 每頁取最新的 limit 則、以由舊到新回傳；`before` 為上一頁回傳的 nextCursor。
 * 看不到的渠道只回傳對話數量，不回傳內容或渠道名稱。
 */
export async function getContactMessages(
  ctx: TenantCtx,
  contactId: string,
  accessibleChannels: AccessibleChannels,
  opts: { before?: string; limit: number },
) {
  const { tx: prisma, tenantId } = ctx;
  const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId }, select: { id: true } });
  if (!contact) throw new AppError(notFound('contact'), 'NOT_FOUND', 404);

  const channelId = channelIdWhereFilter(accessibleChannels);
  const cursor = parseMessageCursor(opts.before);

  const [rows, hiddenConversationCount] = await Promise.all([
    prisma.message.findMany({
      where: {
        conversation: { contactId, tenantId, ...(channelId ? { channelId } : {}) },
        ...olderThanCursor(cursor),
      },
      orderBy: MESSAGE_NEWEST_FIRST,
      take: opts.limit + 1,
      select: {
        id: true,
        conversationId: true,
        direction: true,
        senderType: true,
        contentType: true,
        content: true,
        createdAt: true,
        conversation: { select: { channelId: true, channelType: true, channel: { select: { displayName: true } } } },
      },
    }),
    channelId
      ? prisma.conversation.count({ where: { contactId, tenantId, channelId: { notIn: channelId.in } } })
      : Promise.resolve(0),
  ]);

  const page = rows.slice(0, opts.limit);
  const oldest = page.at(-1);
  return {
    messages: page.reverse().map(({ conversation, ...m }) => ({
      ...m,
      channelId: conversation.channelId,
      channelType: conversation.channelType,
      channelName: conversation.channel.displayName,
    })),
    hiddenConversationCount,
    nextCursor: rows.length > opts.limit && oldest ? encodeMessageCursor(oldest.createdAt, oldest.id) : null,
  };
}

export async function getContactConversations(
  ctx: TenantCtx,
  contactId: string,
  page: number,
  limit: number,
  /** CM-173 渠道級可見性，必填：呼叫端要明確決定可見範圍，不受限時傳 ALL_CHANNELS（避免新呼叫端漏傳而外洩其他渠道資料） */
  accessibleChannels: AccessibleChannels,
) {
  const { tx: prisma, tenantId } = ctx;
  const channelId = channelIdWhereFilter(accessibleChannels);
  const where: Prisma.ConversationWhereInput = {
    contactId,
    tenantId,
    ...(channelId ? { channelId } : {}),
  };

  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      include: {
        channel: {
          select: {
            id: true,
            displayName: true,
            channelType: true,
          },
        },
        assignedTo: {
          select: {
            id: true,
            name: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            contentType: true,
            content: true,
            direction: true,
            senderType: true,
            createdAt: true,
          },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.conversation.count({ where }),
  ]);
  // 看不到的渠道只給數量（收件匣顯示「另有 N 段其他渠道的對話」），不給內容或渠道名稱
  const hiddenCount = channelId
    ? await prisma.conversation.count({ where: { contactId, tenantId, channelId: { notIn: channelId.in } } })
    : 0;

  const result = conversations.map((conv) => {
    const { messages, ...rest } = conv;
    return {
      ...rest,
      lastMessage: messages[0] ?? null,
    };
  });

  return { conversations: result, total, hiddenCount };
}

export async function getContactCases(
  ctx: TenantCtx,
  contactId: string,
  page: number,
  limit: number,
  /** CM-173 渠道級可見性，必填：呼叫端要明確決定可見範圍，不受限時傳 ALL_CHANNELS（避免新呼叫端漏傳而外洩其他渠道資料） */
  accessibleChannels: AccessibleChannels,
) {
  const { tx: prisma, tenantId } = ctx;
  const channelId = channelIdWhereFilter(accessibleChannels);
  const where: Prisma.CaseWhereInput = {
    contactId,
    tenantId,
    ...(channelId ? { channelId } : {}),
  };

  const [cases, total] = await Promise.all([
    prisma.case.findMany({
      where,
      include: {
        assignee: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.case.count({ where }),
  ]);

  return { cases, total };
}

export interface TimelineEntry {
  type: 'conversation' | 'case' | 'case_event' | 'tag';
  timestamp: string;
  data: Record<string, unknown>;
}

export async function getContactTimeline(
  ctx: TenantCtx,
  contactId: string,
  /** CM-173 渠道級可見性，必填：呼叫端要明確決定可見範圍，不受限時傳 ALL_CHANNELS（避免新呼叫端漏傳而外洩其他渠道資料） */
  accessibleChannels: AccessibleChannels,
) {
  const { tx: prisma, tenantId } = ctx;
  const channelId = channelIdWhereFilter(accessibleChannels);
  const channelFilter = channelId ? { channelId } : {};
  // Verify contact exists
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
  });
  if (!contact) {
    throw new AppError(notFound('contact'), 'NOT_FOUND', 404);
  }

  // Fetch conversations, cases, case events, and tags in parallel
  const [conversations, cases, contactTags] = await Promise.all([
    prisma.conversation.findMany({
      where: { contactId, tenantId, ...channelFilter },
      select: {
        id: true,
        channelType: true,
        status: true,
        createdAt: true,
        channel: {
          select: { displayName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.case.findMany({
      where: { contactId, tenantId, ...channelFilter },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        createdAt: true,
        events: {
          select: {
            id: true,
            eventType: true,
            payload: true,
            actorType: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.contactTag.findMany({
      where: { contactId },
      include: {
        tag: {
          select: { name: true, color: true, type: true },
        },
      },
      orderBy: { addedAt: 'desc' },
    }),
  ]);

  const timeline: TimelineEntry[] = [];

  // Add conversation entries
  for (const conv of conversations) {
    timeline.push({
      type: 'conversation',
      timestamp: conv.createdAt.toISOString(),
      data: {
        id: conv.id,
        channelType: conv.channelType,
        status: conv.status,
        channelName: conv.channel.displayName,
      },
    });
  }

  // Add case entries and their events
  for (const c of cases) {
    timeline.push({
      type: 'case',
      timestamp: c.createdAt.toISOString(),
      data: {
        id: c.id,
        title: c.title,
        status: c.status,
        priority: c.priority,
      },
    });

    for (const event of c.events) {
      timeline.push({
        type: 'case_event',
        timestamp: event.createdAt.toISOString(),
        data: {
          id: event.id,
          caseId: c.id,
          caseTitle: c.title,
          eventType: event.eventType,
          payload: event.payload as Record<string, unknown>,
          actorType: event.actorType,
        },
      });
    }
  }

  // Add tag entries
  for (const ct of contactTags) {
    timeline.push({
      type: 'tag',
      timestamp: ct.addedAt.toISOString(),
      data: {
        id: ct.id,
        tagName: ct.tag.name,
        tagColor: ct.tag.color,
        tagType: ct.tag.type,
        addedBy: ct.addedBy,
      },
    });
  }

  // Sort by timestamp descending (most recent first)
  timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return timeline;
}

export async function getMergePreview(
  ctx: TenantCtx,
  primaryId: string,
  secondaryId: string,
  /** 渠道身分、對話數與工單數只計可見渠道（channel-scoped-visibility）；必填，避免新呼叫端漏傳 */
  accessibleChannels: AccessibleChannels,
) {
  const { tx: prisma, tenantId } = ctx;
  // 看不到的聯絡人先回 404，與不存在相同，不以 403 透露它在其他分店有資料
  await assertContactsVisible(ctx, [primaryId, secondaryId], accessibleChannels);
  // 預覽要與實際合併一致：其他分店渠道還有資料時不預覽（合併也會擋），兩位的資料因此都在可見範圍內
  await assertNoOtherChannelIdentities(ctx, [primaryId, secondaryId], accessibleChannels);
  const [primary, secondary] = await Promise.all([
    prisma.contact.findFirst({
      where: { id: primaryId, tenantId },
      include: {
        channelIdentities: {
          ...visibleIdentityInclude(accessibleChannels),
          select: { id: true, channelType: true, uid: true, profileName: true, channelId: true },
        },
        tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        attributes: { select: { id: true, key: true, value: true } },
        _count: { select: { conversations: true, cases: true } },
      },
    }),
    prisma.contact.findFirst({
      where: { id: secondaryId, tenantId },
      include: {
        channelIdentities: {
          ...visibleIdentityInclude(accessibleChannels),
          select: { id: true, channelType: true, uid: true, profileName: true, channelId: true },
        },
        tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        attributes: { select: { id: true, key: true, value: true } },
        _count: { select: { conversations: true, cases: true } },
      },
    }),
  ]);

  if (!primary) throw new AppError(notFound('primaryContact'), 'NOT_FOUND', 404);
  if (!secondary) throw new AppError(notFound('secondaryContact'), 'NOT_FOUND', 404);
  if (secondary.isArchived) throw new AppError('次要聯絡人已被封存或合併，無法再次合併', 'BAD_REQUEST', 400);

  // Channel identities: secondary has but primary doesn't (by channelType)
  const primaryChannelTypes = new Set(primary.channelIdentities.map((ci) => ci.channelType));
  const newChannelIdentities = secondary.channelIdentities.filter(
    (ci) => !primaryChannelTypes.has(ci.channelType),
  );

  // Tags: secondary has but primary doesn't (by tagId)
  const primaryTagIds = new Set(primary.tags.map((t) => t.tag.id));
  const newTags = secondary.tags.filter((t) => !primaryTagIds.has(t.tag.id));

  // Attributes: secondary has but primary doesn't (by key)
  const primaryAttrKeys = new Set(primary.attributes.map((a) => a.key));
  const newAttributes = secondary.attributes.filter((a) => !primaryAttrKeys.has(a.key));

  return {
    primary: {
      id: primary.id,
      displayName: primary.displayName,
      phone: primary.phone,
      email: primary.email,
      avatarUrl: primary.avatarUrl,
      channelIdentities: primary.channelIdentities,
      tags: primary.tags.map((t) => t.tag),
      attributes: primary.attributes,
      conversationsCount: primary._count.conversations,
      casesCount: primary._count.cases,
    },
    secondary: {
      id: secondary.id,
      displayName: secondary.displayName,
      phone: secondary.phone,
      email: secondary.email,
      avatarUrl: secondary.avatarUrl,
      channelIdentities: secondary.channelIdentities,
      tags: secondary.tags.map((t) => t.tag),
      attributes: secondary.attributes,
      conversationsCount: secondary._count.conversations,
      casesCount: secondary._count.cases,
    },
    diff: {
      newChannelIdentities,
      newTags: newTags.map((t) => t.tag),
      newAttributes,
      totalConversations: primary._count.conversations + secondary._count.conversations,
      totalCases: primary._count.cases + secondary._count.cases,
    },
  };
}

/**
 * 鎖住要合併的聯絡人列（SELECT … FOR UPDATE，依 id 排序避免死結），到交易結束為止。
 * 新增或搬入渠道身分、對話時，外鍵會對聯絡人列取 KEY SHARE 鎖，與 FOR UPDATE 衝突而等待，
 * 所以 assertNoOtherChannelIdentities() 檢查之後，其他分店的資料不會在合併前掛上來。
 * 合併引擎自己的條件式更新取的是 NO KEY UPDATE 鎖，擋不住這種新增。
 */
export async function lockContactsForMerge(ctx: TenantCtx, contactIds: string[]): Promise<void> {
  const ids = [...new Set(contactIds)].sort();
  await ctx.tx.$queryRaw`
    SELECT id FROM contacts
    WHERE id = ANY(${ids}::uuid[]) AND "tenantId" = ${ctx.tenantId}::uuid
    ORDER BY id
    FOR UPDATE`;
}

/**
 * 解除合併前的檢查（在 revertMerge 的同一個交易內）：兩方任一看不到回 404，
 * 任一在其他分店的渠道還有資料回 403。找不到紀錄時不處理，讓 revertMerge 回 404。
 */
export async function assertMergeLogVisible(
  ctx: TenantCtx,
  mergeLogId: string,
  accessibleChannels: AccessibleChannels,
): Promise<void> {
  if (accessibleChannels === ALL_CHANNELS) return;
  const log = await ctx.tx.contactMergeLog.findFirst({
    where: { id: mergeLogId, tenantId: ctx.tenantId },
    select: { survivorId: true, mergedId: true },
  });
  if (!log) return;
  await assertMergeAllowed(ctx, [log.survivorId, log.mergedId], accessibleChannels);
}

/**
 * 分店成員合併或解除合併前的完整檢查，要在合併的同一個交易內呼叫：先鎖住雙方（lockContactsForMerge），
 * 再檢查看得到（否則 404）、沒有其他分店渠道的資料（否則 403）。總店不檢查也不加鎖。
 * 新的合併入口一律呼叫這個函式，不要分開呼叫各項檢查而漏掉鎖。
 */
export async function assertMergeAllowed(
  ctx: TenantCtx,
  contactIds: string[],
  accessibleChannels: AccessibleChannels,
): Promise<void> {
  if (accessibleChannels === ALL_CHANNELS) return;
  await lockContactsForMerge(ctx, contactIds);
  await assertContactsVisible(ctx, contactIds, accessibleChannels);
  await assertNoOtherChannelIdentities(ctx, contactIds, accessibleChannels);
}
