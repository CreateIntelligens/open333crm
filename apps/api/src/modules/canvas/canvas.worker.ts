import type { PrismaClient } from '@prisma/client';
import { EventBus } from '@open333crm/core';
import { getChannelPlugin } from '../../channels/registry.js';
import { decryptCredentials } from '../channel/channel.service.js';
import { sendEmail } from '../email/email.service.js';

interface SocketTarget {
  emit(event: string, payload: unknown): void;
}

interface SocketIOServerLike {
  to(room: string): SocketTarget;
}

interface CanvasSendMessagePayload {
  executionId: string;
  contactId: string;
  channelType?: string;
  templateId?: string;
  text?: string;
  vars?: Record<string, unknown>;
}

interface CanvasActionPayload {
  executionId: string;
  contactId: string;
  actionType: string;
  params?: Record<string, unknown>;
}

export function setupCanvasWorker(prisma: PrismaClient, io: SocketIOServerLike) {
  EventBus.subscribe((event) => {
    if (event.type === 'canvas.send_message') {
      void handleCanvasSendMessage(prisma, io, event.tenantId, event.payload as CanvasSendMessagePayload);
    }

    if (event.type === 'canvas.action') {
      void handleCanvasAction(prisma, event.tenantId, event.payload as CanvasActionPayload);
    }
  });

  console.log('[CanvasWorker] Subscribed to canvas event bus');
}

async function handleCanvasSendMessage(
  prisma: PrismaClient,
  io: SocketIOServerLike,
  tenantId: string,
  payload: CanvasSendMessagePayload,
) {
  const { contactId, channelType, templateId, text } = payload;

  if (!channelType) {
    console.warn('[CanvasWorker] Missing channelType for canvas.send_message');
    return;
  }

  if (channelType.toLowerCase() === 'email') {
    await handleEmailSend(prisma, tenantId, contactId, templateId, payload.vars);
    return;
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      tenantId,
      contactId,
      channelType: channelType.toUpperCase() as never,
      status: { not: 'CLOSED' },
    },
    orderBy: { lastMessageAt: 'desc' },
    include: {
      channel: true,
      contact: {
        include: {
          channelIdentities: true,
        },
      },
    },
  });

  if (!conversation?.channel?.isActive) {
    console.warn(
      `[CanvasWorker] No active conversation/channel for contact=${contactId}, channelType=${channelType}`,
    );
    return;
  }

  const identity = conversation.contact.channelIdentities.find(
    (item) => item.channelId === conversation.channelId,
  );

  if (!identity) {
    console.warn(
      `[CanvasWorker] No channel identity for contact=${contactId}, channelId=${conversation.channelId}`,
    );
    return;
  }

  const plugin = getChannelPlugin(conversation.channel.channelType);
  if (!plugin) {
    console.warn(`[CanvasWorker] Missing channel plugin for ${conversation.channel.channelType}`);
    return;
  }

  const outboundText = text ?? '';
  const credentials = decryptCredentials(conversation.channel.credentialsEncrypted);
  const sendResult = await plugin.sendMessage(
    identity.uid,
    { contentType: 'text', content: { text: outboundText } },
    credentials,
  );

  if (!sendResult.success) {
    console.error('[CanvasWorker] Failed to send canvas message:', sendResult.error);
    return;
  }

  const now = new Date();
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      senderType: 'BOT',
      contentType: 'text',
      content: { text: outboundText },
      channelMsgId: sendResult.channelMsgId ?? null,
      isRead: true,
      createdAt: now,
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: now },
  });

  const wsPayload = {
    conversationId: conversation.id,
    message: {
      id: message.id,
      conversationId: message.conversationId,
      direction: message.direction,
      senderType: message.senderType,
      senderId: message.senderId,
      contentType: message.contentType,
      content: message.content as Record<string, unknown>,
      createdAt: message.createdAt.toISOString(),
      sender: null,
    },
  };

  io.to(`conversation:${conversation.id}`).emit('message.new', wsPayload);
  io.to(`tenant:${tenantId}`).emit('message.new', wsPayload);
}

