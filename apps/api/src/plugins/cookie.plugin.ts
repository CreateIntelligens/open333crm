import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';

async function cookiePlugin(fastify: FastifyInstance) {
  await fastify.register(cookie);
}

export default fp(cookiePlugin, {
  name: 'cookie',
});
