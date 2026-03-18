/**
 * Action executor – runs side-effects for matched automation rules.
 *
 * Supported action types:
 *   create_case        – Create a case for the contact
 *   add_tag            – Add a tag to the contact
 *   remove_tag         – Remove a tag from the contact
 *   notify             – Emit WebSocket notification to the tenant room
 *   notify_supervisor  – Emit WebSocket notification to the tenant room
 *   send_message       – Create an auto-reply message + deliver to channel
 *   assign_agent       – Assign the conversation to a specific agent
 *   assign_bot         – Set conversation to BOT_HANDLED
 *   kb_auto_reply      – KB-based auto reply
 *   llm_reply          – LLM-generated reply
 *   update_case_status – Update a case's status
 *   escalate_case      – Escalate a case (priority bump + ESCALATED status)
 */

import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { attemptKbAutoReply } from '../../ai/kb-autoreply.service.js';
import { deliverToChannel } from '../../conversation/conversation.service.js';
import { generateReply, CRM_REPLY_SYSTEM_PROMPT } from '../../ai/llm.service.js';

export interface ActionPayload {
  type: string;
  params: Record<string, unknown>;
}

export interface ActionResult {
  action: string;
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

export interface ActionContext {
  tenantId: string;
  contactId?: string;
  conversationId?: string;
  caseId?: string;
}

// Actions that send outbound messages to the contact
const OUTBOUND_ACTIONS = new Set(['send_message', 'llm_reply', 'kb_auto_reply']);

// Tags that indicate opt-out / do-not-disturb
const OPT_OUT_TAGS = ['do_not_disturb', 'opt_out', '勿擾', '退訂'];

// Rate limit: max triggers per rule+contact within this window
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 3;

export async function executeActions(
  prisma: PrismaClient,
  io: Server,
  actions: ActionPayload[],
  context: ActionContext,
  ruleId: string,
  agentId?: string,
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];

  // ── Protection: rate limiting (same rule + same contact, max 3/hour) ──
  if (context.contactId) {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recentCount = await prisma.automationLog.count({
      where: {
        ruleId,
        triggerRef: context.conversationId ?? context.contactId,
        createdAt: { gte: windowStart },
        success: true,
      },
    });
    if (recentCount >= RATE_LIMIT_MAX) {
      console.log(`[ActionExecutor] Rate limit hit: rule=${ruleId}, contact=${context.contactId}, count=${recentCount}`);
      return [{ action: 'rate_limit', success: false, error: `Rate limit exceeded: ${recentCount} executions in the last hour` }];
    }
  }

  // ── Protection: opt-out check for outbound actions ──
  let contactOptedOut = false;
  if (context.contactId) {
    const optOutTags = await prisma.contactTag.findMany({
      where: {
        contactId: context.contactId,
        tag: {
          name: { in: OPT_OUT_TAGS },
        },
      },
      include: { tag: { select: { name: true } } },
    });
    if (optOutTags.length > 0) {
      contactOptedOut = true;
      console.log(`[ActionExecutor] Contact ${context.contactId} has opt-out tag: ${optOutTags.map(t => t.tag.name).join(', ')}`);
    }
  }

