import { FastifyInstance } from 'fastify';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { migrationExampleUserModel } from '../models/migrationExampleUserModel.js';

type ParamsWithId = { id: string };
type CreateBody = { email: string; name?: string };
type UpdateBody = { email?: string; name?: string | null };

const userResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    name: { type: ['string', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const migrationExampleUserRoutes = async (fastify: FastifyInstance) => {
  fastify.get('/', {
    schema: {
      response: {
        200: {
          type: 'array',
          items: userResponseSchema,
        },
      },
    },
  }, async () => {
    return migrationExampleUserModel.list();
  });

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
        200: userResponseSchema,
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
    const user = await migrationExampleUserModel.getById(id);

    if (!user) {
      return reply.code(404).send({ message: 'MigrationExampleUser not found' });
    }

    return user;
  });

  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
        },
      },
      response: {
        201: userResponseSchema,
      },
    },
  }, async (request, reply) => {
    const body = request.body as CreateBody;
    const created = await migrationExampleUserModel.create(body);
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
          email: { type: 'string', format: 'email' },
          name: { type: ['string', 'null'] },
        },
      },
      response: {
        200: userResponseSchema,
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

    try {
      return await migrationExampleUserModel.updateById(id, body);
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.code(404).send({ message: 'MigrationExampleUser not found' });
      }
      throw error;
    }
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

    try {
      await migrationExampleUserModel.deleteById(id);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.code(404).send({ message: 'MigrationExampleUser not found' });
      }
      throw error;
    }
  });
};

export default migrationExampleUserRoutes;
