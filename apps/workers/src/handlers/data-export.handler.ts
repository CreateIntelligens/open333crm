/**
 * 資料匯出 worker（GDPR Art.20 可攜權）。
 *
 * 流程：
 *   1. 標記請求 processing
 *   2. cursor 分頁逐表撈本租戶資料（Contact / Conversation / Message / Case 及附屬）
 *   3. 產 JSON（保關聯完整性）+ CSV（主表扁平化），打包成 zip
 *   4. 上傳 MinIO（key: export/{tenantId}/{requestId}.zip），更新 status=completed / fileKey / fileSizeBytes / expiresAt
 *   5. 失敗則 status=failed + error
 *   6. 完成（成功/失敗）經 Redis pub/sub 發站內通知給發起者
 *
 * 隔離：所有查詢一律以 tenantId 限定；Message/Case 透過 Conversation/Contact 的 tenantId 間接限定。
 */
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';
import { logger, MinioStorageProvider } from '@open333crm/core';
import { SimpleZip, toCsv } from '../lib/simple-zip.js';
import { enqueueNotification } from '../lib/notification-queue.js';

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

  return { contacts, conversations, messages, cases };
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

  try {
    await prisma.dataExportRequest.updateMany({
      where: { id: requestId, tenantId },
      data: { status: 'processing' },
    });

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
      },
    };
    zip.addFile('manifest.json', JSON.stringify(meta, null, 2));

    // JSON（保關聯完整性）
    zip.addFile('json/contacts.json', JSON.stringify(data.contacts, null, 2));
    zip.addFile('json/conversations.json', JSON.stringify(data.conversations, null, 2));
    zip.addFile('json/messages.json', JSON.stringify(data.messages, null, 2));
    zip.addFile('json/cases.json', JSON.stringify(data.cases, null, 2));

    // CSV（主表扁平化，給人看）
    zip.addFile('csv/contacts.csv', toCsv(data.contacts.map(flattenContact)));
    zip.addFile('csv/conversations.csv', toCsv(data.conversations.map(flattenConversation)));
    zip.addFile('csv/messages.csv', toCsv(data.messages as Record<string, unknown>[]));
    zip.addFile('csv/cases.csv', toCsv(data.cases.map(flattenCase)));

    const buffer = zip.build();

    // 上傳 MinIO：key = export/{tenantId}/{requestId}.zip
    const fileKey = `export/${tenantId}/${requestId}.zip`;
    const storage = new MinioStorageProvider();
    await storage.upload(EXPORT_BUCKET, fileKey, buffer, 'application/zip');

    const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await prisma.dataExportRequest.updateMany({
      where: { id: requestId, tenantId },
      data: {
        status: 'completed',
        fileKey,
        fileSizeBytes: buffer.length,
        expiresAt,
        completedAt: new Date(),
        error: null,
      },
    });

    logger.info(
      `[data-export] Completed request ${requestId}: ${buffer.length} bytes, key=${fileKey}`,
    );

    await enqueueNotification({
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

    await prisma.dataExportRequest
      .updateMany({
        where: { id: requestId, tenantId },
        data: { status: 'failed', error: message.slice(0, 1000) },
      })
      .catch((e) => logger.error('[data-export] Failed to mark request failed', { e }));

    await enqueueNotification({
      tenantId,
      agentId: requestedBy,
      type: 'data_export_failed',
      title: '資料匯出失敗',
      body: '很抱歉，您的資料匯出未能完成，請稍後重試或聯絡管理員。',
      clickUrl: `/dashboard/settings/data-export/${requestId}`,
    }).catch((e) => logger.error('[data-export] Failed to enqueue failure notification', { e }));
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
