/**
 * GDPR 資料刪除（被遺忘權，Art.17）worker handler。
 *
 * 兩種模式：
 *  - anonymize（預設）：抹去 Contact 的 PII 欄位、刪除可識別的子資料（ContactAttribute /
 *    ChannelIdentity / IdentityMap / LongTermMemory）、抹去 inbound 訊息內容，但保留
 *    Conversation / Case 統計骨架（讓報表數字不變）。
 *  - hard_delete：在 transaction 內先算 affected 計數，再連鎖刪除該聯絡人的所有資料與聯絡人本身，
 *    並刪除對應的 MinIO 媒體附件。
 *
 * 刪除只影響目標 contactId，不波及同租戶其他聯絡人。
 * 完成後更新 status/affected、寫租戶稽核（payload 只含 contactId/mode/affected 計數，絕不含 PII）、
 * 通知發起者。
 */
import type { Job } from 'bullmq';
import type { PrismaClient, Prisma } from '@prisma/client';
import type IORedis from 'ioredis';
import { logger, MinioStorageProvider } from '@open333crm/core';
import { enqueueNotification } from '../lib/notification-queue.js';

interface DataErasureJobData {
  requestId: string;
  tenantId: string;
  contactId: string;
  mode: 'anonymize' | 'hard_delete';
  requestedBy: string;
}

// 匿名化佔位字串（顯示名等非 nullable 欄位用）。
const REDACTED = '[已刪除]';

// 媒體附件所在 bucket（與 apps/api storage.service 的 S3_BUCKET 對齊）。
const MEDIA_BUCKET = process.env.S3_BUCKET || 'open333crm';

/**
 * 從一批訊息的 content JSON 中抽出 MinIO storageKey（webhook inbound-side-effects 會寫入
 * content.storageKey）。回傳去重後的 key 陣列。
 */
function collectStorageKeys(messages: { content: Prisma.JsonValue }[]): string[] {
  const keys = new Set<string>();
  for (const m of messages) {
    const c = m.content as Record<string, unknown> | null;
    const key = c && typeof c === 'object' ? c['storageKey'] : undefined;
    if (typeof key === 'string' && key.length > 0) keys.add(key);
  }
  return [...keys];
}

/** 刪除一批 MinIO 物件（單顆失敗只 log，不阻斷刪除流程）。 */
async function deleteMediaObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const storage = new MinioStorageProvider();
  for (const key of keys) {
    try {
      await storage.delete(MEDIA_BUCKET, key);
    } catch (err) {
      logger.error(`[data-erasure] MinIO delete failed key=${key}:`, err);
    }
  }
}