  for (const action of actions) {
    try {
      // Skip outbound actions for opted-out contacts
      if (contactOptedOut && OUTBOUND_ACTIONS.has(action.type)) {
        results.push({
          action: action.type,
          success: false,
          error: 'Skipped: contact has opt-out/do-not-disturb tag',
        });
        continue;
      }

      switch (action.type) {
        case 'create_case': {
          const result = await handleCreateCase(prisma, io, context, action.params);
          results.push({ action: action.type, success: true, data: result });
          break;
        }

        case 'add_tag': {
          const result = await handleAddTag(prisma, context, action.params);
          results.push({ action: action.type, success: true, data: result });
          break;
        }

        case 'remove_tag': {
          const result = await handleRemoveTag(prisma, context, action.params);
          results.push({ action: action.type, success: true, data: result });
          break;
        }

        case 'notify':
        case 'notify_supervisor': {
          handleNotify(io, context, action.params);
          results.push({ action: action.type, success: true });
          break;
        }

        case 'send_message': {
          const result = await handleSendMessage(prisma, io, context, action.params);
          results.push({ action: action.type, success: true, data: result });
          break;
        }

        case 'assign_agent': {
          const result = await handleAssignAgent(prisma, io, context, action.params);
          results.push({ action: action.type, success: true, data: result });
          break;
        }

        case 'assign_bot': {
          const result = await handleAssignBot(prisma, io, context);
          results.push({ action: action.type, success: true, data: result });
          break;
        }

        case 'kb_auto_reply': {
          const result = await handleKbAutoReply(prisma, io, context);
          results.push({ action: action.type, success: true, data: result });
          break;
        }

        case 'llm_reply': {
          const result = await handleLlmReply(prisma, io, context, action.params);
          results.push({ action: action.type, success: true, data: result });
          break;
        }

        case 'update_case_status': {
          const result = await handleUpdateCaseStatus(prisma, io, context, action.params);
          results.push({ action: action.type, success: true, data: result });
          break;
        }

        case 'escalate_case': {
          const result = await handleEscalateCase(prisma, io, context, action.params);
          results.push({ action: action.type, success: true, data: result });
          break;
        }

        default: {
          results.push({
            action: action.type,
            success: false,
            error: `Unknown action type: ${action.type}`,
          });
        }
      }
    } catch (err) {
      results.push({
        action: action.type,
        success: false,
        error: (err as Error).message,
      });
    }
  }

  // Log the automation execution
  const allSucceeded = results.every((r) => r.success);

  await prisma.automationLog.create({
    data: {
      tenantId: context.tenantId,
      ruleId,
      triggerRef: context.conversationId ?? context.contactId ?? null,
      success: allSucceeded,
      actionsRan: results as any,
      errorMsg: allSucceeded
        ? null
        : results
            .filter((r) => !r.success)
            .map((r) => `${r.action}: ${r.error}`)
            .join('; '),
    },
  });

  // Update run count and lastRunAt on the rule
  await prisma.automationRule.update({
    where: { id: ruleId },
    data: {
      runCount: { increment: 1 },
      lastRunAt: new Date(),
    },
  });

  return results;
}

// ── Action handlers ──────────────────────────────────────────────────────────

async function handleCreateCase(
  prisma: PrismaClient,
  io: Server,
  context: ActionContext,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!context.contactId) {
    throw new Error('Cannot create case: no contactId in context');
  }

  // Find a channel for this contact
  const channelIdentity = await prisma.channelIdentity.findFirst({
    where: { contactId: context.contactId },
    select: { channelId: true },
  });

  if (!channelIdentity) {
    throw new Error('Cannot create case: contact has no channel identity');
  }

  const title = (params.title as string) || 'Auto-created case';
  const priority = (params.priority as string) || 'MEDIUM';
  const category = (params.category as string) || undefined;

  const caseRecord = await prisma.case.create({
    data: {
      tenantId: context.tenantId,
      contactId: context.contactId,
      channelId: channelIdentity.channelId,
      conversationId: context.conversationId ?? undefined,
      title,
      priority: priority as any,
      category,
      status: 'OPEN',
    },
  });

  // Emit WebSocket event
  io.to(`tenant:${context.tenantId}`).emit('case.created', {
    id: caseRecord.id,
    title: caseRecord.title,
    status: caseRecord.status,
    priority: caseRecord.priority,
    source: 'automation',
  });

  return { caseId: caseRecord.id, title: caseRecord.title };
}

