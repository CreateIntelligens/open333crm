import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listArticles,
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
import { parseFileToMarkdown } from './file-parser.service.js';
import {
  ingestPartnerDoc,
  type PartnerAttachmentInput,
} from './partner-ingest.service.js';
import { requireSupervisor } from '../../guards/rbac.guard.js';
import { success, paginated } from '../../shared/utils/response.js';

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
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/knowledge — 文章列表
  fastify.get('/', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '50', 10);

    const result = await listArticles(fastify.prisma, request.agent.tenantId, {
      status: query.status || undefined,
      category: query.category || undefined,
      q: query.q || undefined,
      page,
      limit,
    });

    return reply.send(paginated(result.articles, result.total, result.page, result.limit));
  });

  // GET /api/v1/knowledge/categories — 分類列表
  fastify.get('/categories', async (request, reply) => {
    const categories = await listCategories(fastify.prisma, request.agent.tenantId);
    return reply.send(success(categories));
  });

  // ── New routes (registered BEFORE /:id to avoid param collision) ──────────

  // POST /api/v1/knowledge/search — 語義搜尋
  fastify.post('/search', async (request, reply) => {
    const body = searchSchema.parse(request.body);
    const results = await semanticSearch(fastify.prisma, request.agent.tenantId, body.query, {
      topK: body.topK,
      threshold: body.threshold,
    });
    return reply.send(success(results));
  });

  // POST /api/v1/knowledge/import — 批量匯入
  fastify.post('/import', async (request, reply) => {
    const body = importSchema.parse(request.body);
    const result = await batchImportArticles(
      fastify.prisma,
      request.agent.tenantId,
      request.agent.id,
      body.articles,
    );
    return reply.send(success(result));
  });

  // POST /api/v1/knowledge/upload — 多格式檔案上傳
  fastify.post('/upload', async (request, reply) => {
    const parts = request.files();
    const results: { title: string; success: boolean; error?: string }[] = [];
    let uploaded = 0;
    let failed = 0;

    for await (const part of parts) {
      const buffer = await part.toBuffer();
      try {
        const parsed = await parseFileToMarkdown(buffer, part.mimetype, part.filename);
        await createArticle(fastify.prisma, request.agent.tenantId, request.agent.id, {
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
  // Fields: DocID, Ver, VerCreatTime, AI_Q, AI_A, Source/Soruce, Spec, IsAttached
  // Files:  Attached (可多檔)
  fastify.post(
    '/partner-ingest',
    { preHandler: [requireSupervisor()] },
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

      const docId = fields.DocID ?? '';
      if (!docId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'DocID is required' },
        });
      }

      // Tolerate Stanley's typo: accept both Source and Soruce
      const source = fields.Source ?? fields.Soruce ?? '';

      try {
        const result = await ingestPartnerDoc(
          fastify.prisma,
          request.agent.tenantId,
          request.agent.id,
          {
            docId,
            ver: Number(fields.Ver) || 0,
            verCreatTime: fields.VerCreatTime ?? '',
            aiQ: fields.AI_Q ?? '',
            aiA: fields.AI_A ?? '',
            source,
            spec: fields.Spec,
            isAttached: fields.IsAttached === 'true',
            attachments,
          },
        );
        return reply.send(success(result));
      } catch (err) {
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
  fastify.post('/bulk-embed', async (request, reply) => {
    const result = await bulkReembed(fastify.prisma, request.agent.tenantId);
    return reply.send(success(result));
  });

  // GET /api/v1/knowledge/embedding-status — 嵌入服務健康檢查
  fastify.get('/embedding-status', async (request, reply) => {
    const status = await checkOllamaHealth(fastify.prisma, request.agent.tenantId);
    return reply.send(success(status));
  });

  // ── Existing CRUD routes ──────────────────────────────────────────────────

  // POST /api/v1/knowledge — 新建文章
  fastify.post('/', async (request, reply) => {
    const data = createArticleSchema.parse(request.body);
    const article = await createArticle(
      fastify.prisma,
      request.agent.tenantId,
      request.agent.id,
      data,
    );
    return reply.status(201).send(success(article));
  });

  // GET /api/v1/knowledge/:id — 文章詳情
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const article = await getArticle(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(article));
  });

  // PATCH /api/v1/knowledge/:id — 更新文章
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const data = updateArticleSchema.parse(request.body);
    const article = await updateArticle(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
      data,
    );
    return reply.send(success(article));
  });

  // DELETE /api/v1/knowledge/:id — 刪除文章
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const result = await deleteArticle(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(result));
  });

  // POST /api/v1/knowledge/:id/publish — 發布文章
  fastify.post<{ Params: { id: string } }>('/:id/publish', async (request, reply) => {
    const article = await publishArticle(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(article));
  });

  // POST /api/v1/knowledge/:id/archive — 封存文章
  fastify.post<{ Params: { id: string } }>('/:id/archive', async (request, reply) => {
    const article = await archiveArticle(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );
    return reply.send(success(article));
  });

  // POST /api/v1/knowledge/:id/embed — 強制重新向量化單篇文章
  fastify.post<{ Params: { id: string } }>('/:id/embed', async (request, reply) => {
    await embedArticle(fastify.prisma, request.params.id);
    return reply.send(success({ embedded: true }));
  });
}
