/**
 * Partner Ingest Service
 *
 * Receives one document at a time from a partner system (e.g. Stanley's
 * "Chatbot" feeder) via HTTP multipart and upserts it into KmArticle.
 *
 * Versioning is governed by `Ver`:
 *   - new DocID         → create
 *   - existing, newer   → update + replace attachments + re-embed
 *   - existing, same/old → skip (idempotent retries)
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import { uploadFile } from '../storage/storage.service.js';
import { embedArticle } from '../embedding/embedding.service.js';
import { logger } from '@open333crm/core';

export interface PartnerAttachmentInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface PartnerDocInput {
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

export interface PartnerIngestResult {
  status: 'created' | 'updated' | 'skipped';
  reason?: string;
  articleId: string;
  externalDocId: string;
  externalVer: number;
  attachmentsLinked: number;
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
    throw new Error('DocID is required');
  }

  const { spec, specRaw } = parseSpec(input.spec);
  const importedAt = parseVerCreatTime(input.verCreatTime);

  // 1. Look up existing article by (tenantId, externalDocId)
  const existing = await prisma.kmArticle.findUnique({
    where: { tenantId_externalDocId: { tenantId, externalDocId: input.docId } },
    select: { id: true, externalVer: true },
  });

  // 2. Skip if not newer
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

  // 3. Build common data payload
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
  let status: 'created' | 'updated';

  if (existing) {
    // 4a. Update existing + delete old attachments (cascade replacement)
    await prisma.kmArticleAttachment.deleteMany({ where: { articleId: existing.id } });
    await prisma.kmArticle.update({
      where: { id: existing.id },
      data: dataCommon,
    });
    articleId = existing.id;
    status = 'updated';
  } else {
    // 4b. Create new
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

  // 5. Upload attachments + create attachment rows
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

  // 6. Fire-and-forget re-embedding (so KB search reflects the latest content)
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
