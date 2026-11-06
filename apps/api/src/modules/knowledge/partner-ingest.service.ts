/**
 * Partner Ingest Service
 *
 * Receives one document at a time from a partner system (e.g. Stanley's
 * "Chatbot" feeder) via HTTP multipart and upserts it into KmArticle.
 *
 * 動作由 `cmd` 決定（CREATE / UPDATE / DELETE）。`Ver` 仍會檢查以防止亂序
 * 重送把新版蓋成舊版：CREATE/UPDATE 收到 `Ver` ≤ 既有版本一律回 skipped。
 * DELETE 採軟刪：status → ARCHIVED，附件保留但 RAG 檢索端會排除。
 *
 * 詳細行為矩陣見：
 *   openspec/changes/2026-05-13-partner-ingest-cmd/design.md
 *
 * 收 TenantCtx，不呼叫儲存服務（change migrate-knowledge-tenant-ctx，design D4）。附件由 flow 在交易外
 * 上傳，這裡只寫附件的資料列；向量化由 flow 在 commit 之後開始。
 */

import type { Prisma } from '@prisma/client';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
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

/** flow 在交易外上傳成功的附件 */
export interface UploadedAttachment {
  filename: string;
  storageKey: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
}

export interface PartnerDocSnapshot {
  id: string;
  externalVer: number;
  status: string;
}

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

export async function findPartnerDoc(ctx: TenantCtx, docId: string): Promise<PartnerDocSnapshot | null> {
  return ctx.tx.kmArticle.findUnique({
    where: { tenantId_externalDocId: { tenantId: ctx.tenantId, externalDocId: docId } },
    select: { id: true, externalVer: true, status: true },
  });
}

/**
 * CREATE / UPDATE 依既有的文章決定結果。衝突與找不到時丟 AppError；版本不夠新時回 skipped 的結果；
 * 可以寫入時回 null。交易 1 與交易 2 都呼叫這個函式，所以兩次判斷的規則相同（design D4）。
 */
export function decidePartnerWrite(
  input: PartnerDocInput,
  existing: PartnerDocSnapshot | null,
): PartnerIngestResult | null {
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

  return null;
}

/** cmd=DELETE：軟刪除，附件保留（主規格「Partner Doc Mutation Command」） */
export async function archivePartnerDoc(
  ctx: TenantCtx,
  input: PartnerDocInput,
  existing: PartnerDocSnapshot | null,
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
  await ctx.tx.kmArticle.update({ where: { id: existing.id }, data: { status: 'ARCHIVED' } });
  await ctx.tx.$executeRawUnsafe(`UPDATE km_articles SET embedding = NULL WHERE id = $1::uuid`, existing.id);

  logger.info(`[PartnerIngest] DELETE (soft) DocID=${input.docId} articleId=${existing.id}`);
  return {
    status: 'deleted',
    articleId: existing.id,
    externalDocId: input.docId,
    externalVer: existing.externalVer,
    attachmentsLinked: 0,
  };
}

/**
 * CREATE / UPDATE 寫入文章與附件的資料列。既有的文章整批覆蓋附件；先前是 ARCHIVED 時視為復活。
 * removedKeys 是被刪掉的附件資料列的檔案，由 flow 在 commit 之後刪除（design D3）。
 */
export async function writePartnerArticle(
  ctx: TenantCtx,
  agentId: string,
  input: PartnerDocInput,
  existing: PartnerDocSnapshot | null,
  attachments: UploadedAttachment[],
): Promise<{ result: PartnerIngestResult; removedKeys: string[] }> {
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
    metadata: Object.keys(metadataExtras).length > 0 ? (metadataExtras as Prisma.InputJsonValue) : undefined,
  };

  let articleId: string;
  let status: PartnerIngestStatus;
  let removedKeys: string[] = [];

  if (existing) {
    const old = await ctx.tx.kmArticleAttachment.findMany({ where: { articleId: existing.id }, select: { storageKey: true } });
    removedKeys = old.map((a) => a.storageKey);
    await ctx.tx.kmArticleAttachment.deleteMany({ where: { articleId: existing.id } });
    await ctx.tx.kmArticle.update({ where: { id: existing.id }, data: dataCommon });
    articleId = existing.id;
    status = existing.status === 'ARCHIVED' ? 'revived' : 'updated';
  } else {
    const created = await ctx.tx.kmArticle.create({
      data: { tenantId: ctx.tenantId, createdById: agentId, ...dataCommon },
      select: { id: true },
    });
    articleId = created.id;
    status = 'created';
  }

  if (attachments.length > 0) {
    await ctx.tx.kmArticleAttachment.createMany({
      data: attachments.map((att) => ({ articleId, ...att })),
    });
  }

  logger.info(`[PartnerIngest] ${status} DocID=${input.docId} ver=${input.ver} attachments=${attachments.length}`);

  return {
    result: { status, articleId, externalDocId: input.docId, externalVer: input.ver, attachmentsLinked: attachments.length },
    removedKeys,
  };
}
