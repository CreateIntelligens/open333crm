import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { success } from '../../shared/utils/response.js';
import { getTenantAiPrivacy, setTenantAiPrivacy } from './ai-privacy.service.js';

const paramsSchema = z.object({ id: z.string().uuid() });
const patchSchema = z.object({ enabled: z.boolean() }).strict();

export default async function aiPrivacyRoutes(fastify: FastifyInstance, options: { preHandler: preHandlerHookHandler[] }) {
  const guard = { preHandler: options.preHandler };
  fastify.get('/tenants/:id/ai-privacy', guard, async (request) => {
    const { id } = paramsSchema.parse(request.params);
    return success(await getTenantAiPrivacy(fastify.prismaAdmin, id));
  });
  fastify.patch('/tenants/:id/ai-privacy', guard, async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const { enabled } = patchSchema.parse(request.body);
    return success(await setTenantAiPrivacy(fastify.prismaAdmin, id, request.platformUser!.id, enabled));
  });
}
