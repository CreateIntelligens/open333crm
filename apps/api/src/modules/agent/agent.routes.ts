import type { FastifyInstance } from 'fastify';
import { success } from '../../shared/utils/response.js';

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
}
