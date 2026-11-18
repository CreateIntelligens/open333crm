/**
 * 資料匯出 worker（GDPR Art.20 可攜權）。
 *
 * 流程：
 *   1. 標記請求 processing
 *   2. cursor 分頁逐表撈本租戶資料（Contact / Conversation / Message / Case 及附屬，以及留言自動私訊的
 *      規則、觸發紀錄、留言者對應；觸發紀錄不含送出內容快照，design D27）
 *   3. 產 JSON（保關聯完整性）+ CSV（主表扁平化），打包成 zip
 *   4. 上傳 MinIO（key: export/{tenantId}/{requestId}.zip），更新 status=completed / fileKey / fileSizeBytes / expiresAt
 *   5. 失敗則 status=failed + error
 *   6. 完成（成功/失敗）經 Redis pub/sub 發站內通知給發起者；發起者已被永久刪除時不送（沒有收件人）
 *
 * 隔離：所有查詢一律以 tenantId 限定；Message/Case 透過 Conversation/Contact 的 tenantId 間接限定。
 */
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { Redis as IORedis } from 'ioredis';
import { claimOne, logger, MinioStorageProvider } from '@open333crm/core';
import { SimpleZip, toCsv } from '../lib/simple-zip.js';
import { enqueueNotification, type NotificationDispatchInput } from '../lib/notification-queue.js';
import { requesterExists } from '../lib/requester.js';

interface DataExportJobData {
  requestId: string;
  tenantId: string;
  requestedBy: string;
}

const PAGE_SIZE = 500;
const RETENTION_DAYS = 7;
const EXPORT_BUCKET = process.env.S3_BUCKET || 'open333crm';

/** cursor 分頁逐批撈某表本租戶資料，避免一次全載入記憶體。回傳全部列（呼叫端序列化後即可釋放）。 */
async function fetchAllPaged<T extends { id: string }>(
  fetchPage: (cursor: string | null) => Promise<T[]>,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await fetchPage(cursor);
    if (page.length === 0) break;
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1].id;
  }
  return all;
}

function pageArgs(cursor: string | null): { take: number; skip?: number; cursor?: { id: string } } {
  return cursor ? { take: PAGE_SIZE, skip: 1, cursor: { id: cursor } } : { take: PAGE_SIZE };
}

/**
 * 逐表撈本租戶資料。
 * Message 無直接 tenantId → 先取本租戶 Conversation id，再以 conversationId 限定。
 */
async function collectTenantData(prisma: PrismaClient, tenantId: string) {
  const contacts = await fetchAllPaged((cursor) =>
    prisma.contact.findMany({
      where: { tenantId },
      orderBy: { id: 'asc' },
      ...pageArgs(cursor),
      include: {
        channelIdentities: true,
        attributes: true,
        tags: { include: { tag: { select: { id: true, name: true } } } },
      },
    }),
  );

  const conversations = await fetchAllPaged((cursor) =>
    prisma.conversation.findMany({
      where: { tenantId },
      orderBy: { id: 'asc' },
      ...pageArgs(cursor),
      include: {
        tags: { include: { tag: { select: { id: true, name: true } } } },
      },
    }),
  );

  const conversationIds = conversations.map((c) => c.id);

  const messages: Array<{ id: string; [k: string]: unknown }> = [];
  // 以 conversationId 分批限定（避免 IN 過大），仍屬本租戶
  for (let i = 0; i < conversationIds.length; i += 100) {
    const batchIds = conversationIds.slice(i, i + 100);
    const batch = await fetchAllPaged((cursor) =>
      prisma.message.findMany({
        where: { conversationId: { in: batchIds } },
        orderBy: { id: 'asc' },
        ...pageArgs(cursor),
      }),
    );
    messages.push(...(batch as typeof messages));
  }

  const cases = await fetchAllPaged((cursor) =>
    prisma.case.findMany({
      where: { tenantId },
      orderBy: { id: 'asc' },
      ...pageArgs(cursor),
      include: {
        notes: true,
        events: true,
        tags: { include: { tag: { select: { id: true, name: true } } } },
      },
    }),
  );

  // 留言自動私訊（design D27）：只讀本表欄位，不 include 渠道（渠道列帶憑證與權杖）
  const commentReplyRules = await fetchAllPaged((cursor) =>
    prisma.commentReplyRule.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, ...pageArgs(cursor) }),
  );
  const commentReplyLogs = (
    await fetchAllPaged((cursor) =>
      prisma.commentReplyLog.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, ...pageArgs(cursor) }),
    )
  ).map(withoutSentSnapshot);
  const commentAuthors = await fetchAllPaged((cursor) =>
    prisma.commentAuthor.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, ...pageArgs(cursor) }),
  );

  return { contacts, conversations, messages, cases, commentReplyRules, commentReplyLogs, commentAuthors };
}

