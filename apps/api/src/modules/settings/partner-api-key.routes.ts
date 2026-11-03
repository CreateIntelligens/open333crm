import type { FastifyInstance } from "fastify";
import { z } from "zod/v3";
import { success } from "../../shared/utils/response.js";
import { actorOf } from "../../lib/request-actor.js";
import {
  createPartnerApiKeyFlow,
  listPartnerApiKeysFlow,
  revokePartnerApiKeyFlow,
} from "../auth/partner-api-key.flow.js";

/** Partner API 金鑰的管理。由 settings.routes.ts 註冊，沿用該檔的登入檢查與 settings.manage */
export default async function partnerApiKeyRoutes(fastify: FastifyInstance) {
  // GET /api/v1/settings/api-keys — list (masked)
  fastify.get("/api-keys", async (request, reply) => {
    const rows = await listPartnerApiKeysFlow(fastify, actorOf(request).tenantId);
    return reply.send(
      success(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          masked: `${r.keyPrefix}…${r.keySuffix}`,
          isActive: r.isActive,
          expiresAt: r.expiresAt,
          lastUsedAt: r.lastUsedAt,
          createdAt: r.createdAt,
        })),
      ),
    );
  });

  // POST /api/v1/settings/api-keys — create (returns raw key once)
  fastify.post("/api-keys", async (request, reply) => {
    const body = createApiKeySchema.parse(request.body);
    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const result = await createPartnerApiKeyFlow(fastify, actorOf(request), { name: body.name, expiresAt });

    return reply.status(201).send(
      success({
        // The raw key is only available here. Store it on the client side
        // immediately — the server will never return it again.
        key: result.key,
        id: result.apiKey.id,
        name: result.apiKey.name,
        masked: `${result.apiKey.keyPrefix}…${result.apiKey.keySuffix}`,
        expiresAt: result.apiKey.expiresAt,
        createdAt: result.apiKey.createdAt,
      }),
    );
  });

  // DELETE /api/v1/settings/api-keys/:id — revoke (soft-delete; isActive=false)
  fastify.delete<{ Params: { id: string } }>(
    "/api-keys/:id",
    async (request, reply) => {
      await revokePartnerApiKeyFlow(fastify, actorOf(request).tenantId, request.params.id);
      return reply.send(success({ revoked: true }));
    },
  );
}

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  // null / undefined / 0 → never expires
  expiresInDays: z.number().int().positive().nullable().optional(),
});
