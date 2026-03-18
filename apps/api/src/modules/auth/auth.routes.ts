import type { FastifyInstance } from 'fastify';
import { loginRequestSchema } from './auth.schema.js';
import { login, getAgentById } from './auth.service.js';
import { success } from '../../shared/utils/response.js';

export default async function authRoutes(fastify: FastifyInstance) {
  // POST /api/v1/auth/login
  fastify.post('/login', async (request, reply) => {
    const body = loginRequestSchema.parse(request.body);

    const agent = await login(fastify.prisma, body.email, body.password);

    const token = fastify.jwt.sign({
      agentId: agent.id,
      tenantId: agent.tenantId,
      role: agent.role,
    });

    return reply.send(
      success({
        token,
        agent: {
          id: agent.id,
          email: agent.email,
          name: agent.name,
          role: agent.role,
          avatarUrl: agent.avatarUrl,
          tenantId: agent.tenantId,
        },
      }),
    );
  });

  // POST /api/v1/auth/refresh
  fastify.post('/refresh', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id, tenantId, role } = request.agent;

    const token = fastify.jwt.sign({
      agentId: id,
      tenantId,
      role,
    });

    return reply.send(success({ token }));
  });

  // GET /api/v1/auth/me
  fastify.get('/me', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const agent = await getAgentById(
      fastify.prisma,
      request.agent.id,
      request.agent.tenantId,
    );

    return reply.send(success(agent));
  });
}
