/**
 * GDPR 資料刪除（被遺忘權，Art.17）worker handler。
 *
 * 兩種模式：
 *  - anonymize（預設）：抹去 Contact 的 PII 欄位、刪除可識別的子資料（ContactAttribute /
 *    ChannelIdentity / IdentityMap / LongTermMemory）、抹去 inbound 訊息內容並刪除其 MinIO 媒體檔，
 *    但保留 Conversation / Case 統計骨架（讓報表數字不變）與客服上傳的出站媒體檔。留言自動私訊的留言者對應與
 *    觸發紀錄清除個資、保留留言 ID（design D27）。
 *  - hard_delete：在 transaction 內先算 affected 計數，再連鎖刪除該聯絡人的所有資料與聯絡人本身，
 *    並刪除對應的 MinIO 媒體附件。
 *
 * 刪除影響目標 contactId 與併入他的封存聯絡人（沿 mergedIntoId 逐層往下，#473），兩者套用相同的規則；
 * 不波及同租戶其他聯絡人。
 * 刪除的交易內更新 status/affected、寫租戶稽核（payload 只含 contactId/mode/affected 計數，絕不含 PII），
 * commit 之後通知發起者。發起者已被永久刪除時稽核記下請求上的名稱與 email 快照，不送通知。
 */
import type { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Redis as IORedis } from 'ioredis';
import { claimOne, isConversationMediaKey, logger, MinioStorageProvider } from '@open333crm/core';
import { enqueueNotification } from '../lib/notification-queue.js';
import { requesterExists } from '../lib/requester.js';

interface DataErasureJobData {
  requestId: string;
  tenantId: string;
  contactId: string;
  mode: 'anonymize' | 'hard_delete';
  requestedBy: string;
}

