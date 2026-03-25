import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success } from '../../shared/utils/response.js';
import { getOfficeHours, updateOfficeHours } from './office-hours.service.js';

const dayScheduleSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
}).nullable();

const officeHoursSchema = z.object({
  timezone: z.string().default('Asia/Taipei'),
  officeHours: z.object({
    enabled: z.boolean(),
    schedule: z.object({
      mon: dayScheduleSchema.optional(),
      tue: dayScheduleSchema.optional(),
      wed: dayScheduleSchema.optional(),
      thu: dayScheduleSchema.optional(),
      fri: dayScheduleSchema.optional(),
      sat: dayScheduleSchema.optional(),
      sun: dayScheduleSchema.optional(),
    }),
    holidays: z.array(z.string()).default([]),
    outsideHoursMessage: z.string().default('您好！目前為非營業時間，我們將在營業時間內盡速回覆您。'),
  }),
});

export default async function settingsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/settings/office-hours
  fastify.get('/office-hours', async (request, reply) => {
    const result = await getOfficeHours(fastify.prisma, request.agent.tenantId);
    return reply.send(success(result));
  });

  // PUT /api/v1/settings/office-hours
  fastify.put('/office-hours', async (request, reply) => {
    const data = officeHoursSchema.parse(request.body);
    const result = await updateOfficeHours(
      fastify.prisma,
      request.agent.tenantId,
      data.timezone,
      data.officeHours as any,
    );
    return reply.send(success(result));
  });
}
