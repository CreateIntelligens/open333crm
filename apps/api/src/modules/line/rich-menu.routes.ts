/**
 * Rich Menu CRUD routes
 *
 * 路由前綴：/api/v1/line/rich-menus
 * 權限：richmenu.manage（整模組 requirePermission preHandler）
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listRichMenus,
  getRichMenu,
  createRichMenu,
  updateRichMenu,
  deleteRichMenu,
  duplicateRichMenu,
  publishRichMenu,
  unpublishRichMenu,
} from './rich-menu.service.js';
import { success } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';

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
  uri: z.string().optional(),
  altUri: z.object({ desktop: z.string().optional() }).optional(),
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
  chatBarText: z.string().min(1).max(14),
  size: sizeSchema,
  selected: z.boolean().optional(),
  areas: z.array(areaSchema).min(1).max(20),
  imageUrl: z.string().url(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  chatBarText: z.string().min(1).max(14).optional(),
  size: sizeSchema.optional(),
  selected: z.boolean().optional(),
  areas: z.array(areaSchema).min(1).max(20).optional(),
  imageUrl: z.string().url().optional(),
});

const listQuerySchema = z.object({
  channelId: z.string().uuid(),
});

// ─── Routes ────────────────────────────────────────────────────────────

export default async function richMenuRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePermission('richmenu.manage'));

  // GET /api/v1/line/rich-menus?channelId=<uuid>
  fastify.get('/', async (request, reply) => {
    const { channelId } = listQuerySchema.parse(request.query);
    const list = await listRichMenus(fastify.prisma, request.agent.tenantId, channelId);
    return reply.send(success(list));
  });

  // GET /api/v1/line/rich-menus/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const menu = await getRichMenu(fastify.prisma, request.params.id, request.agent.tenantId);
    return reply.send(success(menu));
  });

  // POST /api/v1/line/rich-menus
  fastify.post('/', async (request, reply) => {
    const data = createSchema.parse(request.body);
    const menu = await createRichMenu(fastify.prisma, request.agent.tenantId, data);
    return reply.code(201).send(success(menu));
  });

  // PATCH /api/v1/line/rich-menus/:id
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const data = updateSchema.parse(request.body);
    const menu = await updateRichMenu(fastify.prisma, request.params.id, request.agent.tenantId, data);
    return reply.send(success(menu));
  });

  // DELETE /api/v1/line/rich-menus/:id
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const result = await deleteRichMenu(fastify.prisma, request.params.id, request.agent.tenantId);
    return reply.send(success(result));
  });

  // POST /api/v1/line/rich-menus/:id/duplicate
  fastify.post<{ Params: { id: string } }>('/:id/duplicate', async (request, reply) => {
    const menu = await duplicateRichMenu(fastify.prisma, request.params.id, request.agent.tenantId);
    return reply.code(201).send(success(menu));
  });

  // POST /api/v1/line/rich-menus/:id/publish
  fastify.post<{ Params: { id: string } }>('/:id/publish', async (request, reply) => {
    const menu = await publishRichMenu(fastify.prisma, request.params.id, request.agent.tenantId);
    return reply.send(success(menu));
  });

  // POST /api/v1/line/rich-menus/:id/unpublish
  fastify.post<{ Params: { id: string } }>('/:id/unpublish', async (request, reply) => {
    const menu = await unpublishRichMenu(fastify.prisma, request.params.id, request.agent.tenantId);
    return reply.send(success(menu));
  });
}