/** 刪除的結果：commit 之後的影響計數，以及要不要通知發起者 */
interface ErasureOutcome {
  affected: Record<string, number>;
  /** 發起的成員還在；已被永久刪除時沒有收件人，不送通知 */
  notifyRequester: boolean;
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

interface MessageMediaObjects {
  /** 要刪除的 key */
  keys: string[];
  /** 同一批對話裡保留下來的訊息還在引用、所以保留的檔案數 */
  shared: number;
  /** 不是本租戶、本次對話媒體目錄格式的 key，沒刪的檔案數 */
  skipped: number;
}

/**
 * 從要刪除（或改寫）的訊息挑出可以刪的媒體檔：只留本租戶、本次對話媒體目錄的 key；
 * 保留下來的訊息（例如匿名化時的出站訊息）還在引用的 key 不刪。
 */
function selectMessageMedia(
  tenantId: string,
  convIds: string[],
  removed: { content: Prisma.JsonValue }[],
  kept: { content: Prisma.JsonValue }[],
): MessageMediaObjects {
  const convSet = new Set(convIds);
  const candidates = collectStorageKeys(removed);
  const valid = candidates.filter((key) => isConversationMediaKey(key, tenantId, convSet));
  const skipped = candidates.length - valid.length;
  if (skipped > 0) {
    logger.warn(`[data-erasure] ${skipped} 個訊息媒體檔不在本租戶這些對話的 media 目錄，沒有刪除`);
  }
  const inUse = new Set(collectStorageKeys(kept));
  const keys = valid.filter((key) => !inUse.has(key));
  return { keys, shared: valid.length - keys.length, skipped };
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
  const keyPattern = new RegExp(`^${tenantId}/avatars/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:jpg|png|webp|gif)$`);
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

/** 併入 contactId 的封存聯絡人（沿 mergedIntoId 逐層往下；UNION 去重，資料有環也會結束），不含 contactId 本身 */
async function findMergedContacts(tx: Prisma.TransactionClient, tenantId: string, contactId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE merged AS (
      SELECT id FROM contacts
      WHERE "mergedIntoId" = ${contactId}::uuid AND "tenantId" = ${tenantId}::uuid AND "isArchived" = true
      UNION
      SELECT c.id FROM contacts c
      JOIN merged m ON c."mergedIntoId" = m.id
      WHERE c."tenantId" = ${tenantId}::uuid AND c."isArchived" = true
    )
    SELECT id FROM merged WHERE id <> ${contactId}::uuid`;
  return rows.map((r) => r.id);
}

/** 依 id 排序以 FOR UPDATE 鎖住聯絡人列（與合併引擎、lockContactsForMerge 相同的排序，避免死結） */
async function lockContacts(tx: Prisma.TransactionClient, tenantId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw`
    SELECT id FROM contacts
    WHERE id = ANY(${[...new Set(ids)].sort()}::uuid[]) AND "tenantId" = ${tenantId}::uuid
    ORDER BY id
    FOR UPDATE`;
}

/**
 * 交易內找出這次刪除處理的聯絡人並鎖住：目標聯絡人與併入他的封存聯絡人（#473）。回傳 [目標, ...封存聯絡人]。
 * 先讀出封存聯絡人，與目標一起依 id 排序鎖住；鎖住之後再讀一次（READ COMMITTED 新的語句快照），
 * 讀的期間剛 commit 的合併帶來的封存聯絡人也鎖住，已解除合併而不再屬於這條鏈的不處理。
 * 之後的合併與解除合併都要先鎖目標或這些聯絡人，會等這個交易結束。
 */
async function lockErasureContacts(tx: Prisma.TransactionClient, tenantId: string, contactId: string): Promise<string[]> {
  const before = await findMergedContacts(tx, tenantId, contactId);
  await lockContacts(tx, tenantId, [contactId, ...before]);
  const merged = await findMergedContacts(tx, tenantId, contactId);
  await lockContacts(tx, tenantId, merged.filter((id) => !before.includes(id)));
  return [contactId, ...merged];
}

/**
 * 交易內讀出這批聯絡人與渠道身分的頭像檔（刪除前讀，刪除後就找不到了）。呼叫前聯絡人列已由 lockErasureContacts 鎖住。
 * 以 FOR UPDATE 鎖住渠道身分：背景補存頭像（apps/api inbound-avatar-refresh）正要寫回時，
 * 刪除會等它寫完、讀到新的檔案；刪除先鎖住時，補存寫回找不到身分，會自己刪掉剛上傳的檔案。
 * 這批聯絡人以外，同租戶其他聯絡人或渠道身分還在用的檔案保留。合併時主聯絡人會沿用被併入那位的頭像網址，
 * 被併入那位也在這批裡，所以一起刪除。
 */
async function readAvatarObjects(tx: Prisma.TransactionClient, tenantId: string, contactIds: string[]): Promise<AvatarObjects> {
  const contacts = await tx.$queryRaw<{ avatarUrl: string | null }[]>`
    SELECT "avatarUrl" FROM contacts
    WHERE id = ANY(${contactIds}::uuid[]) AND "tenantId" = ${tenantId}::uuid
    FOR UPDATE`;
  const identities = await tx.$queryRaw<{ profilePic: string | null }[]>`
    SELECT ci."profilePic" FROM channel_identities ci
    JOIN contacts c ON c.id = ci."contactId"
    WHERE ci."contactId" = ANY(${contactIds}::uuid[]) AND c."tenantId" = ${tenantId}::uuid
    FOR UPDATE OF ci`;
  const { byKey, skipped } = collectAvatarKeys(tenantId, [
    ...contacts.map((c) => c.avatarUrl),
    ...identities.map((i) => i.profilePic),
  ]);
  if (byKey.size === 0) return { keys: [], shared: 0, skipped };

  const urls = [...byKey.values()];
  const [otherContacts, otherIdentities] = await Promise.all([
    tx.contact.findMany({
      where: { tenantId, id: { notIn: contactIds }, avatarUrl: { in: urls } },
      select: { avatarUrl: true },
    }),
    tx.channelIdentity.findMany({
      where: { contactId: { notIn: contactIds }, contact: { tenantId }, profilePic: { in: urls } },
      select: { profilePic: true },
    }),
  ]);
  const inUse = new Set([...otherContacts.map((c) => c.avatarUrl), ...otherIdentities.map((i) => i.profilePic)]);
  const keys = [...byKey].filter(([, url]) => !inUse.has(url)).map(([key]) => key);
  return { keys, shared: byKey.size - keys.length, skipped };
}

/**
 * 交易內鎖住這批聯絡人的對話並回傳 id（呼叫前聯絡人列必須已由 lockErasureContacts 以 FOR UPDATE 鎖住）。
 * 鎖的順序：聯絡人 → 對話 → 讀訊息。
 *  - 聯絡人已鎖：插入新對話時外鍵檢查要對聯絡人取 FOR KEY SHARE，會等這個交易結束，不會有漏掉的新對話。
 *  - 對話 FOR UPDATE：插入訊息時外鍵檢查要對對話取 FOR KEY SHARE。已在進行、還沒 commit 的插入，
 *    這裡會等它 commit；之後才開始的插入會等這個交易結束。
 *  - 之後讀訊息是新的語句快照（READ COMMITTED），看得到剛 commit 的進站訊息，媒體 key 不會漏收。
 */
async function lockContactConversations(tx: Prisma.TransactionClient, tenantId: string, contactIds: string[]): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM conversations
    WHERE "contactId" = ANY(${contactIds}::uuid[]) AND "tenantId" = ${tenantId}::uuid
    ORDER BY id
    FOR UPDATE`;
  return rows.map((r) => r.id);
}

/**
 * 交易內鎖住這批聯絡人的留言者對應（comment_authors）並回傳 id（呼叫前聯絡人列已由 lockErasureContacts 鎖住）。
 *  - 聯絡人已鎖：收件流程替這批聯絡人新建留言者對應時，外鍵檢查要對聯絡人取 FOR KEY SHARE，會等這個交易結束。
 *  - 留言者 FOR UPDATE：新的觸發紀錄要對留言者取 FOR KEY SHARE，會等這個交易結束；硬刪除後它的外鍵檢查失敗，
 *    不會在刪除與刪聯絡人之間插進一筆紀錄，讓 Restrict 擋下整個刪除交易。
 */
async function lockCommentAuthors(tx: Prisma.TransactionClient, tenantId: string, contactIds: string[]): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM comment_authors
    WHERE "contactId" = ANY(${contactIds}::uuid[]) AND "tenantId" = ${tenantId}::uuid
    ORDER BY id
    FOR UPDATE`;
  return rows.map((r) => r.id);
}

/**
 * 匿名化留言自動私訊的個資（design D27）：
 *  - 留言者對應清空名稱、帳號名稱與私訊 ID，留言者 ID 改成 `erased:<authorId>`（唯一鍵 [channelId, externalUserId]
 *    仍成立；同一位留言者再留言時找不到這筆，會當成新的留言者）。
 *  - 觸發紀錄清空留言者 ID、名稱、帳號名稱、留言內容、私訊 ID、去重鍵與送出內容快照；保留留言 ID（唯一鍵
 *    [channelId, commentId] 讓 Meta 重投同一則留言時不再私訊）、狀態與時間。
 */
async function anonymizeCommentReplies(
  tx: Prisma.TransactionClient,
  tenantId: string,
  authorIds: string[],
): Promise<{ commentAuthors: number; commentReplyLogs: number }> {
  if (authorIds.length === 0) return { commentAuthors: 0, commentReplyLogs: 0 };
  const logs = await tx.commentReplyLog.updateMany({
    where: { tenantId, commentAuthorId: { in: authorIds } },
    data: {
      commenterId: null,
      commenterName: null,
      commenterUsername: null,
      commentText: null,
      recipientUid: null,
      dedupeKey: null,
      sentContentSnapshot: Prisma.DbNull,
    },
  });
  // externalUserId 每筆不同，逐筆改（一位聯絡人每個渠道最多一筆留言者對應）
  for (const id of authorIds) {
    await tx.commentAuthor.updateMany({
      where: { tenantId, id },
      data: { displayName: null, username: null, psid: null, externalUserId: `erased:${id}` },
    });
  }
  return { commentAuthors: authorIds.length, commentReplyLogs: logs.count };
}

/**
 * 刪除一批 MinIO 物件，每個 key 最多刪一次、不重試。單顆失敗不阻斷刪除流程：
 * 失敗的 key 寫 log，筆數回傳給呼叫端記進請求的 affected。
 */
async function deleteMediaObjects(keys: string[]): Promise<{ deleted: number; failed: number }> {
  if (keys.length === 0) return { deleted: 0, failed: 0 };
  const storage = new MinioStorageProvider();
  let failed = 0;
  for (const key of keys) {
    try {
      await storage.delete(MEDIA_BUCKET, key);
    } catch (err) {
      failed += 1;
      logger.error(`[data-erasure] MinIO delete failed key=${key}:`, err);
    }
  }
  return { deleted: keys.length - failed, failed };
}

/**
 * 交易 commit 之後刪除訊息媒體檔與頭像檔，有失敗時把筆數補寫進請求與完成稽核的 affected。
 * 交易內已把 mediaObjectsFailed / avatarObjectsFailed 寫成 0，沒有失敗就不用再寫。
 * 請求與稽核在同一個交易補寫，兩者的 affected 保持相同；補寫失敗時兩者都維持交易內寫入的值
 * （失敗筆數是 0），失敗筆數只留在 error log。
 */
async function deleteObjectsAfterCommit(
  prisma: PrismaClient,
  request: ErasureRequestRef,
  committed: CommittedErasure,
  mediaKeys: string[],
  avatarKeys: string[],
): Promise<ErasureOutcome> {
  const { affected, auditId, notifyRequester } = committed;
  const media = await deleteMediaObjects(mediaKeys);
  const avatars = await deleteMediaObjects(avatarKeys);
  if (media.failed === 0 && avatars.failed === 0) return { affected, notifyRequester };

  const updated = { ...affected, mediaObjectsFailed: media.failed, avatarObjectsFailed: avatars.failed };
  try {
    await prisma.$transaction(async (tx) => {
      await tx.dataErasureRequest.updateMany({
        where: { id: request.requestId, tenantId: request.tenantId },
        data: { affected: updated as Prisma.InputJsonValue },
      });
      await tx.tenantAuditLog.updateMany({
        where: { id: auditId, tenantId: request.tenantId },
        data: { payload: completionPayload(request, updated) },
      });
    });
    return { affected: updated, notifyRequester };
  } catch (err) {
    logger.error(
      `[data-erasure] failed to record object delete failures for ${request.requestId} ` +
        `(mediaObjectsFailed=${media.failed}, avatarObjectsFailed=${avatars.failed}):`,
      err,
    );
    return { affected, notifyRequester };
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

    // 完成狀態與完成稽核在刪除的交易內寫入：刪除最多 commit 一次，稽核寫不進去時刪除一起 rollback
    const request: ErasureRequestRef = { requestId, tenantId, contactId, mode, requestedBy };
    const { affected, notifyRequester } =
      mode === 'hard_delete'
        ? await hardDelete(prisma, tenantId, contactId, request)
        : await anonymize(prisma, tenantId, contactId, request);

    // 以下在 claim（completed）commit 之後：重試時 worker 看到 completed 直接結束，不會補送，
    // 所以通知最多送一次，送不進佇列只寫 log，不讓工作失敗（AGENTS.md 結構規則 2）
    if (!notifyRequester) {
      logger.info(`[data-erasure] Requester ${requestedBy} of request ${requestId} no longer exists, skipping notification`);
    } else {
      try {
        await enqueueNotification({
          tenantId,
          agentId: requestedBy,
          type: 'data_erasure_done',
          title: '資料刪除完成',
          body: mode === 'hard_delete' ? '聯絡人資料已永久刪除。' : '聯絡人個資已匿名化。',
        });
      } catch (err) {
        logger.error(`[data-erasure] failed to enqueue completion notification for ${requestId}:`, err);
      }
    }

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
  contactId: string;
  mode: DataErasureJobData['mode'];
  /** 工作內容的發起者 ID；成員被永久刪除後請求的 requestedBy 是空值，這裡仍是原本的 ID */
  requestedBy: string | undefined;
}

/** 刪除交易 commit 的結果 */
interface CommittedErasure {
  affected: Record<string, number>;
  /** 完成稽核的 ID：commit 之後補寫失敗筆數時，請求與稽核一起更新 */
  auditId: string;
  notifyRequester: boolean;
}

/** 完成稽核的 payload：只含 contactId/mode/affected 計數，絕不含 PII */
function completionPayload(request: ErasureRequestRef, affected: Record<string, number>): Prisma.InputJsonValue {
  return { contactId: request.contactId, mode: request.mode, affected } as Prisma.InputJsonValue;
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

/**
 * 刪除交易的最後一步：寫入影響計數與 data.erasure.complete 稽核，與 completed 一起 commit。
 *
 * 以 tenantId 查發起的成員。他已被永久刪除時 actorId 寫空值（寫他的 ID 會違反外鍵），
 * 名稱與 email 取自請求上的快照（purgeAgent 刪除成員之前寫入，issue #414）。
 * 交易的第一個語句 markCompleted 已鎖住請求列。永久刪除成員時要更新同一列的快照，會等這個交易 commit，
 * 所以查到成員之後、寫入稽核之前，成員不會被刪除；之後它寫稽核快照時也看得到這筆稽核。
 */
async function recordCompletion(
  tx: Prisma.TransactionClient,
  request: ErasureRequestRef,
  affected: Record<string, number>,
): Promise<CommittedErasure> {
  await tx.dataErasureRequest.update({
    where: { id: request.requestId },
    data: { affected: affected as Prisma.InputJsonValue },
  });

  const exists = await requesterExists(tx, request.tenantId, request.requestedBy);
  const snapshot = exists
    ? null
    : await tx.dataErasureRequest.findFirst({
        where: { id: request.requestId, tenantId: request.tenantId },
        select: { requestedByName: true, requestedByEmail: true },
      });

  const audit = await tx.tenantAuditLog.create({
    data: {
      tenantId: request.tenantId,
      actorId: exists ? request.requestedBy : null,
      actorName: snapshot?.requestedByName ?? null,
      actorEmail: snapshot?.requestedByEmail ?? null,
      action: 'data.erasure.complete',
      targetType: 'contact',
      targetId: request.contactId,
      payload: completionPayload(request, affected),
    },
    select: { id: true },
  });
  return { affected, auditId: audit.id, notifyRequester: exists };
}

/**
 * 匿名化：抹去 PII 但保留統計骨架。目標聯絡人與併入他的封存聯絡人套用相同的規則（#473）。
 *  - Contact：displayName→佔位、avatarUrl/phone/email→null（封存聯絡人維持封存）
 *  - 刪 ContactAttribute / ChannelIdentity / IdentityMap / LongTermMemory（可識別子資料）
 *  - inbound 訊息 content 改為 redacted 佔位（保留 Conversation/Case/Message 骨架不刪）；
 *    改寫前先讀出 storageKey，否則資料庫再也找不到這些媒體檔（#329）
 *  - 交易後刪除 inbound 訊息的媒體檔（出站訊息還在引用的保留），以及聯絡人與渠道身分在物件儲存的
 *    頭像檔（IDENT-06 起頭像存在 avatars 目錄）
 */
async function anonymize(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
  request: ErasureRequestRef,
): Promise<ErasureOutcome> {
  let avatars: AvatarObjects = { keys: [], shared: 0, skipped: 0 };
  let media: MessageMediaObjects = { keys: [], shared: 0, skipped: 0 };
  const committed = await prisma.$transaction(async (tx) => {
    await markCompleted(tx, request);
    // 鎖的順序：聯絡人（目標與封存聯絡人）→ 對話 → 讀訊息
    const contactIds = await lockErasureContacts(tx, tenantId, contactId);
    const mergedIds = contactIds.slice(1);
    const ofContacts = { in: contactIds };
    avatars = await readAvatarObjects(tx, tenantId, contactIds);

    // 抹 Contact PII
    const redactedFields = {
      displayName: REDACTED,
      avatarUrl: null,
      phone: null,
      email: null,
    };
    await tx.contact.update({ where: { id: contactId }, data: redactedFields });
    if (mergedIds.length > 0) {
      await tx.contact.updateMany({ where: { id: { in: mergedIds }, tenantId }, data: redactedFields });
    }

    // 刪可識別的子資料（只綁在這批聯絡人）
    const attrs = await tx.contactAttribute.deleteMany({ where: { contactId: ofContacts } });
    const identities = await tx.channelIdentity.deleteMany({ where: { contactId: ofContacts } });
    const identityMaps = await tx.identityMap.deleteMany({ where: { contactId: ofContacts, tenantId } });
    const memories = await tx.longTermMemory.deleteMany({ where: { contactId: ofContacts } });

    // 留言自動私訊：留言者對應與觸發紀錄的個資（鎖的順序：聯絡人 → 留言者 → 對話）
    const commentReplies = await anonymizeCommentReplies(tx, tenantId, await lockCommentAuthors(tx, tenantId, contactIds));

    // 抹 inbound 訊息內容（只這批聯絡人所屬對話的入站訊息；保留骨架）。
    // 先鎖對話，等並行寫入的進站訊息 commit，再讀訊息與改寫（見 lockContactConversations）
    const convIds = await lockContactConversations(tx, tenantId, contactIds);
    let messagesRedacted = 0;
    if (convIds.length > 0) {
      // 改寫內容前讀出媒體檔：進站訊息的要刪，保留下來的出站訊息還在引用的不刪
      const messages = await tx.message.findMany({
        where: { conversationId: { in: convIds } },
        select: { direction: true, content: true },
      });
      media = selectMessageMedia(
        tenantId,
        convIds,
        messages.filter((m) => m.direction === 'INBOUND'),
        messages.filter((m) => m.direction !== 'INBOUND'),
      );
      const res = await tx.message.updateMany({
        where: { conversationId: { in: convIds }, direction: 'INBOUND' },
        data: { content: { redacted: true } as Prisma.InputJsonValue },
      });
      messagesRedacted = res.count;
    }

    const counts = {
      mergedContacts: mergedIds.length,
      contactAttributes: attrs.count,
      channelIdentities: identities.count,
      identityMaps: identityMaps.count,
      longTermMemories: memories.count,
      commentAuthors: commentReplies.commentAuthors,
      commentReplyLogs: commentReplies.commentReplyLogs,
      messagesRedacted,
      mediaObjects: media.keys.length,
      mediaObjectsShared: media.shared,
      mediaObjectsSkipped: media.skipped,
      mediaObjectsFailed: 0,
      avatarObjects: avatars.keys.length,
      avatarObjectsShared: avatars.shared,
      avatarObjectsSkipped: avatars.skipped,
      avatarObjectsFailed: 0,
    };
    return recordCompletion(tx, request, counts);
  });

  // 媒體檔與頭像檔在交易 commit 之後刪，與硬刪除相同
  return deleteObjectsAfterCommit(prisma, request, committed, media.keys, avatars.keys);
}

/**
 * 硬刪：連鎖刪除該聯絡人與併入他的封存聯絡人（#473）的所有資料 + 這些聯絡人本身，並刪 MinIO 媒體附件。
 *
 * 刪除順序（因部分關聯為 Restrict，需在刪 Contact 前顯式刪）：
 *   1. 鎖住目標與封存聯絡人，收集訊息 storageKey（只留本租戶這些對話的 media 目錄）與頭像檔 key（供刪 MinIO）
 *   2. 刪 Conversation（Cascade 帶走 Message / ConversationTag / ChatboxSession）
 *   3. 刪 Case（Conversation 已刪，caseId Restrict 已解除；Cascade 帶走 CaseEvent/CaseNote/CaseTag/CaseRelation）
 *   4. 刪 PortalSubmission / PointTransaction（Restrict，需顯式刪）；留言自動私訊先刪觸發紀錄（對留言者 Restrict）
 *      再刪留言者對應（design D27）
 *   5. 刪 Contact（Cascade 帶走 ContactAttribute/ChannelIdentity/IdentityMap/LongTermMemory/ContactTag/ContactRelation）
 *   6. 刪 MinIO 媒體物件（transaction 外，每個最多一次，失敗筆數記進 affected）
 */
async function hardDelete(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
  request: ErasureRequestRef,
): Promise<ErasureOutcome> {
  // storageKey 收集移進 transaction 內：與後續刪除共用同一交易快照，避免「收集後、刪除前」
  // 期間新增的對話/訊息其 MinIO 物件漏收（媒體洩漏）。DB 讀取在交易內、MinIO 刪除留到交易外。
  let media: MessageMediaObjects = { keys: [], shared: 0, skipped: 0 };
  let avatars: AvatarObjects = { keys: [], shared: 0, skipped: 0 };
  const committed = await prisma.$transaction(async (tx) => {
    await markCompleted(tx, request);
    // 鎖的順序：聯絡人（目標與封存聯絡人）→ 對話 → 讀訊息，並行寫入的進站訊息也會收到（見 lockContactConversations）
    const contactIds = await lockErasureContacts(tx, tenantId, contactId);
    const mergedIds = contactIds.slice(1);
    const ofContacts = { in: contactIds };
    avatars = await readAvatarObjects(tx, tenantId, contactIds);
    const authorIds = await lockCommentAuthors(tx, tenantId, contactIds);
    const convIds = await lockContactConversations(tx, tenantId, contactIds);
    const mediaMessages =
      convIds.length > 0
        ? await tx.message.findMany({
            where: { conversationId: { in: convIds } },
            select: { content: true },
          })
        : [];
    // 訊息全部刪除，沒有保留下來的訊息會引用
    media = selectMessageMedia(tenantId, convIds, mediaMessages, []);

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
      tx.case.count({ where: { contactId: ofContacts, tenantId } }),
      tx.contactAttribute.count({ where: { contactId: ofContacts } }),
      tx.channelIdentity.count({ where: { contactId: ofContacts } }),
      tx.identityMap.count({ where: { contactId: ofContacts, tenantId } }),
      tx.longTermMemory.count({ where: { contactId: ofContacts } }),
      tx.portalSubmission.count({ where: { contactId: ofContacts, tenantId } }),
      tx.pointTransaction.count({ where: { contactId: ofContacts, tenantId } }),
    ]);

    // 2. 刪 Conversation（Cascade：Message / ConversationTag / ChatboxSession）
    const convDel = await tx.conversation.deleteMany({ where: { contactId: ofContacts, tenantId } });
    // 3. 刪 Case（Cascade：CaseEvent / CaseNote / CaseTag / CaseRelation）
    const caseDel = await tx.case.deleteMany({ where: { contactId: ofContacts, tenantId } });
    // 4. Restrict 關聯需顯式刪（封存聯絡人有合併時轉出點數的積分紀錄）
    await tx.portalSubmission.deleteMany({ where: { contactId: ofContacts, tenantId } });
    await tx.pointTransaction.deleteMany({ where: { contactId: ofContacts, tenantId } });
    // 留言自動私訊：觸發紀錄對留言者是 Restrict，先刪紀錄；留言者對應雖會隨聯絡人 Cascade，顯式刪才有筆數
    const commentReplyLogs =
      authorIds.length > 0
        ? (await tx.commentReplyLog.deleteMany({ where: { tenantId, commentAuthorId: { in: authorIds } } })).count
        : 0;
    const commentAuthors =
      authorIds.length > 0 ? (await tx.commentAuthor.deleteMany({ where: { tenantId, id: { in: authorIds } } })).count : 0;
    // 5. 刪 Contact（Cascade 帶走 ContactAttribute/ChannelIdentity/IdentityMap/LongTermMemory/ContactTag/ContactRelation）
    if (mergedIds.length > 0) {
      await tx.contact.deleteMany({ where: { id: { in: mergedIds }, tenantId } });
    }
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
      commentReplyLogs,
      commentAuthors,
      contacts: 1 + mergedIds.length,
      mergedContacts: mergedIds.length,
      mediaObjects: media.keys.length,
      mediaObjectsSkipped: media.skipped,
      mediaObjectsFailed: 0,
      avatarObjects: avatars.keys.length,
      avatarObjectsShared: avatars.shared,
      avatarObjectsSkipped: avatars.skipped,
      avatarObjectsFailed: 0,
    };
    return recordCompletion(tx, request, counts);
  });

  // 6. 刪 MinIO 媒體物件（transaction 外）。交易 commit 之後行程結束時，檔案會留下
  return deleteObjectsAfterCommit(prisma, request, committed, media.keys, avatars.keys);
}