export async function handleDataErasureJob(
  job: Job,
  prisma: PrismaClient,
  redisPublisher: IORedis,
): Promise<void> {
  const { requestId, tenantId, contactId, mode, requestedBy } = job.data as DataErasureJobData;

  logger.info(`[data-erasure] Processing request ${requestId} mode=${mode} contact=${contactId}`);

  // 標記 processing
  await prisma.dataErasureRequest.updateMany({
    where: { id: requestId, tenantId },
    data: { status: 'processing' },
  });

  try {
    // 再次驗證聯絡人同租戶（防禦：請求建立到執行之間狀態可能改變）
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, tenantId },
      select: { id: true },
    });
    if (!contact) {
      throw new Error(`Contact ${contactId} not found for tenant ${tenantId}`);
    }

    let affected: Record<string, number>;

    if (mode === 'hard_delete') {
      affected = await hardDelete(prisma, tenantId, contactId);
    } else {
      affected = await anonymize(prisma, tenantId, contactId);
    }

    // 更新完成狀態
    await prisma.dataErasureRequest.updateMany({
      where: { id: requestId, tenantId },
      data: {
        status: 'completed',
        affected: affected as Prisma.InputJsonValue,
        completedAt: new Date(),
        error: null,
      },
    });

    // 寫租戶稽核（payload 只含 contactId/mode/affected 計數，絕不含 PII）
    await prisma.tenantAuditLog
      .create({
        data: {
          tenantId,
          actorId: requestedBy,
          action: 'data.erasure.complete',
          targetType: 'contact',
          targetId: contactId,
          payload: { contactId, mode, affected } as Prisma.InputJsonValue,
        },
      })
      .catch((err) => logger.error('[data-erasure] audit write failed:', err));

    // 通知發起者
    await enqueueNotification({
      tenantId,
      agentId: requestedBy,
      type: 'data_erasure_done',
      title: '資料刪除完成',
      body: mode === 'hard_delete' ? '聯絡人資料已永久刪除。' : '聯絡人個資已匿名化。',
    });

    logger.info(`[data-erasure] Completed request ${requestId} affected=${JSON.stringify(affected)}`);
  } catch (err) {
    logger.error(`[data-erasure] Failed request ${requestId}:`, err);
    await prisma.dataErasureRequest.updateMany({
      where: { id: requestId, tenantId },
      data: {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw err; // 讓 BullMQ 記錄失敗
  }
}

/**
 * 匿名化：抹去 PII 但保留統計骨架。
 *  - Contact：displayName→佔位、avatarUrl/phone/email→null
 *  - 刪 ContactAttribute / ChannelIdentity / IdentityMap / LongTermMemory（可識別子資料）
 *  - inbound 訊息 content 改為 redacted 佔位（保留 Conversation/Case/Message 骨架不刪）
 */
async function anonymize(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
): Promise<Record<string, number>> {
  return prisma.$transaction(async (tx) => {
    // 抹 Contact PII
    await tx.contact.update({
      where: { id: contactId },
      data: {
        displayName: REDACTED,
        avatarUrl: null,
        phone: null,
        email: null,
      },
    });

    // 刪可識別的子資料（都只綁在此 contactId）
    const attrs = await tx.contactAttribute.deleteMany({ where: { contactId } });
    const identities = await tx.channelIdentity.deleteMany({ where: { contactId } });
    const identityMaps = await tx.identityMap.deleteMany({ where: { contactId, tenantId } });
    const memories = await tx.longTermMemory.deleteMany({ where: { contactId } });

    // 抹 inbound 訊息內容（只此聯絡人所屬對話的入站訊息；保留骨架）
    const convs = await tx.conversation.findMany({
      where: { contactId, tenantId },
      select: { id: true },
    });
    const convIds = convs.map((c) => c.id);
    let messagesRedacted = 0;
    if (convIds.length > 0) {
      const res = await tx.message.updateMany({
        where: { conversationId: { in: convIds }, direction: 'INBOUND' },
        data: { content: { redacted: true } as Prisma.InputJsonValue },
      });
      messagesRedacted = res.count;
    }

    return {
      contactAttributes: attrs.count,
      channelIdentities: identities.count,
      identityMaps: identityMaps.count,
      longTermMemories: memories.count,
      messagesRedacted,
    };
  });
}

/**
 * 硬刪：連鎖刪除該聯絡人的所有資料 + 聯絡人本身，並刪 MinIO 媒體附件。
 *
 * 刪除順序（因部分關聯為 Restrict，需在刪 Contact 前顯式刪）：
 *   1. 收集訊息 storageKey（供刪 MinIO）
 *   2. 刪 Conversation（Cascade 帶走 Message / ConversationTag / ChatboxSession）
 *   3. 刪 Case（Conversation 已刪，caseId Restrict 已解除；Cascade 帶走 CaseEvent/CaseNote/CaseTag/CaseRelation）
 *   4. 刪 PortalSubmission / PointTransaction（Restrict，需顯式刪）
 *   5. 刪 Contact（Cascade 帶走 ContactAttribute/ChannelIdentity/IdentityMap/LongTermMemory/ContactTag/ContactRelation）
 *   6. 刪 MinIO 媒體物件（transaction 外，best-effort）
 */
async function hardDelete(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
): Promise<Record<string, number>> {
  // 先在 transaction 外收集 storageKey（transaction 內不做 IO）
  const conversations = await prisma.conversation.findMany({
    where: { contactId, tenantId },
    select: { id: true },
  });
  const convIds = conversations.map((c) => c.id);
  const mediaMessages =
    convIds.length > 0
      ? await prisma.message.findMany({
          where: { conversationId: { in: convIds } },
          select: { content: true },
        })
      : [];
  const storageKeys = collectStorageKeys(mediaMessages);

  const affected = await prisma.$transaction(async (tx) => {
    // 先算 affected 計數（刪除前）
    const [
      messageCount,
      caseCount,
      attributeCount,
      identityCount,
      identityMapCount,
      memoryCount,
      portalSubmissionCount,
      pointTxCount,
    ] = await Promise.all([
      convIds.length > 0
        ? tx.message.count({ where: { conversationId: { in: convIds } } })
        : Promise.resolve(0),
      tx.case.count({ where: { contactId, tenantId } }),
      tx.contactAttribute.count({ where: { contactId } }),
      tx.channelIdentity.count({ where: { contactId } }),
      tx.identityMap.count({ where: { contactId, tenantId } }),
      tx.longTermMemory.count({ where: { contactId } }),
      tx.portalSubmission.count({ where: { contactId, tenantId } }),
      tx.pointTransaction.count({ where: { contactId, tenantId } }),
    ]);

    // 2. 刪 Conversation（Cascade：Message / ConversationTag / ChatboxSession）
    const convDel = await tx.conversation.deleteMany({ where: { contactId, tenantId } });
    // 3. 刪 Case（Cascade：CaseEvent / CaseNote / CaseTag / CaseRelation）
    const caseDel = await tx.case.deleteMany({ where: { contactId, tenantId } });
    // 4. Restrict 關聯需顯式刪
    await tx.portalSubmission.deleteMany({ where: { contactId, tenantId } });
    await tx.pointTransaction.deleteMany({ where: { contactId, tenantId } });
    // 5. 刪 Contact（Cascade 帶走 ContactAttribute/ChannelIdentity/IdentityMap/LongTermMemory/ContactTag/ContactRelation）
    await tx.contact.delete({ where: { id: contactId } });

    return {
      conversations: convDel.count,
      messages: messageCount,
      cases: caseCount,
      contactAttributes: attributeCount,
      channelIdentities: identityCount,
      identityMaps: identityMapCount,
      longTermMemories: memoryCount,
      portalSubmissions: portalSubmissionCount,
      pointTransactions: pointTxCount,
      contacts: 1,
    };
  });

  // 6. 刪 MinIO 媒體物件（transaction 外，best-effort）
  await deleteMediaObjects(storageKeys);

  return { ...affected, mediaObjects: storageKeys.length };
}
