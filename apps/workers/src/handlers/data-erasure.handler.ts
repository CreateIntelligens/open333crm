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

/**
 * 物件儲存公開網址的來源與路徑前綴。格式是 {S3_PUBLIC_URL}/{bucket}/{key}（apps/api s3.provider）。
 * S3_PUBLIC_URL 要與 api 相同；沒設定時不比對來源，只要求路徑從 /{bucket}/ 開始。
 */
function storagePublicBase(): { origin: string | null; prefix: string } {
  const raw = process.env.S3_PUBLIC_URL;
  if (!raw) return { origin: null, prefix: `/${MEDIA_BUCKET}/` };
  const base = new URL(raw);
  return { origin: base.origin, prefix: `${base.pathname.replace(/\/*$/, '')}/${MEDIA_BUCKET}/` };
}

/**
 * 從聯絡人的 avatarUrl 與渠道身分的 profilePic 抽出本租戶 avatars 目錄下的頭像檔 key。
 * 網址的來源要是物件儲存、路徑要從 {bucket}/ 開始，key 要完全是 {tenantId}/avatars/{uuid}.{ext}；
 * 平台網址、其他租戶與其他格式的檔案不收。
 */
function collectAvatarKeys(tenantId: string, urls: (string | null | undefined)[]): string[] {
  const { origin, prefix } = storagePublicBase();
  const keyPattern = new RegExp(`^${tenantId}/avatars/[0-9a-f-]{36}\\.(?:jpg|png|webp|gif)$`);
  const keys = new Set<string>();
  for (const url of urls) {
    if (!url) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (!parsed.pathname.startsWith(prefix)) continue;
    const key = parsed.pathname.slice(prefix.length);
    if (!keyPattern.test(key)) continue;
    if (origin && parsed.origin !== origin) {
      // 看起來是本租戶的頭像檔、來源卻不同：多半是 workers 的 S3_PUBLIC_URL 與 api 不一致，記下來才查得到
      logger.warn(`[data-erasure] 頭像網址的來源與 S3_PUBLIC_URL 不同，不刪除 origin=${parsed.origin}`);
      continue;
    }
    keys.add(key);
  }
  return [...keys];
}

/**
 * 交易內讀出聯絡人與渠道身分的頭像檔 key（刪除前讀，刪除後就找不到了）。
 * 以 FOR UPDATE 鎖住這幾筆：背景補存頭像（apps/api inbound-avatar-refresh）正要寫回時，
 * 刪除會等它寫完、讀到新的檔案；刪除先鎖住時，補存寫回找不到身分，會自己刪掉剛上傳的檔案。
 */
async function readAvatarKeys(tx: Prisma.TransactionClient, tenantId: string, contactId: string): Promise<string[]> {
  const contacts = await tx.$queryRaw<{ avatarUrl: string | null }[]>`
    SELECT "avatarUrl" FROM contacts
    WHERE id = ${contactId}::uuid AND "tenantId" = ${tenantId}::uuid
    FOR UPDATE`;
  const identities = await tx.$queryRaw<{ profilePic: string | null }[]>`
    SELECT ci."profilePic" FROM channel_identities ci
    JOIN contacts c ON c.id = ci."contactId"
    WHERE ci."contactId" = ${contactId}::uuid AND c."tenantId" = ${tenantId}::uuid
    FOR UPDATE OF ci`;
  return collectAvatarKeys(tenantId, [...contacts.map((c) => c.avatarUrl), ...identities.map((i) => i.profilePic)]);
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
 *  - 交易後刪除聯絡人與渠道身分在物件儲存的頭像檔（IDENT-06 起頭像存在 avatars 目錄）
 */
async function anonymize(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
): Promise<Record<string, number>> {
  let avatarKeys: string[] = [];
  const affected = await prisma.$transaction(async (tx) => {
    avatarKeys = await readAvatarKeys(tx, tenantId, contactId);

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

  // 頭像檔在交易外刪（best-effort），與硬刪除的媒體檔相同
  await deleteMediaObjects(avatarKeys);
  return { ...affected, avatarObjects: avatarKeys.length };
}

/**
 * 硬刪：連鎖刪除該聯絡人的所有資料 + 聯絡人本身，並刪 MinIO 媒體附件。
 *
 * 刪除順序（因部分關聯為 Restrict，需在刪 Contact 前顯式刪）：
 *   1. 收集訊息 storageKey 與頭像檔 key（供刪 MinIO）
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
  // storageKey 收集移進 transaction 內：與後續刪除共用同一交易快照，避免「收集後、刪除前」
  // 期間新增的對話/訊息其 MinIO 物件漏收（媒體洩漏）。DB 讀取在交易內、MinIO 刪除留到交易外。
  let storageKeys: string[] = [];
  let avatarCount = 0;
  const affected = await prisma.$transaction(async (tx) => {
    const conversations = await tx.conversation.findMany({
      where: { contactId, tenantId },
      select: { id: true },
    });
    const convIds = conversations.map((c) => c.id);
    const mediaMessages =
      convIds.length > 0
        ? await tx.message.findMany({
            where: { conversationId: { in: convIds } },
            select: { content: true },
          })
        : [];
    storageKeys = collectStorageKeys(mediaMessages);
    const avatarKeys = await readAvatarKeys(tx, tenantId, contactId);
    avatarCount = avatarKeys.length;
    storageKeys = [...new Set([...storageKeys, ...avatarKeys])];

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

  return { ...affected, mediaObjects: storageKeys.length - avatarCount, avatarObjects: avatarCount };
}
