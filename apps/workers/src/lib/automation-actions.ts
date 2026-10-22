import type { PrismaClient } from '@prisma/client';
import type { Redis as IORedis } from 'ioredis';
import type { ChannelPlugin } from '@open333crm/channel-plugins';
import { bumpSlaPriority, CASE_CATEGORIES } from '@open333crm/shared';
import { claimSideEffect, dispatchOutboxRows, logger, writeOutbox, type OutboxRow } from '@open333crm/core';
import { publishSocketEvent } from './socket-bridge.js';
import { enqueueNotification } from './notification-queue.js';
import { deliverToChannelFromWorker, recordSkippedDelivery, renderTemplateBody } from './channel-delivery.js';
import { resolveMaterialVariables, stripUnresolvedPlaceholders } from './material-variables.js';
import { couponIssuedViaForTrigger, issueCouponForRule } from './rule-coupon-issue.js';

export interface WorkerAutomationAction {
  type: string;
  params?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

export interface WorkerActionContext {
  tenantId: string;
  /** 觸發事件的 id。有值時每個動作執行前以 automation_action 認領；SLA 排程沒有事件 id，不認領 */
  eventId?: string | null;
  /** 動作所屬的規則，認領的子鍵是 <規則 id>#<動作序號> */
  ruleId?: string | null;
  /** 規則名稱：發券的來源名稱存發券當下的名稱，規則之後改名仍顯示原名（design D27） */
  ruleName?: string | null;
  caseId?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
  trigger?: string | null;
  replyToken?: string | null;
  receivedAt?: string | null;
  assigneeId?: string | null;
  title?: string | null;
  // 送 channel 訊息（send_message / send_material）需要 plugin registry + redis
  pluginRegistry?: Map<string, ChannelPlugin>;
}

/** 帶回覆權杖的觸發：收到訊息命中關鍵字、加入好友（design D25）。LINE 在 30 秒內以回覆方式送出 */
const REPLY_TRIGGERS: ReadonlySet<string> = new Set(['keyword.matched', 'contact.followed']);

function keywordReplyDelivery(context: WorkerActionContext) {
  return context.trigger && REPLY_TRIGGERS.has(context.trigger) && context.replyToken
    ? { strategy: 'reply' as const, replyToken: context.replyToken, receivedAt: context.receivedAt ?? undefined }
    : undefined;
}

async function getSupervisorAndAdminIds(
  prisma: PrismaClient,
  tenantId: string,
): Promise<string[]> {
  const agents = await prisma.agent.findMany({
    where: {
      tenantId,
      role: { in: ['SUPERVISOR', 'ADMIN'] },
      isActive: true,
    },
    select: { id: true },
  });
  return agents.map((agent) => agent.id);
}

// 自動化「通知」動作的站內通知文案（S12：原本是英文「SLA rule matched」）。
// SLA 與一般自動化規則共用這兩個動作，所以標題不寫 SLA
const AUTOMATION_NOTIFY_TITLE = '自動化規則通知';
const AUTOMATION_NOTIFY_DEFAULT_BODY = '自動化規則的條件已成立，請查看相關工單。';

/**
 * 「傳送通知」的收件人（change fix-automation-rule-gaps）。依序取第一個「同租戶、啟用中」的客服：
 * 指定的客服 → 工單負責人 → 對話負責客服；都不合格時送所有主管與管理員。
 * 原本只送工單負責人，沒有工單的觸發選了這個動作永遠不會送（問題清單 A03）。
 * 每個候選都要驗證：工單或對話可能留著已停用客服的指派，不可送給他們（review #282）。
 * worker 走 BYPASSRLS 連線：每個查詢都要自帶 tenantId。
 */
async function resolveNotifyRecipients(
  prisma: PrismaClient,
  params: Record<string, unknown>,
  context: WorkerActionContext,
): Promise<string[]> {
  const { tenantId } = context;
  const findActiveAgent = async (id: string | null | undefined, source: string): Promise<string | null> => {
    if (!id) return null;
    const agent = await prisma.agent.findFirst({
      where: { id, tenantId, isActive: true },
      select: { id: true },
    });
    if (!agent) logger.warn(`[automation] notify: ${source} ${id} is inactive or not in tenant, falling back`);
    return agent?.id ?? null;
  };

  const chosen = typeof params['agentId'] === 'string' ? params['agentId'].trim() : '';
  const chosenAgent = await findActiveAgent(chosen, 'chosen agent');
  if (chosenAgent) return [chosenAgent];

  const caseAssignee = await findActiveAgent(context.assigneeId, 'case assignee');
  if (caseAssignee) return [caseAssignee];

  if (context.conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: context.conversationId, tenantId },
      select: { assignedToId: true },
    });
    const conversationAssignee = await findActiveAgent(conversation?.assignedToId, 'conversation assignee');
    if (conversationAssignee) return [conversationAssignee];
  }
  const fallback = await getSupervisorAndAdminIds(prisma, tenantId);
  if (fallback.length === 0) logger.warn('[automation] notify skipped: no recipient in tenant', { tenantId });
  return fallback;
}

