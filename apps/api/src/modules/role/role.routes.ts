import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { success } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { actorOf } from '../../lib/request-actor.js';
import { getPermissionMatrix } from './role.service.js';
import {
  createRoleFlow,
  deleteRoleFlow,
  getRolePermissionsFlow,
  listRolesFlow,
  renameRoleFlow,
  setRolePermissionsFlow,
} from './role.flow.js';

const nameSchema = z.object({ name: z.string().min(1).max(20) });
const permsSchema = z.object({ permissions: z.array(z.string()) });

// 讀寫租戶資料的 route 都呼叫 role.flow（AGENTS.md 結構規則 2）
export default async function roleRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /roles — 角色列表（含權限/成員數）
  fastify.get('/', { preHandler: [requirePermission('role.view')] }, async (request, reply) => {
    const roles = await listRolesFlow(fastify, actorOf(request));
    return reply.send(success({ roles }));
  });

  // GET /roles/matrix — 權限矩陣（所有權限點，依 group；不讀租戶資料）
  fastify.get('/matrix', { preHandler: [requirePermission('role.view')] }, async (_request, reply) => {
    return reply.send(success(getPermissionMatrix()));
  });

  // GET /roles/:id/permissions
  fastify.get('/:id/permissions', { preHandler: [requirePermission('role.view')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const permissions = await getRolePermissionsFlow(fastify, actorOf(request), id);
    return reply.send(success({ roleId: id, permissions }));
  });

  // POST /roles — 建立自訂角色（空白）
  fastify.post('/', { preHandler: [requirePermission('role.manage')] }, async (request, reply) => {
    const { name } = nameSchema.parse(request.body);
    const role = await createRoleFlow(fastify, actorOf(request), name);
    return reply.status(201).send(success(role));
  });

  // PATCH /roles/:id — 改名
  fastify.patch('/:id', { preHandler: [requirePermission('role.manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name } = nameSchema.parse(request.body);
    const role = await renameRoleFlow(fastify, actorOf(request), id, name);
    return reply.send(success(role));
  });

  // DELETE /roles/:id — 刪除自訂角色（阻擋 system / 仍被指派）
  fastify.delete('/:id', { preHandler: [requirePermission('role.manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await deleteRoleFlow(fastify, actorOf(request), id);
    return reply.send(success(result));
  });

  // PUT /roles/:id/permissions — 設定角色權限（整批）
  fastify.put('/:id/permissions', { preHandler: [requirePermission('role.manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { permissions } = permsSchema.parse(request.body);
    const result = await setRolePermissionsFlow(fastify, actorOf(request), id, permissions);
    return reply.send(success(result));
  });
}
