import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listMaterials,
  getMaterial,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  duplicateMaterial,
  previewMaterial,
  listMaterialCategories,
  validateLineFlexDraft,
  importLineFlexMaterial,
  listMaterialCategoryTree,
  createMaterialCategory,
  updateMaterialCategory,
  deleteMaterialCategory,
  listMaterialTags,
  listMaterialVersions,
  restoreMaterialVersion,
  getMaterialStats,
  type MaterialSort,
} from './material.service.js';
import { success } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';

// ─── ContentType / ChannelType enums ───────────────────────────────────

const CONTENT_TYPE_VALUES = [
  // LINE 6 種
  'line_text',
  'line_image',
  'line_video',
  'line_carousel',
  'line_imagemap',
  'line_flex_showcase',
  'line_flex_template',
  // FB 9 種
  'fb_text',
  'fb_image',
  'fb_video',
  'fb_generic',
  'fb_button',
  'fb_media',
  'fb_coupon',
  'fb_receipt',
  'fb_feedback',
] as const;

const CHANNEL_TYPE_VALUES = ['line', 'fb'] as const;

// ─── Action 物件驗證（postback / uri / message / datetimepicker / clipboard）───

const URI_SCHEME_RE = /^(https?|line|tel):/i;

const postbackActionSchema = z.object({
  type: z.literal('postback'),
  label: z.string().min(1).max(40).optional(),
  data: z.string().max(300, 'postback.data ≤ 300'),
  displayText: z.string().max(300).optional(),
  inputOption: z.enum(['closeRichMenu', 'openRichMenu', 'openKeyboard', 'openVoice']).optional(),
  fillInText: z.string().max(300).optional(),
});

const uriActionSchema = z.object({
  type: z.literal('uri'),
  label: z.string().min(1).max(40).optional(),
  uri: z
    .string()
    .max(1000)
    .refine((s) => URI_SCHEME_RE.test(s), {
      message: 'uri scheme must be one of http, https, line, tel',
    }),
  altUri: z.object({ desktop: z.string().max(1000) }).optional(),
});

const messageActionSchema = z.object({
  type: z.literal('message'),
  label: z.string().min(1).max(40).optional(),
  text: z.string().min(1).max(300),
});

const datetimeActionSchema = z.object({
  type: z.literal('datetimepicker'),
  label: z.string().min(1).max(40).optional(),
  data: z.string().max(300),
  mode: z.enum(['date', 'time', 'datetime']),
  initial: z.string().optional(),
  max: z.string().optional(),
  min: z.string().optional(),
});

const clipboardActionSchema = z.object({
  type: z.literal('clipboard'),
  label: z.string().min(1).max(40).optional(),
  clipboardText: z.string().min(1).max(1000),
});

// 集合 schema（不直接驗證 body 內全部 action — body 太自由；只用在 future linting hook）
export const actionSchema = z.discriminatedUnion('type', [
  postbackActionSchema,
  uriActionSchema,
  messageActionSchema,
  datetimeActionSchema,
  clipboardActionSchema,
]);

// ─── Material schema ──────────────────────────────────────────────────

const variableSchema = z.object({
  key: z.string().min(1),
  label: z.string().optional(),
  defaultValue: z.string().optional(),
  required: z.boolean().optional(),
});

const MATERIAL_STATUS_VALUES = ['draft', 'approved'] as const;
const tagsSchema = z.array(z.string().min(1).max(40)).max(20);

const createMaterialSchema = z.object({
  templateId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  category: z.string().max(100).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  tags: tagsSchema.optional(),
  status: z.enum(MATERIAL_STATUS_VALUES).optional(),
  channelType: z.enum(CHANNEL_TYPE_VALUES).optional(),
  contentType: z.enum(CONTENT_TYPE_VALUES).optional(),
  body: z.record(z.unknown()).optional(),
  variables: z.array(variableSchema).optional(),
  targetChannels: z.array(z.string()).optional(),
  previewImageUrl: z.string().url().optional(),
});

const updateMaterialSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  category: z.string().max(100).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  tags: tagsSchema.optional(),
  status: z.enum(MATERIAL_STATUS_VALUES).optional(),
  body: z.record(z.unknown()).optional(),
  variables: z.array(variableSchema).optional(),
  targetChannels: z.array(z.string()).optional(),
  previewImageUrl: z.string().url().optional(),
  isActive: z.boolean().optional(),
});

const SORT_VALUES = ['recent_used', 'most_used', 'updated', 'name'] as const;

const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const previewMaterialSchema = z.object({
  contactId: z.string().uuid().optional(),
  variables: z.record(z.string()).optional(),
});

const lineFlexValidateSchema = z.object({
  payload: z.unknown(),
  altText: z.string().max(400).optional(),
});

const lineFlexImportSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  category: z.string().max(100).optional(),
  payload: z.unknown(),
  altText: z.string().max(400).optional(),
  previewImageUrl: z.string().url().optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────