const CASE_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
/** 已結案的工單：對話上掛的是這種工單時，自動化可以開新單並改關聯 */
const CLOSED_CASE_STATUSES = new Set(['RESOLVED', 'CLOSED']);

/**
 * create_case：條件命中時自動建立工單（AUDIT AUTO-01 補實作）。行為與手動「由對話建立工單」一致：
 * 依優先度套 SLA 政策、對話關聯到新工單、寫入工單事件（actorType automation）、即時推播，
 * 並經 domain event 橋接發出 case.created，讓通知與「工單建立」觸發的規則照常運作。
 *
 * 不建立的情況（皆留 warn）：
 *   - 觸發事件是工單或 SLA 相關：工單已存在，而且「工單建立 → 建立工單」會無限迴圈
 *   - 沒有對話：工單的渠道取自對話
 *   - 對話已關聯未結案的工單：不重複開，避免顧客一直傳訊息就開一堆工單
 * 成功時回傳新工單 id，呼叫端寫回 context.caseId。目前契約不允許訊息類事件使用工單動作（指派、改狀態需要 case 範圍），
 * 寫回只是讓日後開放時，後續動作能作用在新工單上。
 */
async function createCaseFromAutomation(
  prisma: PrismaClient,
  redisPublisher: IORedis,
  params: Record<string, unknown>,
  context: WorkerActionContext,
): Promise<string | null> {
  const { tenantId } = context;
  if (context.trigger && /^(case|sla)\./.test(context.trigger)) {
    logger.warn(`[automation] create_case skipped: trigger "${context.trigger}" is a case/SLA event`);
    return null;
  }
  const title = typeof params['title'] === 'string' ? params['title'].trim() : '';
  if (!title || !context.conversationId) {
    logger.warn('[automation] create_case skipped: missing title or conversation', { tenantId });
    return null;
  }

  // worker 走 BYPASSRLS 連線：每個查詢都要自帶 tenantId
  const conversation = await prisma.conversation.findFirst({
    where: { id: context.conversationId, tenantId },
    select: { id: true, contactId: true, channelId: true, caseId: true },
  });
  if (!conversation) {
    logger.warn('[automation] create_case skipped: conversation not found in tenant', { tenantId });
    return null;
  }
  if (conversation.caseId) {
    const existing = await prisma.case.findFirst({
      where: { id: conversation.caseId, tenantId },
      select: { id: true, status: true },
    });
    if (existing && !CLOSED_CASE_STATUSES.has(existing.status)) {
      logger.info(`[automation] create_case skipped: conversation already has open case ${existing.id}`);
      return existing.id;
    }
  }

  const priority =
    typeof params['priority'] === 'string' && CASE_PRIORITIES.has(params['priority']) ? params['priority'] : 'MEDIUM';
  // 分類只收系統清單內的值（與手動建單的驗證一致）；不合法就不寫分類，工單照開
  const rawCategory = typeof params['category'] === 'string' ? params['category'].trim() : '';
  const category = (CASE_CATEGORIES as readonly string[]).includes(rawCategory) ? rawCategory : null;
  if (rawCategory && !category) logger.warn(`[automation] create_case: unknown category "${rawCategory}" ignored`);
  // 與手動建單一致：預設政策優先，沒有預設時取最早建立的（G20，AUDIT SLA-03）
  const slaPolicy = await prisma.slaPolicy.findFirst({
    where: { tenantId, priority: priority as any },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  const slaDueAt = slaPolicy ? new Date(Date.now() + slaPolicy.resolutionMinutes * 60_000) : null;

  // 建單、關聯對話、寫事件放在同一個交易；關聯用條件式更新（對話仍是讀取時的狀態才寫入）：
  // 多個 worker 同時處理同一段對話（例如 message.received 與 keyword.matched 兩個 job）時，
  // 後到的會因條件不成立而回滾，不會開出兩張工單，也不會留下沒有對話的孤兒工單
  const RACED = 'create_case_raced';
  let created: { id: string };
  let outboxRow: OutboxRow;
  try {
    ({ created, outboxRow } = await prisma.$transaction(async (tx) => {
      const c = await tx.case.create({
        data: {
          tenantId,
          contactId: conversation.contactId,
          channelId: conversation.channelId,
          title,
          priority: priority as any,
          category,
          status: 'OPEN',
          slaPolicy: slaPolicy?.name ?? null,
          slaDueAt,
        },
      });
      const linked = await tx.conversation.updateMany({
        where: { id: conversation.id, tenantId, OR: [{ caseId: conversation.caseId }] },
        data: { caseId: c.id },
      });
      if (linked.count !== 1) throw new Error(RACED);
      await tx.caseEvent.create({
        data: {
          caseId: c.id,
          actorType: 'automation',
          actorId: null,
          eventType: 'created',
          payload: { title, priority, category, trigger: context.trigger ?? null },
        },
      });
      // case.created 與工單一起 commit（event-delivery「workers 的事件與資料一起 commit」）
      const row = await writeOutbox(tx, {
        tenantId,
        kind: 'event',
        name: 'case.created',
        payload: {
          caseId: c.id,
          contactId: conversation.contactId,
          channelId: conversation.channelId,
          title,
          priority,
          status: 'OPEN',
          conversationId: conversation.id,
        },
      });
      return { created: c, outboxRow: row };
    }));
  } catch (err) {
    if (err instanceof Error && err.message === RACED) {
      logger.info('[automation] create_case skipped: conversation was linked to a case concurrently');
      return null;
    }
    throw err;
  }

  await publishSocketEvent(redisPublisher, `tenant:${tenantId}`, 'case.created', {
    id: created.id,
    status: 'OPEN',
    priority,
    assigneeId: null,
    title,
  });
  await dispatchAfterCommit(prisma, outboxRow);
  return created.id;
}

const CHANNEL_LABELS: Record<string, string> = { line: 'LINE', fb: 'Facebook', threads: 'Instagram', webchat: '網頁聊天' };
const channelLabel = (channelType: string) => CHANNEL_LABELS[channelType] ?? channelType;

/**
 * commit 之後的快路徑：送進訂閱者佇列。失敗只記 log，資料列留在 outbox，由 API 的 outbox-relay 補送
 * （API 沒有在執行時也一樣，event-delivery「API 行程沒有在執行」）。
 */
async function dispatchAfterCommit(prisma: PrismaClient, row: OutboxRow) {
  await dispatchOutboxRows(prisma, [row]).catch((err) => logger.warn(`[automation] outbox dispatch failed (${row.name})`, err));
}

/** 以 automation_action + 事件 id + <規則 id>#<動作序號> 認領 */
async function claimAction(prisma: PrismaClient, context: WorkerActionContext, actionKey: string): Promise<boolean> {
  return prisma.$transaction((tx) =>
    claimSideEffect(tx, { tenantId: context.tenantId, kind: 'automation_action', sourceId: context.eventId!, subKey: actionKey }),
  );
}

/** notify 的 job id：<事件 id>__<規則 id>#<序號>__<客服人員 id>。沒有事件 id（SLA 路徑）時不指定 */
function notifyJobOptions(context: WorkerActionContext, actionKey: string | null, agentId: string) {
  return actionKey ? { jobId: `${context.eventId}__${actionKey}__${agentId}` } : undefined;
}

export async function executeWorkerAutomationActions(
  prisma: PrismaClient,
  redisPublisher: IORedis,
  actions: WorkerAutomationAction[],
  context: WorkerActionContext,
): Promise<void> {
  for (const [index, action] of actions.entries()) {
    // 同一個事件的同一個動作最多執行一次（automation-engine「規則動作每個事件最多執行一次」）。
    // 認領在 try 之外：認領的交易失敗時丟錯，由佇列重試（side-effect-claims「認領 commit 之前的失敗由佇列重試」）。
    // 認領之後執行失敗也不還原、只記 log：送出訊息這類動作寧可少做，不重複做
    const actionKey = context.eventId && context.ruleId ? `${context.ruleId}#${index}` : null;
    if (actionKey && !(await claimAction(prisma, context, actionKey))) {
      logger.info(`[automation] Worker action "${action.type}" skipped: already executed for event ${context.eventId} (${actionKey})`);
      continue;
    }
    try {
      const params = action.params ?? action.payload ?? {};

      if (action.type === 'create_case') {
        const caseId = await createCaseFromAutomation(prisma, redisPublisher, params, context);
        if (caseId) context.caseId = caseId;
        continue;
      }

      if (action.type === 'assign_agent') {
        const agentId = params['agentId'];
        if (typeof agentId === 'string' && agentId && context.caseId) {
          await prisma.case.update({
            where: { id: context.caseId },
            data: { assigneeId: agentId },
          });
          await publishSocketEvent(redisPublisher, `tenant:${context.tenantId}`, 'case.updated', {
            id: context.caseId,
            assigneeId: agentId,
            source: 'sla_worker',
          });
        }
        continue;
      }

      if (action.type === 'add_tag') {
        // 對觸發對象（聯絡人）加標籤。前端存 tagName（標籤名稱），也相容 tagId。
        // 缺 contactId 或標籤資訊則安全跳過。
        const rawTagId = params['tagId'];
        const rawTagName = params['tagName'];
        const tagId = typeof rawTagId === 'string' && rawTagId ? rawTagId : null;
        const tagName = typeof rawTagName === 'string' && rawTagName.trim() ? rawTagName.trim() : null;
        if (!tagId && !tagName) {
          logger.info('[automation] Worker action "add_tag" skipped: missing tagId/tagName');
          continue;
        }
        if (!context.contactId) {
          logger.info('[automation] Worker action "add_tag" skipped: no contact in context');
          continue;
        }
        // 解析出本租戶的 tag：優先用 tagId，否則依名稱找、找不到則建立（同租戶自動化常態）
        let tag = tagId
          ? await prisma.tag.findFirst({ where: { id: tagId, tenantId: context.tenantId }, select: { id: true, name: true } })
          : await prisma.tag.findFirst({ where: { name: tagName!, tenantId: context.tenantId }, select: { id: true, name: true } });
        if (!tag && tagName) {
          tag = await prisma.tag.create({
            data: { tenantId: context.tenantId, name: tagName },
            select: { id: true, name: true },
          });
        }
        if (!tag) {
          logger.info('[automation] Worker action "add_tag" skipped: tag not found in tenant');
          continue;
        }
        // 冪等貼標（upsert，對齊 tagging.service 語意；worker 跨 process 無法 import api service）。
        // contact.tagged 與貼標一起 commit（source='automation'，供下游規則；迴圈防護在 api 的自動化訂閱者）
        const contactId = context.contactId;
        const tagged = tag;
        const outboxRow = await prisma.$transaction(async (tx) => {
          await tx.contactTag.upsert({
            where: { contactId_tagId: { contactId, tagId: tagged.id } },
            update: {},
            create: { contactId, tagId: tagged.id, addedBy: 'automation' },
          });
          return writeOutbox(tx, {
            tenantId: context.tenantId,
            kind: 'event',
            name: 'contact.tagged',
            payload: { contactId, tagId: tagged.id, tagName: tagged.name, source: 'automation' },
          });
        });
        logger.info(`[automation] add_tag: tagged contact ${contactId} with ${tagged.id}`);
        await dispatchAfterCommit(prisma, outboxRow);
        continue;
      }

      if (action.type === 'remove_tag') {
        // 移除觸發對象（聯絡人）身上、本租戶、ID 或名稱相符的標籤。和 add_tag 不同：找不到時什麼都不做、不建立標籤。
        // 不限 scope：add_tag 依名稱找標籤時不分 scope（AUDIT AUTO-03），它貼上的標籤要能用同名的 remove_tag 移除
        const rawTagId = params['tagId'];
        const rawTagName = params['tagName'];
        const tagId = typeof rawTagId === 'string' && rawTagId ? rawTagId : null;
        const tagName = typeof rawTagName === 'string' && rawTagName.trim() ? rawTagName.trim() : null;
        if (!tagId && !tagName) {
          logger.info('[automation] Worker action "remove_tag" skipped: missing tagId/tagName');
          continue;
        }
        if (!context.contactId) {
          logger.info('[automation] Worker action "remove_tag" skipped: no contact in context');
          continue;
        }
        const removed = await prisma.contactTag.deleteMany({
          where: tagId
            ? { contactId: context.contactId, tagId, tag: { tenantId: context.tenantId } }
            : { contactId: context.contactId, tag: { tenantId: context.tenantId, name: tagName! } },
        });
        logger.info(`[automation] remove_tag: removed ${removed.count} tag(s) from contact ${context.contactId}`);
        continue;
      }

      if (action.type === 'update_case_status') {
        const status = params['status'];
        if (typeof status === 'string' && status && context.caseId) {
          await prisma.case.update({
            where: { id: context.caseId },
            data: { status: status as any },
          });
          await publishSocketEvent(redisPublisher, `tenant:${context.tenantId}`, 'case.updated', {
            id: context.caseId,
            status,
            source: 'sla_worker',
          });
        }
        continue;
      }

      if (action.type === 'escalate_case' || action.type === 'set_case_priority') {
        if (!context.caseId) {
          logger.info(`[automation] Worker action "${action.type}" skipped: missing caseId`);
          continue;
        }

        const current = await prisma.case.findUnique({
          where: { id: context.caseId },
          select: { priority: true },
        });
        if (!current) continue;

        const configuredPriority = params['newPriority'] ?? params['priority'];
        const newPriority =
          typeof configuredPriority === 'string' && configuredPriority
            ? configuredPriority
            : bumpSlaPriority(current.priority);

        await prisma.case.update({
          where: { id: context.caseId },
          data: { priority: newPriority as any },
        });
        await publishSocketEvent(redisPublisher, `tenant:${context.tenantId}`, 'case.updated', {
          id: context.caseId,
          priority: newPriority,
          source: 'sla_worker',
        });
        continue;
      }

      if (action.type === 'notify') {
        const recipients = await resolveNotifyRecipients(prisma, params, context);
        for (const agentId of recipients) {
          await enqueueNotification({
            tenantId: context.tenantId,
            agentId,
            type: 'sla_rule',
            title: AUTOMATION_NOTIFY_TITLE,
            body: String(params['message'] ?? AUTOMATION_NOTIFY_DEFAULT_BODY),
            clickUrl: context.caseId
              ? `/dashboard/cases/${context.caseId}`
              : context.conversationId
                ? `/dashboard/inbox?conv=${context.conversationId}`
                : undefined,
          }, notifyJobOptions(context, actionKey, agentId));
        }
        continue;
      }

      if (action.type === 'notify_supervisor') {
        const agentIds = await getSupervisorAndAdminIds(prisma, context.tenantId);
        for (const agentId of agentIds) {
          await enqueueNotification({
            tenantId: context.tenantId,
            agentId,
            type: 'sla_rule',
            title: AUTOMATION_NOTIFY_TITLE,
            body: String(params['message'] ?? AUTOMATION_NOTIFY_DEFAULT_BODY),
            clickUrl: context.caseId ? `/dashboard/cases/${context.caseId}` : undefined,
          }, notifyJobOptions(context, actionKey, agentId));
        }
        continue;
      }

      // ── OUTBOUND actions（需 conversationId + pluginRegistry，主要用於 keyword.matched 對話回覆）──

      if (action.type === 'send_message') {
        if (!context.conversationId || !context.pluginRegistry) {
          logger.info('[automation] send_message skipped: missing conversationId/pluginRegistry');
          continue;
        }
        const text = String(params['text'] ?? params['message'] ?? '');
        if (!text) {
          logger.info('[automation] send_message skipped: empty text');
          continue;
        }
        await deliverToChannelFromWorker(
          prisma,
          redisPublisher,
          context.pluginRegistry,
          context.conversationId,
          { contentType: 'text', content: { text }, delivery: keywordReplyDelivery(context) },
        );
        continue;
      }

      if (action.type === 'send_material') {
        if (!context.conversationId || !context.pluginRegistry) {
          logger.info('[automation] send_material skipped: missing conversationId/pluginRegistry');
          continue;
        }
        const materialId = params['materialId'];
        if (typeof materialId !== 'string' || !materialId) {
          logger.info('[automation] send_material skipped: missing materialId');
          continue;
        }
        const material = await prisma.material.findFirst({
          where: { id: materialId, tenantId: context.tenantId },
          select: { name: true, contentType: true, body: true, channelType: true, variables: true },
        });
        if (!material) {
          logger.warn(`[automation] send_material skipped: material ${materialId} not found`);
          continue;
        }

        // channel 防呆：素材 channelType 與對話 channel 不符就 skip（避免 FB 對話送 line_* 空訊息）
        const conv = await prisma.conversation.findFirst({
          where: { id: context.conversationId, tenantId: context.tenantId },
          include: { channel: { select: { channelType: true } } },
        });
        const convChannelType = conv?.channel?.channelType?.toLowerCase();
        const matChannelType = material.channelType?.toLowerCase();
        if (convChannelType && matChannelType && convChannelType !== matChannelType) {
          logger.warn(
            `[automation] send_material skipped: material channel "${matChannelType}" != conversation channel "${convChannelType}"`,
          );
          // 只寫 log 的話收件匣看不出規則有觸發卻沒送（change fix-keyword-yield-ig-delivery）
          if (conv) {
            await recordSkippedDelivery(
              prisma,
              redisPublisher,
              conv,
              { contentType: 'text', content: { text: `自動化規則的素材「${material.name ?? ''}」` } },
              `素材是 ${channelLabel(matChannelType)} 素材，這個對話是 ${channelLabel(convChannelType)}，沒有送出`,
            );
          }
          continue;
        }

        // 變數用對話聯絡人的資料代入（比照廣播），缺值用素材預設值，仍沒有值的留空，
        // 不把 {{contact.name}} 原樣送給客人
        const variables = await resolveMaterialVariables(prisma, {
          tenantId: context.tenantId,
          contactId: context.contactId ?? conv?.contactId ?? null,
          materialVariables: material.variables,
          ruleVariables: params['variables'] as Record<string, string> | undefined,
        });
        const renderedBody = stripUnresolvedPlaceholders(
          renderTemplateBody(material.body as Record<string, unknown>, variables),
        );
        await deliverToChannelFromWorker(
          prisma,
          redisPublisher,
          context.pluginRegistry,
          context.conversationId,
          { contentType: material.contentType, content: renderedBody, delivery: keywordReplyDelivery(context) },
        );
        continue;
      }

      /**
       * 自動發券（design D16、D25～D27）：保留 → 送出 → 確認／作廢，沒發出時在對話留下紀錄。
       * 流程在 rule-coupon-issue.ts，加好友禮重用同一個函式。
       */
      if (action.type === 'issue_coupon') {
        if (!context.conversationId || !context.pluginRegistry) {
          // 沒有對話就沒有地方留下紀錄；契約要求 conversation 範圍，正常不會走到這裡
          logger.warn('[automation] issue_coupon skipped: missing conversationId/pluginRegistry', { tenantId: context.tenantId });
          continue;
        }
        const couponId = typeof params['couponId'] === 'string' ? params['couponId'] : '';
        const failureText = typeof params['failureText'] === 'string' ? params['failureText'] : null;
        await issueCouponForRule(prisma, redisPublisher, {
          tenantId: context.tenantId,
          conversationId: context.conversationId,
          contactId: context.contactId,
          couponId,
          failureText,
          rule: { id: context.ruleId ?? null, name: context.ruleName ?? null },
          issuedVia: couponIssuedViaForTrigger(context.trigger),
          delivery: keywordReplyDelivery(context),
          pluginRegistry: context.pluginRegistry,
        });
        continue;
      }

      // 契約定義的動作都有分支；走到這裡代表契約與 workers 不一致（驗證已擋下契約外的動作），留 warn 供追查
      logger.warn(`[automation] Unsupported worker action "${action.type}" skipped`);
    } catch (err) {
      logger.error(`[automation] Worker action "${action.type}" failed`, { err });
    }
  }
}

export async function getSupervisorAndAdminAgentIds(
  prisma: PrismaClient,
  tenantId: string,
): Promise<string[]> {
  return getSupervisorAndAdminIds(prisma, tenantId);
}