async function handleAddTag(
  prisma: PrismaClient,
  context: ActionContext,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!context.contactId) {
    throw new Error('Cannot add tag: no contactId in context');
  }

  const tagName = params.tagName as string;
  if (!tagName) {
    throw new Error('Cannot add tag: tagName not specified');
  }

  // Find or create the tag
  let tag = await prisma.tag.findFirst({
    where: {
      tenantId: context.tenantId,
      name: tagName,
      scope: 'CONTACT',
    },
  });

  if (!tag) {
    tag = await prisma.tag.create({
      data: {
        tenantId: context.tenantId,
        name: tagName,
        type: 'AUTO',
        scope: 'CONTACT',
        color: '#6366f1',
        description: `Auto-created by automation rule`,
      },
    });
  }

  // Upsert contact-tag relation (avoid duplicate errors)
  const existing = await prisma.contactTag.findUnique({
    where: {
      contactId_tagId: {
        contactId: context.contactId,
        tagId: tag.id,
      },
    },
  });

  if (!existing) {
    await prisma.contactTag.create({
      data: {
        contactId: context.contactId,
        tagId: tag.id,
        addedBy: 'automation',
      },
    });
  }

  return { tagId: tag.id, tagName: tag.name };
}

async function handleRemoveTag(
  prisma: PrismaClient,
  context: ActionContext,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!context.contactId) {
    throw new Error('Cannot remove tag: no contactId in context');
  }

  const tagName = params.tagName as string;
  if (!tagName) {
    throw new Error('Cannot remove tag: tagName not specified');
  }

  const tag = await prisma.tag.findFirst({
    where: {
      tenantId: context.tenantId,
      name: tagName,
      scope: 'CONTACT',
    },
  });

  if (!tag) {
    return { removed: false, reason: 'Tag not found' };
  }

  const existing = await prisma.contactTag.findUnique({
    where: {
      contactId_tagId: {
        contactId: context.contactId,
        tagId: tag.id,
      },
    },
  });

  if (!existing) {
    return { removed: false, reason: 'Contact does not have this tag' };
  }

  await prisma.contactTag.delete({
    where: {
      contactId_tagId: {
        contactId: context.contactId,
        tagId: tag.id,
      },
    },
  });

  return { removed: true, tagId: tag.id, tagName: tag.name };
}

function handleNotify(
  io: Server,
  context: ActionContext,
  params: Record<string, unknown>,
): void {
  const message = (params.message as string) || 'Automation rule triggered';

  io.to(`tenant:${context.tenantId}`).emit('automation.notification', {
    type: 'automation',
    message,
    contactId: context.contactId,
    conversationId: context.conversationId,
    timestamp: new Date().toISOString(),
  });
}

async function handleSendMessage(
  prisma: PrismaClient,
  io: Server,
  context: ActionContext,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!context.conversationId) {
    throw new Error('Cannot send message: no conversationId in context');
  }

  const text = (params.text as string) || (params.message as string);
  if (!text) {
    throw new Error('Cannot send message: text not specified');
  }

  const message = await prisma.message.create({
    data: {
      conversationId: context.conversationId,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: 'text',
      content: { text },
      metadata: { source: 'automation' },
    },
  });

  // Update conversation lastMessageAt
  await prisma.conversation.update({
    where: { id: context.conversationId },
    data: { lastMessageAt: new Date() },
  });

  // Emit WebSocket event
  io.to(`conversation:${context.conversationId}`).emit('message.new', {
    conversationId: context.conversationId,
    message: {
      id: message.id,
      conversationId: context.conversationId,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: 'text',
      content: { text },
      createdAt: message.createdAt.toISOString(),
    },
  });
  io.to(`tenant:${context.tenantId}`).emit('message.new', {
    conversationId: context.conversationId,
    message: {
      id: message.id,
      conversationId: context.conversationId,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: 'text',
      content: { text },
      createdAt: message.createdAt.toISOString(),
    },
  });

  // Deliver to external channel (LINE/FB)
  await deliverToChannel(prisma, context.conversationId, text);

  return { messageId: message.id };
}

