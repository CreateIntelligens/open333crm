import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getConfig } from '../config/env.js';

export interface AgentPayload {
  id: string;
  tenantId: string;
  role: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    agent: AgentPayload;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      agentId: string;
      tenantId: string;
      role: string;
    };
    user: {
      agentId: string;
      tenantId: string;
      role: string;
    };
  }
}

async function authPlugin(fastify: FastifyInstance) {
  const config = getConfig();

  await fastify.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: {
      expiresIn: config.ACCESS_TOKEN_EXPIRES_IN,
    },
  });

  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const payload = request.user;
      request.agent = {
        id: payload.agentId,
        tenantId: payload.tenantId,
        role: payload.role,
      };
    } catch (err) {
      reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired token',
        },
      });
    }
  });
}

export default fp(authPlugin, {
  name: 'auth',
});
