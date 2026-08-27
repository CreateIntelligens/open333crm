import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listArticles,
  listSources,
  getArticle,
  createArticle,
  updateArticle,
  deleteArticle,
  publishArticle,
  archiveArticle,
  listCategories,
  semanticSearch,
  batchImportArticles,
  bulkReembed,
  checkOllamaHealth,
  embedArticle,
} from './knowledge.service.js';
import { parseFileToMarkdown, parseSpreadsheetToQaRows } from './file-parser.service.js';
import {
  ingestPartnerDoc,
  parseCmd,
  type PartnerAttachmentInput,
} from './partner-ingest.service.js';
import {
  listFeedback,
  getFeedbackCounts,
  resolveFeedback,
} from './kb-feedback.service.js';
import { refreshModelKeys, getKnownModelKeys } from '../ai/model-registry.service.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { AppError, success, paginated } from '../../shared/utils/response.js';

const createArticleSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  summary: z.string().max(500).optional(),
  category: z.string().max(100).optional(),
  tags: z.array(z.string()).optional(),
});

const updateArticleSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  summary: z.string().max(500).optional(),
  category: z.string().max(100).optional(),
  tags: z.array(z.string()).optional(),
});

const searchSchema = z.object({
  query: z.string().min(1),
  topK: z.coerce.number().int().min(1).max(20).optional(),
  threshold: z.coerce.number().min(0).max(1).optional(),
});

const importSchema = z.object({
  articles: z.array(
    z.object({
      title: z.string().min(1).max(200),
      content: z.string().min(1),
      summary: z.string().max(500).optional(),
      category: z.string().max(100).optional(),
      tags: z.array(z.string()).optional(),
      status: z.string().optional(),
    }),
  ),
});

