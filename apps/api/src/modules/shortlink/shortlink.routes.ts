/**
 * ShortLink Admin API routes — CRUD + stats.
 * Prefix: /api/v1/shortlinks
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listShortLinks,
  getShortLink,
  createShortLink,
  updateShortLink,
  deleteShortLink,
  getClickStats,
  getClickLogs,
} from './shortlink.service.js';
import { generateQrCode } from './qrcode.service.js';

// 轉址頁會把 targetUrl 丟進 window.location.replace() 與 <noscript><a href>，
// 兩者都是執行 sink：不限制 scheme 等於留下儲存型 XSS（javascript:、data:）。
// 與 material.routes.ts 的 URI_SCHEME_RE same-family，但短連結只該是 http(s)。
const TARGET_URL_SCHEME_RE = /^https?:\/\//i;

// 自動產生的 slug 是 base64url（generateSlug），自訂 slug 比照同一字元集：
// 放行斜線會讓 /s/:slug 永遠配不到，等於建出死連結。
const SLUG_RE = /^[A-Za-z0-9_-]+$/;

const createShortlinkSchema = z.object({
  targetUrl: z
    .string()
    .trim()
    .min(1, '目標網址為必填')
    .max(2048, '目標網址不可超過 2048 字')
    .url('目標網址格式不正確')
    .refine((v) => TARGET_URL_SCHEME_RE.test(v), {
      message: '目標網址只允許 http 或 https',
    }),
  title: z.string().trim().max(200).optional(),
  slug: z
    .string()
    .trim()
    .min(3, '自訂代碼至少 3 個字')
    .max(64, '自訂代碼不可超過 64 字')
    .regex(SLUG_RE, '自訂代碼只能使用英數字、底線與連字號')
    .optional(),
  ogTitle: z.string().trim().max(200).optional(),
  ogDescription: z.string().trim().max(500).optional(),
  ogImage: z
    .string()
    .trim()
    .url()
    .refine((v) => TARGET_URL_SCHEME_RE.test(v), { message: 'OG 圖片只允許 http 或 https' })
    .optional(),
  lineChannelId: z.string().uuid('渠道 ID 格式不正確').nullable().optional(),
  utmSource: z.string().trim().max(100).optional(),
  utmMedium: z.string().trim().max(100).optional(),
  utmCampaign: z.string().trim().max(100).optional(),
  utmContent: z.string().trim().max(100).optional(),
  utmTerm: z.string().trim().max(100).optional(),
  tagOnClick: z.string().trim().max(100).optional(),
  materialId: z.string().uuid('素材 ID 格式不正確').optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

// 更新沿用同組規則，但全欄位可選（targetUrl 也可不帶）。
const updateShortlinkSchema = createShortlinkSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// page/limit 未夾制會讓 skip 算出負數，Prisma 直接拋錯 → 500。
// 與 contact.routes.ts / conversation.routes.ts 既有正確實作對齊。
const listQuerySchema = z.object({
  isActive: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export default async function shortlinkRoutes(app: FastifyInstance) {
  // All routes require agent JWT
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (request) => {
    const { isActive, q, page, limit } = listQuerySchema.parse(request.query);
    const result = await listShortLinks(request.tenantPrisma, request.agent.tenantId, {
      isActive,
      q,
      page,
      limit,
    });
    return { success: true, data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } };
  });

  app.post('/', async (request, reply) => {
    const body = createShortlinkSchema.parse(request.body);
    try {
      const link = await createShortLink(request.tenantPrisma, request.agent.tenantId, request.agent.id, body as Parameters<typeof createShortLink>[3]);
      return { success: true, data: link };
    } catch (err: unknown) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    }
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const link = await getShortLink(request.tenantPrisma, id, request.agent.tenantId);
    if (!link) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此短連結，可能已被刪除' } });
    return { success: true, data: link };
  });

  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateShortlinkSchema.parse(request.body);
    const link = await updateShortLink(request.tenantPrisma, id, request.agent.tenantId, body as Parameters<typeof updateShortLink>[3]);
    if (!link) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此短連結，可能已被刪除' } });
    return { success: true, data: link };
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await deleteShortLink(request.tenantPrisma, id, request.agent.tenantId);
    if (!result) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此短連結，可能已被刪除' } });
    return { success: true };
  });

  app.get('/:id/stats', async (request, reply) => {
    const { id } = request.params as { id: string };
    const stats = await getClickStats(request.tenantPrisma, id, request.agent.tenantId);
    if (!stats) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此短連結，可能已被刪除' } });
    return { success: true, data: stats };
  });

  app.get('/:id/clicks', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { page, limit } = request.query as Record<string, string>;
    // getClickLogs 的 skip 同樣是 (page-1)*limit，未夾制會負 skip → 500
    const { page: safePage, limit: safeLimit } = listQuerySchema
      .pick({ page: true, limit: true })
      .parse({ page: page ?? undefined, limit: limit ?? undefined });
    const result = await getClickLogs(request.tenantPrisma, id, request.agent.tenantId, safePage, safeLimit);
    // 先前漏了 reply.status，NOT_FOUND 實際以 HTTP 200 送出，前端判斷不到失敗
    if (!result) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此短連結，可能已被刪除' } });
    return { success: true, data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } };
  });

  app.get('/:id/qrcode', async (request, reply) => {
    const { id } = request.params as { id: string };
    const link = await getShortLink(request.tenantPrisma, id, request.agent.tenantId);
    if (!link) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '找不到此短連結，可能已被刪除' } });

    const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.API_PORT || 3001}`;
    const shortUrl = `${baseUrl}/s/${link.slug}`;
    const qrDataUri = await generateQrCode(shortUrl);
    return { success: true, data: { url: shortUrl, qrcode: qrDataUri } };
  });
}
