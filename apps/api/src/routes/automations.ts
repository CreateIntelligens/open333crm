import { FastifyInstance } from 'fastify';
import { prisma } from '@open333crm/database';

export default async function automationRoutes(app: FastifyInstance) {
  app.get('/rules', async (request) => {
    const tenantId = (request.user as any)?.tenantId || 'default-tenant';
    
    const rules = await prisma.automationRule.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { logs: true }
        }
      }
    });

    return { rules };
  });

  app.post('/rules', async (request, reply) => {
    const tenantId = (request.user as any)?.tenantId || 'default-tenant';
    const data = request.body as any;

    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: data.name,
        isActive: data.isActive ?? true,
        trigger: data.trigger,
        conditions: data.conditions,
        actions: data.actions
      }
    });

    return reply.status(201).send(rule);
  });

  app.get('/logs', async (request) => {
    // Basic logs viewing endpoint
    const logs = await prisma.automationLog.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: {
        rule: {
          select: { name: true }
        }
      }
    });
    return { logs };
  });
}
