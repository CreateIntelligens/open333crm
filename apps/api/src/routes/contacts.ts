import { FastifyInstance } from 'fastify';
import { ContactService } from '@open333crm/core';

export default async function contactRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    // In a real system, we'd get tenantId from auth context
    const tenantId = (request.user as any)?.tenantId || 'default-tenant';
    // List contacts logic (simplified)
    return { contacts: [] };
  });

  app.post('/:id/tags', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tagId } = request.body as { tagId: string };
    await ContactService.addTag(id, tagId, 'agent');
    return { success: true };
  });

  app.post('/:id/attributes', async (request) => {
    const { id } = request.params as { id: string };
    const { key, value, dataType } = request.body as { key: string; value: string; dataType?: string };
    await ContactService.setAttribute(id, key, value, dataType);
    return { success: true };
  });
}