export default async function knowledgeRoutes(fastify: FastifyInstance) {
  // Auth: most routes require agent JWT; partner-ingest additionally accepts
  // long-lived Partner API keys (Authorization: Bearer pk_...).
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.url.includes('/partner-ingest')) {
      await fastify.authenticateJwtOrPartnerKey(request, reply);
    } else {
      await fastify.authenticate(request, reply);
    }
  });

  // GET /api/v1/knowledge — 文章列表
  fastify.get('/', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '50', 10);

    const result = await listArticles(request.tenantPrisma, request.agent.tenantId, {
      status: query.status || undefined,
      category: query.category || undefined,
      source: query.source || undefined,
      tag: query.tag || undefined,
      q: query.q || undefined,
      page,
      limit,
    });

    return reply.send(paginated(result.articles, result.total, result.page, result.limit));
  });

  // GET /api/v1/knowledge/sources — 來源列表（externalSource 去重）
  fastify.get('/sources', async (request, reply) => {
    const sources = await listSources(request.tenantPrisma, request.agent.tenantId);
    return reply.send(success(sources));
  });

  // GET /api/v1/knowledge/categories — 分類列表
  fastify.get('/categories', async (request, reply) => {
    const categories = await listCategories(request.tenantPrisma, request.agent.tenantId);
    return reply.send(success(categories));
  });

  // ── New routes (registered BEFORE /:id to avoid param collision) ──────────

  // POST /api/v1/knowledge/search — 語義搜尋
  fastify.post('/search', async (request, reply) => {
    const body = searchSchema.parse(request.body);
    const results = await semanticSearch(request.tenantPrisma, request.agent.tenantId, body.query, {
      topK: body.topK,
      threshold: body.threshold,
    });
    return reply.send(success(results));
  });

  // POST /api/v1/knowledge/import — 批量匯入
  fastify.post('/import', { preHandler: [requirePermission('knowledge.manage')] }, async (request, reply) => {
    const body = importSchema.parse(request.body);
    const result = await batchImportArticles(
      request.tenantPrisma,
      request.agent.tenantId,
      request.agent.id,
      body.articles,
    );
    return reply.send(success(result));
  });

  // POST /api/v1/knowledge/upload — 多格式檔案上傳
  fastify.post('/upload', { preHandler: [requirePermission('knowledge.manage')] }, async (request, reply) => {
    const parts = request.files();
    const results: { title: string; success: boolean; error?: string }[] = [];
    let uploaded = 0;
    let failed = 0;

    for await (const part of parts) {
      const buffer = await part.toBuffer();
      try {
        // xlsx/csv 若偵測到 QA 表結構（有問/答欄），自動拆成「一列一篇」，
        // 避免整張表變成單篇大文章（答案被埋沒、無法檢索）。
        const isSheet =
          /spreadsheetml|csv/.test(part.mimetype) ||
          /\.(xlsx|csv)$/i.test(part.filename);
        if (isSheet) {
          const qaRows = parseSpreadsheetToQaRows(buffer);
          if (qaRows && qaRows.length > 0) {
            const result = await batchImportArticles(
              request.tenantPrisma,
              request.agent.tenantId,
              request.agent.id,
              qaRows.map((r) => ({ title: r.title, content: r.content, status: 'PUBLISHED' })),
            );
            uploaded += result.imported;
            failed += result.failed;
            results.push({
              title: `${part.filename}（QA 表自動拆成 ${result.imported} 篇）`,
              success: result.failed === 0,
              error: result.errors[0],
            });
            continue;
          }
          // 偵測不到 QA 欄 → 落到下方單篇匯入
        }

        const parsed = await parseFileToMarkdown(buffer, part.mimetype, part.filename);
        await createArticle(request.tenantPrisma, request.agent.tenantId, request.agent.id, {
          title: parsed.title,
          content: parsed.content,
        });
        uploaded++;
        results.push({ title: parsed.title, success: true });
      } catch (err) {
        failed++;
        results.push({
          title: part.filename,
          success: false,
          error: (err as Error).message,
        });
      }
    }

    return reply.send(success({ uploaded, failed, results }));
  });

  // POST /api/v1/knowledge/partner-ingest — 合作方單筆推送 (multipart/form-data)
  // Fields: cmd (CREATE/UPDATE/DELETE), DocID, Ver, VerCreatTime,
  //         AI_Q, AI_A, Source/Soruce, Spec, IsAttached
  // Files:  Attached (可多檔；DELETE 時忽略)
  // 行為矩陣見 openspec/changes/2026-05-13-partner-ingest-cmd/design.md
  fastify.post(
    '/partner-ingest',
    { preHandler: [requirePermission('knowledge.admin')] },
    async (request, reply) => {
      const fields: Record<string, string> = {};
      const attachments: PartnerAttachmentInput[] = [];

      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (part.fieldname === 'Attached') {
            const buffer = await part.toBuffer();
            attachments.push({
              buffer,
              filename: part.filename,
              mimeType: part.mimetype,
            });
          } else {
            // Drain unrelated file fields so the stream doesn't hang
            await part.toBuffer();
          }
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }

      // Reject non-UTF-8 input early. multipart text fields without an
      // explicit charset are decoded as UTF-8 strict; if the sender pushed
      // e.g. Big5 bytes, every multi-byte char collapses to U+FFFD before we
      // ever see it. Writing that to DB is destructive (raw bytes are lost),
      // so we 400 the request instead and surface enough info for the sender
      // to fix their client.
      const REPLACEMENT_CHAR = '�';
      const badFields: { name: string; preview: string; hex: string }[] = [];
      for (const [name, value] of Object.entries(fields)) {
        if (value.includes(REPLACEMENT_CHAR)) {
          badFields.push({
            name,
            preview: value.slice(0, 80),
            hex: Buffer.from(value, 'utf8').subarray(0, 80).toString('hex'),
          });
        }
      }
      for (const att of attachments) {
        if (att.filename.includes(REPLACEMENT_CHAR)) {
          badFields.push({
            name: `Attached.filename(${att.filename.slice(0, 40)})`,
            preview: att.filename,
            hex: Buffer.from(att.filename, 'utf8').toString('hex'),
          });
        }
      }
      if (badFields.length > 0) {
        request.log.warn(
          { docId: fields.DocID, cmd: fields.cmd, badFields },
          '[PartnerIngest] rejected: non-UTF-8 fields detected',
        );
        return reply.status(400).send({
          success: false,
          error: {
            code: 'NON_UTF8_FIELDS',
            message:
              'One or more multipart fields are not valid UTF-8. ' +
              'Likely your HTTP client is sending Big5/GBK bytes; ' +
              'convert text to UTF-8 (and set Content-Type charset=utf-8) before sending.',
            details: { fields: badFields.map((f) => f.name) },
          },
        });
      }

      try {
        const cmd = parseCmd(fields.cmd);

        const docId = fields.DocID ?? '';
        if (!docId) {
          throw new AppError('DocID is required', 'BAD_REQUEST', 400);
        }

        // Tolerate Stanley's typo: accept both Source and Soruce
        const source = fields.Source ?? fields.Soruce ?? '';

        const result = await ingestPartnerDoc(
          request.tenantPrisma,
          request.agent.tenantId,
          request.agent.id,
          {
            cmd,
            docId,
            ver: Number(fields.Ver) || 0,
            verCreatTime: fields.VerCreatTime ?? '',
            aiQ: fields.AI_Q ?? '',
            aiA: fields.AI_A ?? '',
            source,
            spec: fields.Spec,
            isAttached: fields.IsAttached === 'true',
            attachments: cmd === 'DELETE' ? [] : attachments,
          },
        );
        return reply.send(success(result));
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({
            success: false,
            error: { code: err.code, message: err.message },
          });
        }
        request.log.error({ err }, '[PartnerIngest] unexpected failure');
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INGEST_FAILED',
            message: (err as Error).message,
          },
        });
      }
    },
  );

  // POST /api/v1/knowledge/bulk-embed — 重新向量化所有已發布文章
  // Returns immediately with article count; embedding runs in the background
  // to avoid Caddy gateway timeouts on cold-start Ollama (model loading +
  // per-article inference can easily exceed 60s for any non-trivial KB).
  fastify.post('/bulk-embed', { preHandler: [requirePermission('knowledge.manage')] }, async (request, reply) => {
    const tenantId = request.agent.tenantId;
    const total = await request.tenantPrisma.kmArticle.count({
      where: { tenantId, status: 'PUBLISHED' },
    });

    bulkReembed(request.tenantPrisma, tenantId).catch((err) => {
      fastify.log.error({ err }, '[Knowledge] Background bulk re-embed failed');
    });

    return reply.send(
      success({
        started: true,
        total,
        message: `已開始重新嵌入 ${total} 篇文章，請稍後刷新「服務狀態」查看進度。`,
      }),
    );
  });

  // GET /api/v1/knowledge/embedding-status — 嵌入服務健康檢查
  fastify.get('/embedding-status', async (request, reply) => {
    const status = await checkOllamaHealth(request.tenantPrisma, request.agent.tenantId);
    return reply.send(success(status));
  });

  // ── 型號白名單（型號守門用）────────────────────────────────────────────────

  // GET /api/v1/knowledge/models — 目前知識庫已知型號清單（快取，供診斷）
  fastify.get('/models', async (request, reply) => {
    const keys = await getKnownModelKeys(request.tenantPrisma, request.agent.tenantId, Date.now());
    const models = [...keys].sort();
    return reply.send(success({ total: models.length, models }));
  });

  // POST /api/v1/knowledge/models/refresh — 立即重抽型號白名單（清快取後重建）
  // 客服新增型號文章後不想等 TTL（10 分鐘）自動刷新時使用。
  fastify.post(
    '/models/refresh',
    { preHandler: [requirePermission('knowledge.admin')] },
    async (request, reply) => {
      const keys = await refreshModelKeys(request.tenantPrisma, request.agent.tenantId, Date.now());
      return reply.send(
        success({ refreshed: true, total: keys.size, message: `已重新整理型號清單，共 ${keys.size} 個型號。` }),
      );
    },
  );

  // ── KB 回報（AI 回答品質回饋）────────────────────────────────────────────

  // GET /api/v1/knowledge/feedback/counts — 各文章 open 回報數 map
  fastify.get('/feedback/counts', async (request, reply) => {
    const counts = await getFeedbackCounts(request.tenantPrisma, request.agent.tenantId);
    return reply.send(success(counts));
  });

  // GET /api/v1/knowledge/feedback?articleId=&status=open — 回報明細
  fastify.get('/feedback', async (request, reply) => {
    const q = request.query as { articleId?: string; status?: string };
    const list = await listFeedback(request.tenantPrisma, request.agent.tenantId, {
      articleId: q.articleId,
      status: q.status,
    });
    return reply.send(success(list));
  });

  // PATCH /api/v1/knowledge/feedback/:id/resolve — 標記已處理
  fastify.patch<{ Params: { id: string } }>(
    '/feedback/:id/resolve',
    { preHandler: [requirePermission('knowledge.admin')] },
    async (request, reply) => {
      await resolveFeedback(request.tenantPrisma, request.params.id, request.agent.tenantId);
      return reply.send(success({ resolved: true }));
    },
  );

  // ── Existing CRUD routes ──────────────────────────────────────────────────

  // POST /api/v1/knowledge — 新建文章
  fastify.post('/', { preHandler: [requirePermission('knowledge.manage')] }, async (request, reply) => {
    const data = createArticleSchema.parse(request.body);
    const article = await createArticle(
      request.tenantPrisma,
      request.agent.tenantId,
      request.agent.id,
      data,
    );
    return reply.status(201).send(success(article));
  });

  // GET /api/v1/knowledge/:id — 文章詳情
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const article = await getArticle(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(article));
  });

  // PATCH /api/v1/knowledge/:id — 更新文章
  fastify.patch<{ Params: { id: string } }>('/:id', { preHandler: [requirePermission('knowledge.manage')] }, async (request, reply) => {
    const data = updateArticleSchema.parse(request.body);
    const article = await updateArticle(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
      data,
    );
    return reply.send(success(article));
  });

  // DELETE /api/v1/knowledge/:id — 刪除文章
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [requirePermission('knowledge.manage')] }, async (request, reply) => {
    const result = await deleteArticle(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(result));
  });

  // POST /api/v1/knowledge/:id/publish — 發布文章
  fastify.post<{ Params: { id: string } }>('/:id/publish', { preHandler: [requirePermission('knowledge.manage')] }, async (request, reply) => {
    const article = await publishArticle(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(article));
  });

  // POST /api/v1/knowledge/:id/archive — 封存文章
  fastify.post<{ Params: { id: string } }>('/:id/archive', { preHandler: [requirePermission('knowledge.manage')] }, async (request, reply) => {
    const article = await archiveArticle(
      request.tenantPrisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(article));
  });

  // POST /api/v1/knowledge/:id/embed — 強制重新向量化單篇文章
  fastify.post<{ Params: { id: string } }>('/:id/embed', { preHandler: [requirePermission('knowledge.manage')] }, async (request, reply) => {
    await embedArticle(request.tenantPrisma, request.params.id);
    return reply.send(success({ embedded: true }));
  });
}
