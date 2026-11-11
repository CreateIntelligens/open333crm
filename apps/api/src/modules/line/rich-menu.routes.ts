/**
 * Rich Menu CRUD routes
 *
 * 路由前綴：/api/v1/line/rich-menus
 * 權限：richmenu.manage（整模組 requirePermission preHandler）
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import {
  bindRichMenuAudienceFlow,
  unbindRichMenuAudienceFlow,
  publishRichMenuFlow,
  unpublishRichMenuFlow,
  createRichMenuFlow,
  deleteRichMenuFlow,
  duplicateRichMenuFlow,
  getRichMenuFlow,
  listRichMenusFlow,
  updateRichMenuFlow,
} from './rich-menu.flow.js';
import { success } from '../../shared/utils/response.js';
import { actorOf } from '../../lib/request-actor.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { lineUriSchema } from '../../shared/utils/url-schemes.js';

// ─── Schemas ───────────────────────────────────────────────────────────

const sizeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const boundsSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

// Action 結構（與 LINE 官方 API 對齊）— service 層會做更嚴格的條件驗證
const actionSchema = z.object({
  type: z.enum(['postback', 'message', 'uri', 'datetimepicker', 'richmenuswitch']),
  label: z.string().max(20).optional(),
  data: z.string().max(300).optional(),
  displayText: z.string().max(300).optional(),
  text: z.string().max(300).optional(),
  // publishRichMenu 會把 areas 原樣轉送給 LINE，LINE 只收 http/https/line/tel，
  // 其他 scheme 會被退 400——在存草稿時就擋下，而不是拖到「按發布」才報錯。
  uri: lineUriSchema.optional(),
  altUri: z.object({ desktop: lineUriSchema.optional() }).optional(),
  mode: z.enum(['date', 'time', 'datetime']).optional(),
  initial: z.string().optional(),
  min: z.string().optional(),
  max: z.string().optional(),
  richMenuAliasId: z.string().optional(),
});

const areaSchema = z.object({
  bounds: boundsSchema,
  action: actionSchema,
});

const createSchema = z.object({
  channelId: z.string().uuid(),
  name: z.string().min(1).max(200),
  chatBarText: z.string().trim().min(1, '選單列文字不可為空白').max(14),
  size: sizeSchema,
  selected: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  areas: z.array(areaSchema).min(1).max(20),
  imageUrl: z.string().url(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  chatBarText: z.string().trim().min(1, '選單列文字不可為空白').max(14).optional(),
  size: sizeSchema.optional(),
  selected: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  areas: z.array(areaSchema).min(1).max(20).optional(),
  imageUrl: z.string().url().optional(),
});

const listQuerySchema = z.object({
  channelId: z.string().uuid(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

// 綁定受眾：segment 或 tag 擇一（皆選填，service 內判斷至少一個）
const audienceBindSchema = z.object({
  segmentId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
});

// ─── Routes ────────────────────────────────────────────────────────────

export default async function richMenuRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePermission('richmenu.manage'));

  // GET /api/v1/line/rich-menus?channelId=<uuid>
  fastify.get('/', async (request, reply) => {
    const { channelId } = listQuerySchema.parse(request.query);
    const list = await listRichMenusFlow(fastify, actorOf(request).tenantId, channelId);
    return reply.send(success(list));
  });

  // GET /api/v1/line/rich-menus/:id
  fastify.get('/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const menu = await getRichMenuFlow(fastify, actorOf(request).tenantId, id);
    return reply.send(success(menu));
  });

  // POST /api/v1/line/rich-menus
  fastify.post('/', async (request, reply) => {
    const data = createSchema.parse(request.body);
    const menu = await createRichMenuFlow(fastify, actorOf(request).tenantId, data);
    return reply.code(201).send(success(menu));
  });

  // PATCH /api/v1/line/rich-menus/:id
  fastify.patch('/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const data = updateSchema.parse(request.body);
    const menu = await updateRichMenuFlow(fastify, actorOf(request).tenantId, id, data);
    return reply.send(success(menu));
  });

  // DELETE /api/v1/line/rich-menus/:id
  fastify.delete('/:id', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const result = await deleteRichMenuFlow(fastify, actorOf(request).tenantId, id);
    return reply.send(success(result));
  });

  // POST /api/v1/line/rich-menus/:id/duplicate
  fastify.post('/:id/duplicate', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const menu = await duplicateRichMenuFlow(fastify, actorOf(request).tenantId, id);
    return reply.code(201).send(success(menu));
  });

  // POST /api/v1/line/rich-menus/:id/publish
  fastify.post('/:id/publish', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const menu = await publishRichMenuFlow(fastify, actorOf(request).tenantId, id);
    return reply.send(success(menu));
  });

  // POST /api/v1/line/rich-menus/:id/unpublish
  fastify.post('/:id/unpublish', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const menu = await unpublishRichMenuFlow(fastify, actorOf(request).tenantId, id);
    return reply.send(success(menu));
  });

  // POST /api/v1/line/rich-menus/:id/bind-audience — 綁定受眾（segment 或 tag）
  // RBAC 由模組級 addHook requirePermission('richmenu.manage') 保護（見檔頭）。
  fastify.post(
    '/:id/bind-audience',
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const { segmentId, tagId } = audienceBindSchema.parse(request.body ?? {});
      const result = await bindRichMenuAudienceFlow(fastify, actorOf(request).tenantId, id, { segmentId, tagId });
      return reply.send(success(result));
    },
  );

  // POST /api/v1/line/rich-menus/:id/unbind-audience
  fastify.post(
    '/:id/unbind-audience',
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const { segmentId, tagId } = audienceBindSchema.parse(request.body ?? {});
      const result = await unbindRichMenuAudienceFlow(fastify, actorOf(request).tenantId, id, { segmentId, tagId });
      return reply.send(success(result));
    },
  );
}