async function handleAssignAgent(
  prisma: PrismaClient,
  io: Server,
  context: ActionContext,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!context.conversationId) {
    throw new Error('Cannot assign agent: no conversationId in context');
  }

  const agentId = params.agentId as string;
  if (!agentId) {
    throw new Error('Cannot assign agent: agentId not specified');
  }

  // Verify agent exists and belongs to the tenant
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, tenantId: context.tenantId, isActive: true },
    select: { id: true, name: true },
  });

  if (!agent) {
    throw new Error(`Agent ${agentId} not found or inactive`);
  }

  await prisma.conversation.update({
    where: { id: context.conversationId },
    data: {
      assignedToId: agentId,
      status: 'AGENT_HANDLED',
    },
  });

  // Emit WebSocket event
  io.to(`tenant:${context.tenantId}`).emit('conversation.assigned', {
    conversationId: context.conversationId,
    assignedToId: agentId,
    assignedToName: agent.name,
    source: 'automation',
  });

  return { agentId, agentName: agent.name };
}

async function handleAssignBot(
  prisma: PrismaClient,
  io: Server,
  context: ActionContext,
): Promise<Record<string, unknown>> {
  if (!context.conversationId) {
    throw new Error('Cannot assign bot: no conversationId in context');
  }

  await prisma.conversation.update({
    where: { id: context.conversationId },
    data: {
      status: 'BOT_HANDLED',
      assignedToId: null,
      botRepliesCount: 0,
    },
  });

  // Emit WebSocket event
  io.to(`tenant:${context.tenantId}`).emit('conversation.updated', {
    id: context.conversationId,
    status: 'BOT_HANDLED',
    assignedToId: null,
    source: 'automation',
  });

  return { status: 'BOT_HANDLED' };
}

async function handleKbAutoReply(
  prisma: PrismaClient,
  io: Server,
  context: ActionContext,
): Promise<Record<string, unknown>> {
  if (!context.conversationId) {
    throw new Error('Cannot run kb_auto_reply: no conversationId in context');
  }

  // Retrieve latest inbound message text
  const latestInbound = await prisma.message.findFirst({
    where: {
      conversationId: context.conversationId,
      direction: 'INBOUND',
      senderType: 'CONTACT',
    },
    orderBy: { createdAt: 'desc' },
    select: { content: true },
  });

  const text =
    latestInbound && typeof latestInbound.content === 'object' && latestInbound.content !== null
      ? (latestInbound.content as { text?: string }).text || ''
      : '';

  if (!text) {
    throw new Error('Cannot run kb_auto_reply: no inbound message text found');
  }

  const replied = await attemptKbAutoReply(prisma, io, context.tenantId, context.conversationId, text);
  return { replied };
}

async function handleLlmReply(
  prisma: PrismaClient,
  io: Server,
  context: ActionContext,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!context.conversationId) {
    throw new Error('Cannot run llm_reply: no conversationId in context');
  }

  // Get recent conversation history (last 10 messages)
  const recentMessages = await prisma.message.findMany({
    where: { conversationId: context.conversationId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      direction: true,
      senderType: true,
      content: true,
      createdAt: true,
    },
  });

  // Build conversation context for LLM
  const history = recentMessages
    .reverse()
    .map((m) => {
      const role = m.direction === 'INBOUND' ? '客戶' : '客服';
      const text = typeof m.content === 'object' && m.content !== null
        ? (m.content as { text?: string }).text || ''
        : '';
      return `${role}: ${text}`;
    })
    .join('\n');

  // Use custom system prompt if provided, otherwise default
  // Always append Traditional Chinese enforcement
  const basePrompt = (params.systemPrompt as string) || CRM_REPLY_SYSTEM_PROMPT;
  const systemPrompt = basePrompt.includes('繁體中文')
    ? basePrompt
    : basePrompt + ' 你必須全程使用繁體中文回覆。';

  // Generate reply using LLM
  const replyText = await generateReply(systemPrompt, history, '');

  // Save as BOT message
  const message = await prisma.message.create({
    data: {
      conversationId: context.conversationId,
      direction: 'OUTBOUND',
      senderType: 'BOT',
      contentType: 'text',
      content: { text: replyText },
      metadata: { source: 'llm_reply' },
    },
  });

  const now = new Date();

  // Update conversation
  await prisma.conversation.update({
    where: { id: context.conversationId },
    data: {
      lastMessageAt: now,
      botRepliesCount: { increment: 1 },
    },
  });

  // Emit WebSocket events
  const wsPayload = {
    conversationId: context.conversationId,
    message: {
      id: message.id,
      conversationId: context.conversationId,
      direction: 'OUTBOUND',
      senderType: 'BOT',
      contentType: 'text',
      content: { text: replyText },
      createdAt: message.createdAt.toISOString(),
    },
  };

  io.to(`conversation:${context.conversationId}`).emit('message.new', wsPayload);
  io.to(`tenant:${context.tenantId}`).emit('message.new', wsPayload);

  // Deliver to external channel (LINE/FB)
  await deliverToChannel(prisma, context.conversationId, replyText);

  return { messageId: message.id, replyText };
}

