import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import {
  listRoles,
  getRolePermissions,
  createRole,
  renameRole,
  deleteRole,
  setRolePermissions,
  getPermissionMatrix,
} from './role.service.js';
import { writeTenantAudit } from '../tenant-audit/tenant-audit.service.js';

const nameSchema = z.object({ name: z.string().min(1).max(20) });
const permsSchema = z.object({ permissions: z.array(z.string()) });

export default async function roleRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /roles — 角色列表（含權限/成員數）
  fastify.get('/', { preHandler: [requirePermission('role.view')] }, async (request, reply) => {
    const roles = await listRoles(request.tenantPrisma, request.agent.tenantId);
    return reply.send(success({ roles }));
  });

  // GET /roles/matrix — 權限矩陣（所有權限點，依 group）
  fastify.get('/matrix', { preHandler: [requirePermission('role.view')] }, async (_request, reply) => {
    return reply.send(success(getPermissionMatrix()));
  });

  // GET /roles/:id/permissions
  fastify.get('/:id/permissions', { preHandler: [requirePermission('role.view')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const permissions = await getRolePermissions(request.tenantPrisma, id, request.agent.tenantId);
    return reply.send(success({ roleId: id, permissions }));
  });

  // POST /roles — 建立自訂角色（空白）
  fastify.post('/', { preHandler: [requirePermission('role.manage')] }, async (request, reply) => {
    const { name } = nameSchema.parse(request.body);
    const role = await createRole(request.tenantPrisma, request.agent.tenantId, name);
    return reply.status(201).send(success(role));
  });

  // PATCH /roles/:id — 改名
  fastify.patch('/:id', { preHandler: [requirePermission('role.manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name } = nameSchema.parse(request.body);
    const role = await renameRole(request.tenantPrisma, id, request.agent.tenantId, name);
    return reply.send(success(role));
  });

  // DELETE /roles/:id — 刪除自訂角色（阻擋 system / 仍被指派）
  fastify.delete('/:id', { preHandler: [requirePermission('role.manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await deleteRole(request.tenantPrisma, id, request.agent.tenantId);
    return reply.send(success(result));
  });

  // PUT /roles/:id/permissions — 設定角色權限（整批）
  fastify.put('/:id/permissions', { preHandler: [requirePermission('role.manage')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { permissions } = permsSchema.parse(request.body);
    // TODO(rls): 交易 service，待改造為 withTenant
    const result = await setRolePermissions(
      fastify.prisma,
      id,
      request.agent.tenantId,
      permissions,
      request.agent.roleId,
    );
    // 稽核：更新角色權限（payload 記角色與最終權限碼清單，權限碼非 PII）
    await writeTenantAudit(request.tenantPrisma, {
      tenantId: request.agent.tenantId,
      actorId: request.agent.id,
      action: 'role.permission.update',
      targetType: 'role',
      targetId: id,
      payload: { permissions: result.permissions },
      ip: request.ip,
    });
    return reply.send(success(result));
  });
}
