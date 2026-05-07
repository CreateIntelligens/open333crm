import type { FastifyInstance } from 'fastify';
import { success } from '../../shared/utils/response.js';

export default async function teamRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/teams — list teams for the tenant + member counts
  fastify.get('/', async (request, reply) => {
    const teams = await fastify.prisma.team.findMany({
      where: { tenantId: request.agent.tenantId },
      select: {
        id: true,
        name: true,
        _count: { select: { members: true } },
      },
      orderBy: { name: 'asc' },
    });
    return reply.send(success(teams));
  });
}
