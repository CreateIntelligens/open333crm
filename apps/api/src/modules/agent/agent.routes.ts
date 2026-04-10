import type { FastifyInstance } from 'fastify';
import { success, AppError } from '../../shared/utils/response.js';
import { requireSupervisor, requireAdmin } from '../../guards/rbac.guard.js';
import {
  createAgentSchema,
  updateAgentRoleSchema,
  changePasswordSchema,
  resetPasswordSchema,
} from './agent.schema.js';
import {
  createAgent,
  updateAgentRole,
  changeOwnPassword,
  resetAgentPassword,
  deactivateAgent,
} from './agent.service.js';

export default async function agentRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/agents
  fastify.get('/', async (request, reply) => {
    const agents = await fastify.prisma.agent.findMany({
      where: {
        tenantId: request.agent.tenantId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
        isActive: true,
        teams: {
          include: {
            team: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        _count: {
          select: {
            assignedCases: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return reply.send(success(agents));
  });

  // POST /api/v1/agents — Admin or Supervisor only
  fastify.post('/', {
    preHandler: [requireSupervisor()],
  }, async (request, reply) => {
    const body = createAgentSchema.parse(request.body);

    if (request.agent.role === 'SUPERVISOR' && body.role === 'ADMIN') {
      throw new AppError('Supervisors cannot create ADMIN agents', 'FORBIDDEN', 403);
    }

    const agent = await createAgent(fastify.prisma, request.agent.tenantId, body);
    return reply.status(201).send(success(agent));
  });

  // PATCH /api/v1/agents/me/password — any authenticated agent
  // Must be defined before /:id routes to avoid route conflict
  fastify.patch('/me/password', async (request, reply) => {
    const body = changePasswordSchema.parse(request.body);
    await changeOwnPassword(fastify.prisma, request.agent.id, body.currentPassword, body.newPassword);
    return reply.send(success({ message: 'Password updated' }));
  });

  // PATCH /api/v1/agents/:id/role — Admin or Supervisor only
  fastify.patch('/:id/role', {
    preHandler: [requireSupervisor()],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateAgentRoleSchema.parse(request.body);

    if (request.agent.role === 'SUPERVISOR' && body.role === 'ADMIN') {
      throw new AppError('Supervisors cannot assign ADMIN role', 'FORBIDDEN', 403);
    }

    const agent = await updateAgentRole(fastify.prisma, request.agent.tenantId, id, body.role);
    return reply.send(success(agent));
  });

  // PATCH /api/v1/agents/:id/password — Admin only (reset another agent's password)
  fastify.patch('/:id/password', {
    preHandler: [requireAdmin()],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = resetPasswordSchema.parse(request.body);
    await resetAgentPassword(fastify.prisma, request.agent.tenantId, id, body.newPassword);
    return reply.send(success({ message: 'Password reset' }));
  });

  // DELETE /api/v1/agents/:id — Admin only (deactivate agent)
  fastify.delete('/:id', {
    preHandler: [requireAdmin()],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await deactivateAgent(fastify.prisma, request.agent.tenantId, id);
    return reply.status(204).send();
  });
}
