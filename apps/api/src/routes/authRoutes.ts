import { FastifyInstance } from 'fastify';

const authRoutes = async (fastify: FastifyInstance) => {

  fastify.get('/login', {
    schema: {
      querystring: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            some: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { username } = request.query as { username: string };

    return { message: username };
  });

};

export default authRoutes;