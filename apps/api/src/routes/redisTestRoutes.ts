import { FastifyInstance } from 'fastify';
import { createRedisTestItemModel } from '../models/redisTestItemModel.js';

type ParamsWithId = { id: string };
type CreateBody = { title: string; value: string };
type UpdateBody = { title?: string; value?: string };

const itemResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    value: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const redisTestRoutes = async (fastify: FastifyInstance) => {
  const redisTestItemModel = createRedisTestItemModel(fastify.cache);

  fastify.get('/', {
    schema: {
      response: {
        200: {
          type: 'array',
          items: itemResponseSchema,
        },
      },
    },
  }, async () => redisTestItemModel.list());

  fastify.get('/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      response: {
        200: itemResponseSchema,
        404: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as ParamsWithId;
    const item = await redisTestItemModel.getById(id);
    if (!item) {
      return reply.code(404).send({ message: 'Redis test item not found' });
    }
    return item;
  });

  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['title', 'value'],
        properties: {
          title: { type: 'string', minLength: 1 },
          value: { type: 'string', minLength: 1 },
        },
      },
      response: {
        201: itemResponseSchema,
      },
    },
  }, async (request, reply) => {
    const body = request.body as CreateBody;
    const created = await redisTestItemModel.create(body);
    return reply.code(201).send(created);
  });

  fastify.patch('/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1 },
          value: { type: 'string', minLength: 1 },
        },
      },
      response: {
        200: itemResponseSchema,
        404: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as ParamsWithId;
    const body = request.body as UpdateBody;
    const updated = await redisTestItemModel.updateById(id, body);
    if (!updated) {
      return reply.code(404).send({ message: 'Redis test item not found' });
    }
    return updated;
  });

  fastify.delete('/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      response: {
        204: { type: 'null' },
        404: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as ParamsWithId;
    const deleted = await redisTestItemModel.deleteById(id);
    if (!deleted) {
      return reply.code(404).send({ message: 'Redis test item not found' });
    }
    return reply.code(204).send();
  });
};

export default redisTestRoutes;