async function handleEmailSend(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
  templateId?: string,
  vars?: Record<string, unknown>,
) {
  if (!templateId) {
    console.warn('[CanvasWorker] Email send skipped: missing templateId');
    return;
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
    select: { email: true },
  });

  if (!contact?.email) {
    console.warn(`[CanvasWorker] Email send skipped: contact ${contactId} has no email`);
    return;
  }

  const templateView = await prisma.templateView.findFirst({
    where: {
      templateId,
      channelType: 'email',
      status: { in: ['APPROVED', 'PENDING_REVIEW', 'DRAFT'] },
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (!templateView) {
    console.warn(`[CanvasWorker] Email send skipped: no email template view for template=${templateId}`);
    return;
  }

  const template = await prisma.messageTemplate.findUnique({
    where: { id: templateId },
    select: { name: true, description: true },
  });

  try {
    const html = renderEmailHtml(
      (templateView.body as Array<Record<string, unknown>>) ?? [],
      flattenTemplateVars(vars),
    );
    await sendEmail({
      to: contact.email,
      subject: template?.name ?? `Canvas Template ${templateId}`,
      html,
      text: template?.description ?? undefined,
      metadata: {
        tenantId,
        contactId,
        templateId,
        templateViewId: templateView.id,
        source: 'canvas-worker',
      },
    });
  } catch (err) {
    console.error('[CanvasWorker] Failed to render email template:', err);
  }
}

async function handleCanvasAction(
  prisma: PrismaClient,
  tenantId: string,
  payload: CanvasActionPayload,
) {
  if (payload.actionType !== 'add_tag') {
    return;
  }

  const tagId = typeof payload.params?.tagId === 'string' ? payload.params.tagId : null;
  if (!tagId) {
    console.warn('[CanvasWorker] add_tag skipped: missing tagId');
    return;
  }

  await prisma.contactTag.upsert({
    where: {
      contactId_tagId: {
        contactId: payload.contactId,
        tagId,
      },
    },
    create: {
      contactId: payload.contactId,
      tagId,
      addedBy: 'system',
    },
    update: {},
  });

  console.log(
    `[CanvasWorker] Added tag ${tagId} to contact ${payload.contactId} (tenant ${tenantId})`,
  );
}

function flattenTemplateVars(vars: Record<string, unknown> | undefined): Record<string, string> {
  const flattened: Record<string, string> = {};
  if (!vars) return flattened;

  walkVars('', vars, flattened);
  return flattened;
}

function walkVars(
  prefix: string,
  input: Record<string, unknown>,
  output: Record<string, string>,
) {
  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      walkVars(path, value as Record<string, unknown>, output);
      continue;
    }

    if (value !== undefined && value !== null) {
      output[path] = String(value);
    }
  }
}

function renderEmailHtml(
  blocks: Array<Record<string, unknown>>,
  vars: Record<string, string>,
): string {
  const content = blocks.map((block) => renderBlock(block, vars)).join('');
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;"><div style="max-width:640px;margin:0 auto;background:#ffffff;padding:24px;border-radius:12px;">${content}</div></body></html>`;
}

function renderBlock(
  block: Record<string, unknown>,
  vars: Record<string, string>,
): string {
  const type = String(block.type ?? 'text');
  const content = substituteVars(String(block.content ?? ''), vars);
  const align = String(block.align ?? 'left');
  const color = String(block.color ?? '#222222');
  const backgroundColor = String(block.backgroundColor ?? '#ffffff');

  switch (type) {
    case 'header':
      return `<h1 style="margin:0 0 16px;text-align:${align};color:${color};background:${backgroundColor};padding:16px;border-radius:8px;font-size:28px;">${escapeHtml(content)}</h1>`;
    case 'button': {
      const href = escapeHtml(String(block.href ?? '#'));
      return `<div style="margin:16px 0;text-align:${align};"><a href="${href}" style="display:inline-block;padding:12px 20px;background:${backgroundColor === '#ffffff' ? '#111827' : backgroundColor};color:${color === '#222222' ? '#ffffff' : color};text-decoration:none;border-radius:999px;">${escapeHtml(content || 'Open')}</a></div>`;
    }
    case 'image': {
      const src = escapeHtml(String(block.src ?? ''));
      const alt = escapeHtml(String(block.alt ?? ''));
      return src ? `<div style="margin:16px 0;text-align:${align};"><img src="${src}" alt="${alt}" style="max-width:100%;border-radius:8px;" /></div>` : '';
    }
    case 'divider':
      return '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />';
    case 'spacer':
      return `<div style="height:${escapeHtml(String(block.height ?? '20px'))};"></div>`;
    case 'text':
    default:
      return `<p style="margin:0 0 16px;text-align:${align};color:${color};line-height:1.6;">${escapeHtml(content)}</p>`;
  }
}

function substituteVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key: string) => vars[key] ?? '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
