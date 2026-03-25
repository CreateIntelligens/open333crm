import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listCases,
  getCase,
  createCase,
  assignCase,
  transitionCase,
  escalateCase,
  addNote,
  getCaseEvents,
  createCaseFromConversation,
  updateCase,
  getCaseStats,
} from './case.service.js';
import { recordCsatScore } from '../csat/csat.service.js';
import { success, paginated } from '../../shared/utils/response.js';

const CASE_CATEGORIES = ['維修', '查詢', '投訴', '其他'];

const listQuerySchema = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  assigneeId: z.string().uuid().optional(),
  category: z.string().optional(),
  slaStatus: z.enum(['normal', 'warning', 'breached']).optional(),
  sortBy: z.enum(['slaDueAt', 'priority', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const createCaseSchema = z.object({
  contactId: z.string().uuid(),
  channelId: z.string().uuid(),
  title: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  category: z.string().optional(),
  assigneeId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
});

const updateCaseSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  category: z.string().optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'ESCALATED', 'CLOSED']).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
});

const assignSchema = z.object({
  assigneeId: z.string().uuid(),
});

const escalateSchema = z.object({
  reason: z.string().min(1),
  note: z.string().max(500).optional(),
  newPriority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  assigneeId: z.string().uuid().optional(),
  notifyTargets: z.array(z.string()).optional(),
});

const addNoteSchema = z.object({
  content: z.string().min(1),
  isInternal: z.boolean().default(true),
});

const csatSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

const createCaseFromConvSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  category: z.string().optional(),
  assigneeId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
});

export default async function caseRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/cases/categories
  fastify.get('/categories', async (_request, reply) => {
    return reply.send(success(CASE_CATEGORIES));
  });

  // GET /api/v1/cases/stats
  fastify.get('/stats', async (request, reply) => {
    const stats = await getCaseStats(fastify.prisma, request.agent.tenantId);
    return reply.send(success(stats));
  });

  // GET /api/v1/cases
  fastify.get('/', async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, ...filters } = query;

    const { cases, total } = await listCases(
      fastify.prisma,
      request.agent.tenantId,
      filters,
      { page, limit },
    );

    return reply.send(paginated(cases, total, page, limit));
  });

  // POST /api/v1/cases
  fastify.post('/', async (request, reply) => {
    const data = createCaseSchema.parse(request.body);

    const caseRecord = await createCase(
      fastify.prisma,
      fastify.io,
      request.agent.tenantId,
      request.agent.id,
      data,
    );

    return reply.status(201).send(success(caseRecord));
  });

  // GET /api/v1/cases/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const caseRecord = await getCase(
      fastify.prisma,
      request.params.id,
      request.agent.tenantId,
    );

    return reply.send(success(caseRecord));
  });

  // PATCH /api/v1/cases/:id
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const data = updateCaseSchema.parse(request.body);

    const caseRecord = await updateCase(
      fastify.prisma,
      fastify.io,
      request.params.id,
      request.agent.tenantId,
      data,
    );

    return reply.send(success(caseRecord));
  });

  // GET /api/v1/cases/:id/events
  fastify.get<{ Params: { id: string } }>('/:id/events', async (request, reply) => {
    const events = await getCaseEvents(fastify.prisma, request.params.id);
    return reply.send(success(events));
  });

  // POST /api/v1/cases/:id/notes
  fastify.post<{ Params: { id: string } }>('/:id/notes', async (request, reply) => {
    const data = addNoteSchema.parse(request.body);

    const note = await addNote(
      fastify.prisma,
      request.params.id,
      request.agent.id,
      data.content,
      data.isInternal,
    );

    return reply.status(201).send(success(note));
  });

  // POST /api/v1/cases/:id/assign
  fastify.post<{ Params: { id: string } }>('/:id/assign', async (request, reply) => {
    const data = assignSchema.parse(request.body);

    const caseRecord = await assignCase(
      fastify.prisma,
      fastify.io,
      request.params.id,
      request.agent.tenantId,
      request.agent.id,
      data.assigneeId,
    );

    return reply.send(success(caseRecord));
  });

  // POST /api/v1/cases/:id/resolve
  fastify.post<{ Params: { id: string } }>('/:id/resolve', async (request, reply) => {
    const caseRecord = await transitionCase(
      fastify.prisma,
      fastify.io,
      request.params.id,
      request.agent.tenantId,
      request.agent.id,
      'RESOLVED',
    );

    return reply.send(success(caseRecord));
  });

  // POST /api/v1/cases/:id/close
  fastify.post<{ Params: { id: string } }>('/:id/close', async (request, reply) => {
    const caseRecord = await transitionCase(
      fastify.prisma,
      fastify.io,
      request.params.id,
      request.agent.tenantId,
      request.agent.id,
      'CLOSED',
    );

    return reply.send(success(caseRecord));
  });

  // POST /api/v1/cases/:id/reopen
  fastify.post<{ Params: { id: string } }>('/:id/reopen', async (request, reply) => {
    const caseRecord = await transitionCase(
      fastify.prisma,
      fastify.io,
      request.params.id,
      request.agent.tenantId,
      request.agent.id,
      'OPEN',
    );

    return reply.send(success(caseRecord));
  });

  // POST /api/v1/cases/:id/escalate
  fastify.post<{ Params: { id: string } }>('/:id/escalate', async (request, reply) => {
    const body = escalateSchema.parse(request.body);

    const caseRecord = await escalateCase(
      fastify.prisma,
      fastify.io,
      request.params.id,
      request.agent.tenantId,
      request.agent.id,
      body,
    );

    return reply.send(success(caseRecord));
  });

  // POST /api/v1/cases/:id/csat — Record CSAT score (WebChat / manual)
  fastify.post<{ Params: { id: string } }>('/:id/csat', async (request, reply) => {
    const data = csatSchema.parse(request.body);

    const recorded = await recordCsatScore(
      fastify.prisma,
      fastify.io,
      request.params.id,
      data.score,
      data.comment,
    );

    if (!recorded) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Unable to record CSAT score. Case may not exist or already rated.' },
      });
    }

    return reply.send(success({ score: data.score, comment: data.comment }));
  });

  // POST /api/v1/cases/from-conversation/:conversationId
  fastify.post<{ Params: { conversationId: string } }>(
    '/from-conversation/:conversationId',
    async (request, reply) => {
      const data = createCaseFromConvSchema.parse(request.body);

      const caseRecord = await createCaseFromConversation(
        fastify.prisma,
        fastify.io,
        request.params.conversationId,
        request.agent.tenantId,
        request.agent.id,
        data,
      );

      return reply.status(201).send(success(caseRecord));
    },
  );
}
