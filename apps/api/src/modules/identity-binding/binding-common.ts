/**
 * 跨渠道綁定與 email 登記共用的型別與輔助函式（change add-cross-channel-one-id、add-email-identity-merge）。
 */
import type { Prisma } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { logger } from '@open333crm/core';
import type { TenantDb } from '../../lib/tenant-db.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import { resolveMergeChain } from '../contact/contact-merge.service.js';
import { buildMessageNewPayload, emitToConversationAndTenant } from '../webhook/inbound-socket-presenter.js';
import type { BindingStore } from './binding-code.js';
import { BINDING_TEXT } from './binding-links.js';

export interface BindingDeps {
  store: BindingStore;
  /** 有 io 才推送 socket 事件（測試可省略） */
  io?: SocketIOServer;
  /** 送出訊息到渠道，回傳是否成功；預設走 deliverToChannel */
  deliver?: (db: TenantDb, conversationId: string, text: string) => Promise<boolean>;
  now?: () => number;
}

/** 發碼／兌換／解除時，顧客目前所在的渠道身分 */
export interface BindingActor {
  tenantId: string;
  channelId: string;
  channelType: string;
  channelIdentityId: string;
  uid: string;
  contactId: string;
  conversationId: string;
}

export async function inTransaction<T>(db: TenantDb, fn: (tx: TenantDb) => Promise<T>): Promise<T> {
  const client = db as unknown as {
    $transaction?: (cb: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
    $isTenantScoped?: () => true;
  };
  // request.tenantPrisma 的 $transaction 不帶租戶、查詢也各自開交易，合併會失去原子性且被 RLS 擋掉；
  // 需要合併／解除的呼叫端必須傳 withTenant 的 tx（或白名單的 prismaAdmin）
  if (typeof client.$isTenantScoped === 'function') {
    throw new Error('identity-binding：合併／解除需在 withTenant 交易內執行，請勿傳入 request.tenantPrisma');
  }
  // 已在交易內（TransactionClient 沒有 $transaction）就直接執行，避免巢狀
  if (typeof client.$transaction === 'function') return client.$transaction((tx) => fn(tx));
  return fn(db);
}

/**
 * 送出一則綁定訊息並寫入對話紀錄（以 Bot 訊息呈現，保留換行，客服看得出顧客收到了什麼）。
 * 送出失敗時比照 worker 的 recordDeliveryFailure 慣例，在該則訊息標 metadata.deliveryFailed，
 * 收件匣會顯示成紅色「沒有送出」提示，不讓失敗只留在 log。
 */
export async function sendBindingMessage(
  db: TenantDb,
  deps: BindingDeps,
  tenantId: string,
  conversationId: string,
  text: string,
  kind: string,
): Promise<boolean> {
  const ok = await (deps.deliver ?? deliverToChannel)(db, conversationId, text);
  if (!ok) logger.warn('[IdentityBinding] 綁定訊息送出失敗', { conversationId, kind });

  const message = await db.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'BOT',
      contentType: 'text',
      content: { text },
      metadata: {
        source: 'identity_binding',
        kind,
        ...(ok ? {} : { deliveryFailed: true, deliveryError: BINDING_TEXT.deliveryFailed }),
      },
    },
  });
  await db.conversation.updateMany({ where: { id: conversationId, tenantId }, data: { lastMessageAt: new Date() } });
  if (deps.io) {
    const payload = buildMessageNewPayload(message, { content: { text }, includeTypePayload: true, includeMetadata: true });
    emitToConversationAndTenant(deps.io, conversationId, tenantId, 'message.new', payload);
  }
  return ok;
}

/** 沿 mergedIntoId 找到目前仍在使用的聯絡人（發碼方可能在兌換前已被併入別人）；找不到或已封存回 null */
export async function resolveLiveContactId(db: TenantDb, tenantId: string, contactId: string): Promise<string | null> {
  const chain = await resolveMergeChain(db, tenantId, contactId);
  const holder = chain[chain.length - 1];
  const c = await db.contact.findFirst({ where: { id: holder, tenantId }, select: { isArchived: true } });
  return c && !c.isArchived ? holder : null;
}

/**
 * 同一渠道只能有一個帳號：兩位聯絡人在同一個渠道都有身分時回 true。
 * 合併後同一渠道會有兩個身分，回覆會送錯人、對話會混在一起，呼叫端應拒絕合併。
 */
export async function hasSharedChannel(db: TenantDb, survivorId: string, mergedId: string): Promise<boolean> {
  const [survivorChannels, mergedChannels] = await Promise.all([
    db.channelIdentity.findMany({ where: { contactId: survivorId }, select: { channelId: true } }),
    db.channelIdentity.findMany({ where: { contactId: mergedId }, select: { channelId: true } }),
  ]);
  const occupied = new Set(survivorChannels.map((c) => c.channelId));
  return mergedChannels.some((c) => occupied.has(c.channelId));
}
