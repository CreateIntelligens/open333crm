import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { prisma, AgentRole } from '../lib/prisma.js';

const AGENT_SELECT = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const agentRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/', {
    schema: {
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string' },
              name: { type: 'string' },
              avatarUrl: { type: 'string', nullable: true },
              role: { type: 'string' },
              isActive: { type: 'boolean' },
              createdAt: { type: 'string' },
              updatedAt: { type: 'string' },
            },
          },
        },
      },
    },
  }, async () => {
    return prisma.agent.findMany({ select: AGENT_SELECT });
  });

  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'name', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          password: { type: 'string', minLength: 8 },
          role: { type: 'string', enum: Object.values(AgentRole) },
        },
      }
    },
  }, async (request, reply) => {
    const { email, name, password, role } = request.body as {
      email: string;
      name: string;
      password: string;
      role?: AgentRole;
    };

    const passwordHash = await bcrypt.hash(password, 10);
    const agent = await prisma.agent.create({
      data: { email, name, passwordHash, role: role ?? AgentRole.AGENT },
      select: AGENT_SELECT,
    });

    return reply.status(201).send('ok');
  });
};

export default agentRoutes;
