/**
 * Partner Ingest Service
 *
 * Receives one document at a time from a partner system (e.g. Stanley's
 * "Chatbot" feeder) via HTTP multipart and upserts it into KmArticle.
 *
 * 動作由 `cmd` 決定（CREATE / UPDATE / DELETE）。`Ver` 仍會檢查以防止亂序
 * 重送把新版蓋成舊版：CREATE/UPDATE 收到 `Ver` ≤ 既有版本一律回 skipped。
 * DELETE 採軟刪：status → ARCHIVED，附件保留但檢索端會排除。
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import { uploadFile } from '../storage/storage.service.js';
import { embedArticle } from '../embedding/embedding.service.js';
import { logger } from '@open333crm/core';
import { AppError } from '../../shared/utils/response.js';

export type PartnerCmd = 'CREATE' | 'UPDATE' | 'DELETE';

export interface PartnerAttachmentInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface PartnerDocInput {
  cmd: PartnerCmd;
  docId: string;
  ver: number;
  verCreatTime: string;
  aiQ: string;
  aiA: string;
  source: string;
  spec?: string;
  isAttached: boolean;
  attachments: PartnerAttachmentInput[];
}

export type PartnerIngestStatus =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'revived'
  | 'skipped';

export interface PartnerIngestResult {
  status: PartnerIngestStatus;
  reason?: string;
  articleId: string;
  externalDocId: string;
  externalVer: number;
  attachmentsLinked: number;
}

export function parseCmd(raw: string | undefined): PartnerCmd {
  const value = (raw ?? '').trim().toUpperCase();
  if (value === 'CREATE' || value === 'UPDATE' || value === 'DELETE') {
    return value;
  }
  throw new AppError(
    `cmd must be CREATE, UPDATE or DELETE (got "${raw ?? ''}")`,
    'INVALID_CMD',
    400,
  );
}

const MS_DATE_RE = /\/Date\((\d+)\)\//;

function parseVerCreatTime(input: string): Date | null {
  const m = input.match(MS_DATE_RE);
  if (!m) return null;
  const ms = Number(m[1]);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

function parseSpec(raw?: string): { spec: Prisma.InputJsonValue | undefined; specRaw?: string } {
  if (!raw) return { spec: undefined };
  try {
    const parsed = JSON.parse(raw);
    return { spec: parsed as Prisma.InputJsonValue };
  } catch {
    return { spec: undefined, specRaw: raw };
  }
}

function deriveSummary(content: string, max = 200): string {
  const trimmed = content.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export async function ingestPartnerDoc(
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
  input: PartnerDocInput,
): Promise<PartnerIngestResult> {
  if (!input.docId) {
    throw new AppError('DocID is required', 'BAD_REQUEST', 400);
  }

  const existing = await prisma.kmArticle.findUnique({
    where: { tenantId_externalDocId: { tenantId, externalDocId: input.docId } },
    select: { id: true, externalVer: true, status: true },
  });

  if (input.cmd === 'DELETE') {
    return handleDelete(prisma, input, existing);
  }

  // CREATE 要求 DocID 不存在或處於 ARCHIVED（復活）；既有且 PUBLISHED 視為衝突。
  if (input.cmd === 'CREATE' && existing && existing.status !== 'ARCHIVED') {
    throw new AppError(
      `DocID "${input.docId}" already exists (use cmd=UPDATE instead)`,
      'DOCID_CONFLICT',
      409,
    );
  }

  // UPDATE 必須要有既有的 article（含 ARCHIVED — 視為已刪除，請改送 CREATE 復活）。
  if (input.cmd === 'UPDATE' && (!existing || existing.status === 'ARCHIVED')) {
    throw new AppError(
      `DocID "${input.docId}" not found (use cmd=CREATE instead)`,
      'DOCID_NOT_FOUND',
      404,
    );
  }

  // 版本保護：CREATE/UPDATE 都要求 Ver 嚴格大於既有版本，避免亂序重送。
  if (existing && input.ver <= existing.externalVer) {
    return {
      status: 'skipped',
      reason: `incoming ver ${input.ver} ≤ existing ver ${existing.externalVer}`,
      articleId: existing.id,
      externalDocId: input.docId,
      externalVer: existing.externalVer,
      attachmentsLinked: 0,
    };
  }

  return writeArticle(prisma, tenantId, agentId, input, existing);
}

async function handleDelete(
  prisma: PrismaClient,
  input: PartnerDocInput,
  existing: { id: string; externalVer: number; status: string } | null,
): Promise<PartnerIngestResult> {
  // 不存在 → idempotent，當作已刪除
  if (!existing) {
    logger.info(`[PartnerIngest] DELETE noop (not found) DocID=${input.docId}`);
    return {
      status: 'deleted',
      reason: 'not found (idempotent)',
      articleId: '',
      externalDocId: input.docId,
      externalVer: input.ver,
      attachmentsLinked: 0,
    };
  }

  // 已 ARCHIVED → 也視為 idempotent，不重複動作
  if (existing.status === 'ARCHIVED') {
    return {
      status: 'deleted',
      reason: 'already archived (idempotent)',
      articleId: existing.id,
      externalDocId: input.docId,
      externalVer: existing.externalVer,
      attachmentsLinked: 0,
    };
  }

  // 軟刪：標記為 ARCHIVED + 清空向量（避免被檢索吐回）
  await prisma.kmArticle.update({
    where: { id: existing.id },
    data: { status: 'ARCHIVED' },
  });
  await prisma.$executeRawUnsafe(
    `UPDATE km_articles SET embedding = NULL WHERE id = $1::uuid`,
    existing.id,
  );

  logger.info(`[PartnerIngest] DELETE (soft) DocID=${input.docId} articleId=${existing.id}`);
  return {
    status: 'deleted',
    articleId: existing.id,
    externalDocId: input.docId,
    externalVer: existing.externalVer,
    attachmentsLinked: 0,
  };
}

async function writeArticle(
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
  input: PartnerDocInput,
  existing: { id: string; externalVer: number; status: string } | null,
): Promise<PartnerIngestResult> {
  const { spec, specRaw } = parseSpec(input.spec);
  const importedAt = parseVerCreatTime(input.verCreatTime);
  const summary = deriveSummary(input.aiA);
  const metadataExtras: Record<string, unknown> = {};
  if (specRaw) metadataExtras.specRaw = specRaw;

  const dataCommon = {
    title: input.aiQ || `(DocID ${input.docId})`,
    content: input.aiA,
    summary,
    category: input.source || '',
    tags: [] as string[],
    status: 'PUBLISHED' as const,
    externalDocId: input.docId,
    externalVer: input.ver,
    externalSource: input.source,
    spec: spec as Prisma.InputJsonValue | undefined,
    importedAt,
    metadata: Object.keys(metadataExtras).length > 0
      ? (metadataExtras as Prisma.InputJsonValue)
      : undefined,
  };

  let articleId: string;
  let status: PartnerIngestStatus;

  if (existing) {
    // 既有 → 整批覆蓋附件 + 更新內容；若先前是 ARCHIVED 視為復活
    await prisma.kmArticleAttachment.deleteMany({ where: { articleId: existing.id } });
    await prisma.kmArticle.update({
      where: { id: existing.id },
      data: dataCommon,
    });
    articleId = existing.id;
    status = existing.status === 'ARCHIVED' ? 'revived' : 'updated';
  } else {
    const created = await prisma.kmArticle.create({
      data: {
        tenantId,
        createdById: agentId,
        ...dataCommon,
      },
      select: { id: true },
    });
    articleId = created.id;
    status = 'created';
  }

  let attachmentsLinked = 0;
  if (input.isAttached && input.attachments.length > 0) {
    for (const att of input.attachments) {
      try {
        const { key, url } = await uploadFile(
          att.buffer,
          att.filename,
          att.mimeType,
          tenantId,
          'media',
          `kb/${input.docId}`,
        );
        await prisma.kmArticleAttachment.create({
          data: {
            articleId,
            filename: att.filename,
            storageKey: key,
            url,
            mimeType: att.mimeType,
            sizeBytes: att.buffer.length,
          },
        });
        attachmentsLinked++;
      } catch (err) {
        logger.error(
          `[PartnerIngest] Failed to upload attachment "${att.filename}" for DocID ${input.docId}: ${(err as Error).message}`,
        );
      }
    }
  }

  embedArticle(prisma, articleId).catch((err) => {
    logger.error(
      `[PartnerIngest] Embedding failed for article ${articleId} (DocID ${input.docId}): ${(err as Error).message}`,
    );
  });

  logger.info(
    `[PartnerIngest] ${status} DocID=${input.docId} ver=${input.ver} attachments=${attachmentsLinked}`,
  );

  return {
    status,
    articleId,
    externalDocId: input.docId,
    externalVer: input.ver,
    attachmentsLinked,
  };
}
