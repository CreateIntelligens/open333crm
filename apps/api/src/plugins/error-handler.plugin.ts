import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../shared/utils/response.js';

async function errorHandlerPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler((error: FastifyError | Error, request, reply) => {
    request.log.error(error);

    // ZodError - validation errors
    if (error instanceof ZodError) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: {
            issues: error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        },
      });
    }

    // AppError - custom application errors
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }

    // Prisma known request errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case 'P2002': {
          const target = (error.meta?.target as string[]) ?? [];
          return reply.status(409).send({
            success: false,
            error: {
              code: 'CONFLICT',
              message: `A record with the same ${target.join(', ')} already exists`,
            },
          });
        }
        case 'P2025':
          return reply.status(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Record not found',
            },
          });
        default:
          return reply.status(400).send({
            success: false,
            error: {
              code: 'DATABASE_ERROR',
              message: error.message,
            },
          });
      }
    }

    // Prisma validation errors
    if (error instanceof Prisma.PrismaClientValidationError) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid data provided to the database',
        },
      });
    }

    // Fastify built-in errors (e.g., 404 from router)
    if ('statusCode' in error && typeof error.statusCode === 'number') {
      const statusCode = error.statusCode;
      return reply.status(statusCode).send({
        success: false,
        error: {
          code: statusCode === 404 ? 'NOT_FOUND' : 'REQUEST_ERROR',
          message: error.message,
        },
      });
    }

    // Unknown errors
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  });
}

export default fp(errorHandlerPlugin, {
  name: 'error-handler',
});
