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
import type { Redis as IORedis } from 'ioredis';
import { claimOne, logger, MinioStorageProvider } from '@open333crm/core';
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
 * 物件儲存公開網址的來源與路徑前綴。格式是 {S3_PUBLIC_URL}/{bucket}/{key}（apps/api s3.provider，path-style），
 * S3_PUBLIC_URL 可以帶路徑前綴，要與 api 的設定相同。沒設定或格式錯誤時回 null：無法確認是自己的檔案，就不刪。
 */
function storagePublicBase(): { origin: string; prefix: string } | null {
  const raw = process.env.S3_PUBLIC_URL;
  if (!raw) return null;
  try {
    const base = new URL(raw);
    return { origin: base.origin, prefix: `${base.pathname.replace(/\/*$/, '')}/${MEDIA_BUCKET}/` };
  } catch {
    return null;
  }
}

interface AvatarObjects {
  /** 要刪除的 key */
  keys: string[];
  /** 其他聯絡人或渠道身分還在用、所以保留的檔案數 */
  shared: number;
  /** 看起來是本租戶的頭像檔、卻無法確認來源（S3_PUBLIC_URL 沒設定或不同）而沒刪的檔案數 */
  skipped: number;
}

/**
 * 從頭像網址抽出本租戶 avatars 目錄下的頭像檔：網址的來源要等於 S3_PUBLIC_URL 的來源，
 * 路徑（查詢字串與 fragment 不算）要是 {前綴}/{bucket}/{tenantId}/avatars/{uuid}.{jpg|png|webp|gif}。
 * @returns key → 網址；skipped 是格式符合、來源卻無法確認的筆數
 */
function collectAvatarKeys(
  tenantId: string,
  urls: (string | null | undefined)[],
): { byKey: Map<string, string>; skipped: number } {
  const base = storagePublicBase();
  const keyPattern = new RegExp(`^${tenantId}/avatars/[0-9a-f-]{36}\\.(?:jpg|png|webp|gif)$`);
  const byKey = new Map<string, string>();
  let skipped = 0;
  for (const url of urls) {
    if (!url) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    const at = parsed.pathname.indexOf(`/${MEDIA_BUCKET}/${tenantId}/avatars/`);
    if (at < 0 || !keyPattern.test(parsed.pathname.slice(at + MEDIA_BUCKET.length + 2))) continue;
    if (!base || parsed.origin !== base.origin || !parsed.pathname.startsWith(base.prefix)) {
      skipped += 1;
      continue;
    }
    byKey.set(parsed.pathname.slice(base.prefix.length), url);
  }
  if (skipped > 0) {
    logger.warn(`[data-erasure] ${skipped} 個頭像檔無法確認是自己的物件儲存（檢查 workers 的 S3_PUBLIC_URL 是否與 api 相同），沒有刪除`);
  }
  return { byKey, skipped };
}

/**
 * 交易內讀出聯絡人與渠道身分的頭像檔（刪除前讀，刪除後就找不到了）。
 * 以 FOR UPDATE 鎖住這幾筆：背景補存頭像（apps/api inbound-avatar-refresh）正要寫回時，
 * 刪除會等它寫完、讀到新的檔案；刪除先鎖住時，補存寫回找不到身分，會自己刪掉剛上傳的檔案。
 * 同租戶其他聯絡人或渠道身分還在用的檔案保留：合併時主聯絡人會沿用被併入那位的頭像網址。
 */