/** 觸發紀錄不匯出送出內容快照的原文（design D27） */
function withoutSentSnapshot<T extends { sentContentSnapshot?: unknown }>(log: T): Omit<T, 'sentContentSnapshot'> {
  const { sentContentSnapshot: _omit, ...rest } = log;
  return rest;
}

/** 主表扁平化欄位（給人看的 CSV，不含巢狀關聯）。 */
function flattenContact(c: Record<string, unknown>): Record<string, unknown> {
  const { channelIdentities, attributes, tags, ...rest } = c as any;
  return rest;
}
function flattenCase(c: Record<string, unknown>): Record<string, unknown> {
  const { notes, events, tags, ...rest } = c as any;
  return rest;
}
function flattenConversation(c: Record<string, unknown>): Record<string, unknown> {
  const { tags, ...rest } = c as any;
  return rest;
}

export async function handleDataExportJob(
  job: Job,
  prisma: PrismaClient,
  redisPublisher: IORedis,
): Promise<void> {
  const { requestId, tenantId, requestedBy } = job.data as DataExportJobData;
  logger.info(`[data-export] Processing request ${requestId} for tenant ${tenantId}`);

  // 確認請求存在且屬本租戶（雙重保險）
  const req = await prisma.dataExportRequest.findFirst({
    where: { id: requestId, tenantId },
    select: { id: true, status: true },
  });
  if (!req) {
    logger.warn(`[data-export] Request ${requestId} not found for tenant ${tenantId}, skipping`);
    return;
  }

  // processing 的請求代表上一次執行中途結束，重新處理；completed、failed、expired 代表已經結束
  // （tenant-data-export「worker 不重新處理已結束的匯出請求」）
  const claimed = await claimOne(() =>
    prisma.dataExportRequest.updateMany({
      where: { id: requestId, tenantId, status: { in: ['pending', 'processing'] } },
      data: { status: 'processing' },
    }),
  );
  if (!claimed) {
    logger.info(`[data-export] Request ${requestId} already finished, skipping`);
    return;
  }

  try {

    const data = await collectTenantData(prisma, tenantId);

    const zip = new SimpleZip();
    const meta = {
      tenantId,
      requestId,
      generatedAt: new Date().toISOString(),
      counts: {
        contacts: data.contacts.length,
        conversations: data.conversations.length,
        messages: data.messages.length,
        cases: data.cases.length,
        commentReplyRules: data.commentReplyRules.length,
        commentReplyLogs: data.commentReplyLogs.length,
        commentAuthors: data.commentAuthors.length,
      },
    };
    zip.addFile('manifest.json', JSON.stringify(meta, null, 2));

    // JSON（保關聯完整性）
    zip.addFile('json/contacts.json', JSON.stringify(data.contacts, null, 2));
    zip.addFile('json/conversations.json', JSON.stringify(data.conversations, null, 2));
    zip.addFile('json/messages.json', JSON.stringify(data.messages, null, 2));
    zip.addFile('json/cases.json', JSON.stringify(data.cases, null, 2));
    zip.addFile('json/comment_reply_rules.json', JSON.stringify(data.commentReplyRules, null, 2));
    zip.addFile('json/comment_reply_logs.json', JSON.stringify(data.commentReplyLogs, null, 2));
    zip.addFile('json/comment_authors.json', JSON.stringify(data.commentAuthors, null, 2));

    // CSV（主表扁平化，給人看）
    zip.addFile('csv/contacts.csv', toCsv(data.contacts.map(flattenContact)));
    zip.addFile('csv/conversations.csv', toCsv(data.conversations.map(flattenConversation)));
    zip.addFile('csv/messages.csv', toCsv(data.messages as Record<string, unknown>[]));
    zip.addFile('csv/cases.csv', toCsv(data.cases.map(flattenCase)));
    zip.addFile('csv/comment_reply_rules.csv', toCsv(data.commentReplyRules as Record<string, unknown>[]));
    zip.addFile('csv/comment_reply_logs.csv', toCsv(data.commentReplyLogs as Record<string, unknown>[]));
    zip.addFile('csv/comment_authors.csv', toCsv(data.commentAuthors as Record<string, unknown>[]));

    const buffer = zip.build();

    // 上傳 MinIO：key = export/{tenantId}/{requestId}.zip
    const fileKey = `export/${tenantId}/${requestId}.zip`;
    const storage = new MinioStorageProvider();
    await storage.upload(EXPORT_BUCKET, fileKey, buffer, 'application/zip');

    const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
    // 只把 processing 改成 completed：兩次執行同時進行時，後完成的那次不再通知。
    // 兩次都上傳到同一個 key，後上傳的覆蓋前一個，內容相同
    const completed = await claimOne(() =>
      prisma.dataExportRequest.updateMany({
        where: { id: requestId, tenantId, status: 'processing' },
        data: {
          status: 'completed',
          fileKey,
          fileSizeBytes: buffer.length,
          expiresAt,
          completedAt: new Date(),
          error: null,
        },
      }),
    );
    if (!completed) {
      logger.info(`[data-export] Request ${requestId} completed by another run, skipping notification`);
      return;
    }

    logger.info(
      `[data-export] Completed request ${requestId}: ${buffer.length} bytes, key=${fileKey}`,
    );

    await notifyRequester(prisma, requestId, {
      tenantId,
      agentId: requestedBy,
      type: 'data_export_ready',
      title: '資料匯出完成',
      body: `您的資料匯出已完成，可於保留期內下載（${RETENTION_DAYS} 天）。`,
      clickUrl: `/dashboard/settings/data-export/${requestId}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[data-export] Failed request ${requestId}: ${message}`, { err });

    const markedFailed = await claimOne(() =>
      prisma.dataExportRequest.updateMany({
        where: { id: requestId, tenantId, status: 'processing' },
        data: { status: 'failed', error: message.slice(0, 1000) },
      }),
    ).catch((e) => {
      logger.error('[data-export] Failed to mark request failed', { e });
      return true;
    });
    // 另一個執行已經完成這個請求：不覆蓋，也不通知失敗
    if (!markedFailed) return;

    await notifyRequester(prisma, requestId, {
      tenantId,
      agentId: requestedBy,
      type: 'data_export_failed',
      title: '資料匯出失敗',
      body: '很抱歉，您的資料匯出未能完成，請稍後重試或聯絡管理員。',
      clickUrl: `/dashboard/settings/data-export/${requestId}`,
    });
  }
}

/**
 * 通知發起者。請求的狀態已經 commit（claim 已成立），重試時 worker 直接結束、不會補送，
 * 所以通知最多送一次：發起者已被永久刪除時不送，查詢或送進佇列失敗只寫 log，不讓工作失敗或重試
 * （AGENTS.md 結構規則 2）。
 */
async function notifyRequester(prisma: PrismaClient, requestId: string, input: NotificationDispatchInput): Promise<void> {
  try {
    if (!(await requesterExists(prisma, input.tenantId, input.agentId))) {
      logger.info(`[data-export] Requester ${input.agentId} of request ${requestId} no longer exists, skipping ${input.type} notification`);
      return;
    }
    await enqueueNotification(input);
  } catch (err) {
    logger.error(`[data-export] Failed to enqueue ${input.type} notification for ${requestId}`, { err });
  }
}

/**
 * 保留期清理：把 expiresAt 已過且仍為 completed 的請求轉 expired，並刪 MinIO 物件。
 * 由 workers 的 repeatable job（queue: data-export-cleanup）定時觸發。
 */
export async function handleDataExportCleanup(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  const expired = await prisma.dataExportRequest.findMany({
    where: { status: 'completed', expiresAt: { lte: now } },
    select: { id: true, tenantId: true, fileKey: true },
    take: 200,
  });

  if (expired.length === 0) return;
  const storage = new MinioStorageProvider();

  for (const e of expired) {
    try {
      if (e.fileKey) {
        await storage.delete(EXPORT_BUCKET, e.fileKey).catch((err) =>
          logger.warn(`[data-export] Cleanup: delete object failed key=${e.fileKey}`, { err }),
        );
      }
      await prisma.dataExportRequest.updateMany({
        where: { id: e.id, tenantId: e.tenantId },
        data: { status: 'expired', fileKey: null },
      });
      logger.info(`[data-export] Cleanup: request ${e.id} expired, object removed`);
    } catch (err) {
      logger.error(`[data-export] Cleanup failed for request ${e.id}`, { err });
    }
  }
}