async function handleUpdateCaseStatus(
  prisma: PrismaClient,
  io: Server,
  context: ActionContext,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const caseId = (params.caseId as string) || context.caseId;
  if (!caseId) {
    throw new Error('Cannot update case status: no caseId in params or context');
  }

  const newStatus = params.status as string;
  if (!newStatus) {
    throw new Error('Cannot update case status: status not specified');
  }

  const caseRecord = await prisma.case.findFirst({
    where: { id: caseId, tenantId: context.tenantId },
  });

  if (!caseRecord) {
    throw new Error(`Case ${caseId} not found`);
  }

  const updateData: Record<string, unknown> = { status: newStatus };
  if (newStatus === 'RESOLVED') updateData.resolvedAt = new Date();
  if (newStatus === 'CLOSED') updateData.closedAt = new Date();

  const updated = await prisma.case.update({
    where: { id: caseId },
    data: updateData as any,
  });

  // Create case event
  await prisma.caseEvent.create({
    data: {
      caseId,
      actorType: 'system',
      eventType: 'status_changed',
      payload: { from: caseRecord.status, to: newStatus, source: 'automation' },
    },
  });

  // Emit WebSocket event
  io.to(`tenant:${context.tenantId}`).emit('case.updated', {
    id: updated.id,
    status: updated.status,
    priority: updated.priority,
    source: 'automation',
  });

  return { caseId, previousStatus: caseRecord.status, newStatus };
}

async function handleEscalateCase(
  prisma: PrismaClient,
  io: Server,
  context: ActionContext,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const caseId = (params.caseId as string) || context.caseId;
  if (!caseId) {
    throw new Error('Cannot escalate case: no caseId in params or context');
  }

  const caseRecord = await prisma.case.findFirst({
    where: { id: caseId, tenantId: context.tenantId },
  });

  if (!caseRecord) {
    throw new Error(`Case ${caseId} not found`);
  }

  // Determine new priority
  const priorityOrder = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
  let newPriority = (params.newPriority as string) || undefined;
  if (!newPriority) {
    const currentIndex = priorityOrder.indexOf(caseRecord.priority);
    newPriority = currentIndex < priorityOrder.length - 1
      ? priorityOrder[currentIndex + 1]
      : caseRecord.priority;
  }

  const reason = (params.reason as string) || 'Escalated by automation';

  const updated = await prisma.case.update({
    where: { id: caseId },
    data: {
      status: 'ESCALATED',
      priority: newPriority as any,
    },
  });

  // Create case event
  await prisma.caseEvent.create({
    data: {
      caseId,
      actorType: 'system',
      eventType: 'escalated',
      payload: {
        from: caseRecord.status,
        previousPriority: caseRecord.priority,
        newPriority,
        reason,
        source: 'automation',
      },
    },
  });

  // Emit WebSocket event
  io.to(`tenant:${context.tenantId}`).emit('case.updated', {
    id: updated.id,
    status: updated.status,
    priority: updated.priority,
    source: 'automation',
  });

  return {
    caseId,
    previousStatus: caseRecord.status,
    previousPriority: caseRecord.priority,
    newStatus: 'ESCALATED',
    newPriority,
  };
}