async function readAvatarObjects(tx: Prisma.TransactionClient, tenantId: string, contactId: string): Promise<AvatarObjects> {
  const contacts = await tx.$queryRaw<{ avatarUrl: string | null }[]>`
    SELECT "avatarUrl" FROM contacts
    WHERE id = ${contactId}::uuid AND "tenantId" = ${tenantId}::uuid
    FOR UPDATE`;
  const identities = await tx.$queryRaw<{ profilePic: string | null }[]>`
    SELECT ci."profilePic" FROM channel_identities ci
    JOIN contacts c ON c.id = ci."contactId"
    WHERE ci."contactId" = ${contactId}::uuid AND c."tenantId" = ${tenantId}::uuid
    FOR UPDATE OF ci`;
  const { byKey, skipped } = collectAvatarKeys(tenantId, [
    ...contacts.map((c) => c.avatarUrl),
    ...identities.map((i) => i.profilePic),
  ]);
  if (byKey.size === 0) return { keys: [], shared: 0, skipped };

  const urls = [...byKey.values()];
  const [otherContacts, otherIdentities] = await Promise.all([
    tx.contact.findMany({
      where: { tenantId, id: { not: contactId }, avatarUrl: { in: urls } },
      select: { avatarUrl: true },
    }),
    tx.channelIdentity.findMany({
      where: { contactId: { not: contactId }, contact: { tenantId }, profilePic: { in: urls } },
      select: { profilePic: true },
    }),
  ]);
  const inUse = new Set([...otherContacts.map((c) => c.avatarUrl), ...otherIdentities.map((i) => i.profilePic)]);
  const keys = [...byKey].filter(([, url]) => !inUse.has(url)).map(([key]) => key);
  return { keys, shared: byKey.size - keys.length, skipped };
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

  // 標記 processing。processing 的請求代表上一次執行中途結束，重新處理；
  // completed、failed 代表已經結束，不再處理（tenant-data-erasure「worker 不重新處理已結束的刪除請求」）
  const claimed = await claimOne(() =>
    prisma.dataErasureRequest.updateMany({
      where: { id: requestId, tenantId, status: { in: ['pending', 'processing'] } },
      data: { status: 'processing' },
    }),
  );
  if (!claimed) {
    logger.info(`[data-erasure] Request ${requestId} already finished, skipping`);
    return;
  }

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

    // 完成狀態在刪除的交易內寫入：刪除最多 commit 一次
    const request = { requestId, tenantId };
    if (mode === 'hard_delete') {
      affected = await hardDelete(prisma, tenantId, contactId, request);
    } else {
      affected = await anonymize(prisma, tenantId, contactId, request);
    }

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
    if (err === ALREADY_COMPLETED) {
      logger.info(`[data-erasure] Request ${requestId} completed by another run, skipping`);
      return;
    }
    logger.error(`[data-erasure] Failed request ${requestId}:`, err);
    // 只把 processing 改成 failed：另一個執行已經完成時（例如它刪掉了聯絡人）不覆蓋 completed
    await claimOne(() =>
      prisma.dataErasureRequest.updateMany({
        where: { id: requestId, tenantId, status: 'processing' },
        data: {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        },
      }),
    );
    throw err; // 讓 BullMQ 記錄失敗
  }
}

const ALREADY_COMPLETED = Symbol('data-erasure-already-completed');

interface ErasureRequestRef {
  requestId: string;
  tenantId: string;
}

/**
 * 刪除交易的第一個語句：把 processing 改成 completed。兩次執行同時進行時，後到的交易在這裡等待列鎖；
 * 前一個交易 commit 之後更新筆數是 0，丟出 ALREADY_COMPLETED 讓後到的交易 rollback，不會再刪一次。
 */
async function markCompleted(tx: Prisma.TransactionClient, request: ErasureRequestRef): Promise<void> {
  const claimed = await claimOne(() =>
    tx.dataErasureRequest.updateMany({
      where: { id: request.requestId, tenantId: request.tenantId, status: 'processing' },
      data: { status: 'completed', completedAt: new Date(), error: null },
    }),
  );
  if (!claimed) throw ALREADY_COMPLETED;
}

/** 刪除交易的最後一個語句：寫入影響計數 */
async function writeAffected(tx: Prisma.TransactionClient, request: ErasureRequestRef, affected: Record<string, number>) {
  await tx.dataErasureRequest.update({
    where: { id: request.requestId },
    data: { affected: affected as Prisma.InputJsonValue },
  });
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
  request: ErasureRequestRef,
): Promise<Record<string, number>> {
  let avatars: AvatarObjects = { keys: [], shared: 0, skipped: 0 };
  const affected = await prisma.$transaction(async (tx) => {
    await markCompleted(tx, request);
    avatars = await readAvatarObjects(tx, tenantId, contactId);

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

    const counts = {
      contactAttributes: attrs.count,
      channelIdentities: identities.count,
      identityMaps: identityMaps.count,
      longTermMemories: memories.count,
      messagesRedacted,
      avatarObjects: avatars.keys.length,
      avatarObjectsShared: avatars.shared,
      avatarObjectsSkipped: avatars.skipped,
    };
    await writeAffected(tx, request, counts);
    return counts;
  });

  // 頭像檔在交易外刪（best-effort），與硬刪除的媒體檔相同
  await deleteMediaObjects(avatars.keys);
  return affected;
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
  request: ErasureRequestRef,
): Promise<Record<string, number>> {
  // storageKey 收集移進 transaction 內：與後續刪除共用同一交易快照，避免「收集後、刪除前」
  // 期間新增的對話/訊息其 MinIO 物件漏收（媒體洩漏）。DB 讀取在交易內、MinIO 刪除留到交易外。
  let storageKeys: string[] = [];
  let avatars: AvatarObjects = { keys: [], shared: 0, skipped: 0 };
  const affected = await prisma.$transaction(async (tx) => {
    await markCompleted(tx, request);
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
    avatars = await readAvatarObjects(tx, tenantId, contactId);

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

    const counts = {
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
      mediaObjects: storageKeys.length,
      avatarObjects: avatars.keys.length,
      avatarObjectsShared: avatars.shared,
      avatarObjectsSkipped: avatars.skipped,
    };
    await writeAffected(tx, request, counts);
    return counts;
  });

  // 6. 刪 MinIO 媒體物件（transaction 外，best-effort）。交易 commit 之後行程結束時，檔案會留下
  await deleteMediaObjects([...storageKeys, ...avatars.keys]);

  return affected;
}
