import { FastifyInstance } from 'fastify';
import { CaseService } from '@open333crm/core';
import { CaseStatus, Priority } from '@open333crm/database';

export default async function caseRoutes(app: FastifyInstance) {
  app.post('/', async (request, reply) => {
    const tenantId = (request.user as any)?.tenantId || 'default-tenant';
    const data = request.body as any;
    const newCase = await CaseService.create({
      tenantId,
      contactId: data.contactId,
      channelId: data.channelId,
      conversationId: data.conversationId,
      title: data.title,
      description: data.description,
      priority: data.priority as Priority,
    });
    return newCase;
  });

  app.patch('/:id/status', async (request) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: CaseStatus };
    const agentId = (request.user as any)?.id;
    return CaseService.updateStatus(id, status, agentId);
  });
}
