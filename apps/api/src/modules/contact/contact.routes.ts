import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listContacts,
  getContact,
  updateContact,
  getContactConversations,
  getContactCases,
  addContactTag,
  removeContactTag,
  getContactTimeline,
  getMergePreview,
  mergeContacts,
} from './contact.service.js';
import { success, paginated } from '../../shared/utils/response.js';

const listQuerySchema = z.object({
  q: z.string().optional(),
  tagId: z.string().uuid().optional(),
  channelType: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const updateContactSchema = z.object({
  displayName: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  language: z.string().optional(),
  isBlocked: z.boolean().optional(),
});

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const addTagSchema = z.object({
  tagId: z.string().uuid(),
});

const mergePreviewQuerySchema = z.object({
  primaryId: z.string().uuid(),
  secondaryId: z.string().uuid(),
});

const mergeBodySchema = z.object({
  primaryContactId: z.string().uuid(),
  secondaryContactId: z.string().uuid(),
});

export default async function contactRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/contacts
  fastify.get('/', async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, ...filters } = query;

    const { contacts, total } = await listContacts(
      fastify.prisma,
      request.agent.tenantId,
      filters,
      { page, limit },
    );

    return reply.send(paginated(contacts, total, page, limit));
  });

  // GET /api/v1/contacts/merge-preview?primaryId=X&secondaryId=Y
  // Must be before /:id to avoid being captured as a param
  fastify.get('/merge-preview', async (request, reply) => {
    const query = mergePreviewQuerySchema.parse(request.query);

    const preview = await getMergePreview(
      fastify.prisma,
      request.agent.tenantId,
      query.primaryId,
      query.secondaryId,
    );

    return reply.send(success(preview));
  });

  // POST /api/v1/contacts/merge
  fastify.post('/merge', async (request, reply) => {
    const body = mergeBodySchema.parse(request.body);

    const result = await mergeContacts(
      fastify.prisma,
      fastify.io,
      request.agent.tenantId,
      body.primaryContactId,
      body.secondaryContactId,
    );

    return reply.send(success(result));
  });

  // GET /api/v1/contacts/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const contact = await getContact(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );

    return reply.send(success(contact));
  });

  // PATCH /api/v1/contacts/:id
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const data = updateContactSchema.parse(request.body);

    const contact = await updateContact(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
      data,
    );

    return reply.send(success(contact));
  });

  // GET /api/v1/contacts/:id/conversations
  fastify.get<{ Params: { id: string } }>('/:id/conversations', async (request, reply) => {
    const query = paginationQuerySchema.parse(request.query);

    const { conversations, total } = await getContactConversations(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
      query.page,
      query.limit,
    );

    return reply.send(paginated(conversations, total, query.page, query.limit));
  });

  // GET /api/v1/contacts/:id/cases
  fastify.get<{ Params: { id: string } }>('/:id/cases', async (request, reply) => {
    const query = paginationQuerySchema.parse(request.query);

    const { cases, total } = await getContactCases(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
      query.page,
      query.limit,
    );

    return reply.send(paginated(cases, total, query.page, query.limit));
  });

  // POST /api/v1/contacts/:id/tags
  fastify.post<{ Params: { id: string } }>('/:id/tags', async (request, reply) => {
    const body = addTagSchema.parse(request.body);

    const contactTag = await addContactTag(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
      body.tagId,
      request.agent.id,
    );

    return reply.status(201).send(success(contactTag));
  });

  // DELETE /api/v1/contacts/:id/tags/:tagId
  fastify.delete<{ Params: { id: string; tagId: string } }>(
    '/:id/tags/:tagId',
    async (request, reply) => {
      await removeContactTag(
        fastify.prisma,
        request.params.id,
        request.agent.tenantId,
        request.params.tagId,
      );

      return reply.send(success({ deleted: true }));
    },
  );

  // GET /api/v1/contacts/:id/timeline
  fastify.get<{ Params: { id: string } }>('/:id/timeline', async (request, reply) => {
    const timeline = await getContactTimeline(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );

    return reply.send(success(timeline));
  });
}