export default async function materialRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePermission('marketing.view'));

  // GET /materials/categories — legacy 字串分類（過渡保留）
  fastify.get('/materials/categories', async (request, reply) => {
    const categories = await listMaterialCategories(request.tenantPrisma, request.agent.tenantId);
    return reply.send(success(categories));
  });

  // GET /materials/category-tree — 巢狀分類樹（含素材數）
  fastify.get('/materials/category-tree', async (request, reply) => {
    const tree = await listMaterialCategoryTree(request.tenantPrisma, request.agent.tenantId);
    return reply.send(success(tree));
  });

  // POST /materials/categories — 建立分類
  fastify.post('/materials/categories', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const data = createCategorySchema.parse(request.body);
    const cat = await createMaterialCategory(request.tenantPrisma, request.agent.tenantId, data);
    return reply.code(201).send(success(cat));
  });

  // PATCH /materials/categories/:id — 改名 / 搬移（擋循環）
  fastify.patch('/materials/categories/:id', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = updateCategorySchema.parse(request.body);
    const cat = await updateMaterialCategory(request.tenantPrisma, id, request.agent.tenantId, data);
    return reply.send(success(cat));
  });

  // DELETE /materials/categories/:id — 刪分類（其下素材 categoryId 設 null，不刪素材）
  fastify.delete('/materials/categories/:id', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await deleteMaterialCategory(request.tenantPrisma, id, request.agent.tenantId);
    return reply.send(success(result));
  });

  // GET /materials/tags — 聚合租戶標籤
  fastify.get('/materials/tags', async (request, reply) => {
    const tags = await listMaterialTags(request.tenantPrisma, request.agent.tenantId);
    return reply.send(success(tags));
  });

  // GET /materials
  fastify.get('/materials', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const sort = SORT_VALUES.includes(q.sort as MaterialSort) ? (q.sort as MaterialSort) : undefined;
    // tags 支援逗號分隔多值
    const tags = q.tags ? q.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    const result = await listMaterials(request.tenantPrisma, request.agent.tenantId, {
      channelType: q.channelType,
      category: q.category,
      categoryId: q.categoryId,
      tags,
      status: q.status,
      sort,
      q: q.q,
      isActive: q.isActive === undefined ? true : q.isActive === 'true',
      page: q.page ? Number(q.page) : 1,
      limit: q.limit ? Number(q.limit) : 50,
    });
    // 用量長條正規化基準（跨頁一致）併入 meta，前端計算長條寬度用。
    const base = success(result.items, {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: Math.ceil(result.total / result.limit),
    });
    return reply.send({ ...base, meta: { ...base.meta!, maxUsageCount: result.maxUsageCount } });
  });

  // POST /materials
  fastify.post('/materials', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const data = createMaterialSchema.parse(request.body);
    const material = await createMaterial(request.tenantPrisma, request.agent.tenantId, {
      ...data,
      createdById: request.agent.id,
    });
    return reply.code(201).send(success(material));
  });

  // POST /materials/line-flex/validate
  fastify.post('/materials/line-flex/validate', async (request, reply) => {
    const data = lineFlexValidateSchema.parse(request.body);
    const result = await validateLineFlexDraft(request.tenantPrisma, request.agent.tenantId, data.payload, {
      altText: data.altText,
    });
    return reply.send(success(result));
  });

  // POST /materials/line-flex/import
  fastify.post('/materials/line-flex/import', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const data = lineFlexImportSchema.parse(request.body);
    const material = await importLineFlexMaterial(request.tenantPrisma, request.agent.tenantId, {
      name: data.name,
      description: data.description,
      category: data.category,
      payload: data.payload,
      altText: data.altText,
      previewImageUrl: data.previewImageUrl,
      createdById: request.agent.id,
    });
    return reply.code(201).send(success(material));
  });

  // GET /materials/:id
  fastify.get('/materials/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const material = await getMaterial(request.tenantPrisma, id, request.agent.tenantId);
    return reply.send(success(material));
  });

  // PATCH /materials/:id
  fastify.patch('/materials/:id', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = updateMaterialSchema.parse(request.body);
    const material = await updateMaterial(request.tenantPrisma, id, request.agent.tenantId, {
      ...data,
      editedById: request.agent.id,
    });
    return reply.send(success(material));
  });

  // DELETE /materials/:id (soft delete)
  fastify.delete('/materials/:id', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await deleteMaterial(request.tenantPrisma, id, request.agent.tenantId);
    return reply.send(success(result));
  });

  // POST /materials/:id/duplicate
  fastify.post('/materials/:id/duplicate', { preHandler: requirePermission('marketing.manage') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const copy = await duplicateMaterial(request.tenantPrisma, id, request.agent.tenantId);
    return reply.code(201).send(success(copy));
  });

  // POST /materials/:id/preview
  fastify.post('/materials/:id/preview', async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = previewMaterialSchema.parse(request.body ?? {});
    const result = await previewMaterial(request.tenantPrisma, id, request.agent.tenantId, data);
    return reply.send(success(result));
  });

  // GET /materials/:id/versions — 版本歷史（新到舊）
  fastify.get('/materials/:id/versions', async (request, reply) => {
    const { id } = request.params as { id: string };
    const versions = await listMaterialVersions(request.tenantPrisma, id, request.agent.tenantId);
    return reply.send(success(versions));
  });

  // POST /materials/:id/versions/:versionNo/restore — 還原指定版（產生新版）
  fastify.post(
    '/materials/:id/versions/:versionNo/restore',
    { preHandler: requirePermission('marketing.manage') },
    async (request, reply) => {
      const { id, versionNo } = request.params as { id: string; versionNo: string };
      const n = Number(versionNo);
      if (!Number.isInteger(n) || n < 1) {
        return reply.code(400).send({ error: { code: 'INVALID_VERSION', message: 'versionNo 必須為正整數' } });
      }
      const material = await restoreMaterialVersion(
        request.tenantPrisma, id, n, request.agent.tenantId, request.agent.id,
      );
      return reply.send(success(material));
    },
  );

  // GET /materials/:id/stats — 素材級成效
  fastify.get('/materials/:id/stats', async (request, reply) => {
    const { id } = request.params as { id: string };
    const stats = await getMaterialStats(request.tenantPrisma, id, request.agent.tenantId);
    return reply.send(success(stats));
  });
}
