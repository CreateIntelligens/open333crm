import type { FastifyInstance } from "fastify";
import { z } from "zod/v3";
import { success } from "../../shared/utils/response.js";
import { actorOf } from "../../lib/request-actor.js";
import { parseCliScopes, DEFAULT_CLI_SCOPES } from "../auth/cli-session.service.js";
import { createCliSessionFlow, listCliSessionsFlow, revokeCliSessionFlow } from "../auth/cli-session.flow.js";
import { MCP_READ_SCOPE } from "../mcp/mcp.constants.js";

/** CLI 連線（CLI token 的管理）。由 settings.routes.ts 註冊，沿用該檔的登入檢查與 settings.manage */
export default async function cliSessionRoutes(fastify: FastifyInstance) {
  // GET /api/v1/settings/cli-sessions — list CLI sessions for current tenant
  fastify.get("/cli-sessions", async (request, reply) => {
    const rows = await listCliSessionsFlow(fastify, actorOf(request).tenantId);
    return reply.send(
      success(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          agent: r.agent,
          tokenPrefix: r.tokenPrefix,
          tokenSuffix: r.tokenSuffix,
          scopes: parseCliScopes(r.scopes),
          expiresAt: r.expiresAt.toISOString(),
          lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
      ),
    );
  });

  // POST /api/v1/settings/cli-sessions — create a new CLI session
  fastify.post("/cli-sessions", async (request, reply) => {
    const body = createCliSessionSchema.parse(request.body);
    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;

    const { token, session } = await createCliSessionFlow(fastify, actorOf(request), {
      name: body.name,
      scopes: body.mcpRead
        ? [...new Set([...(body.scopes ?? DEFAULT_CLI_SCOPES), MCP_READ_SCOPE])]
        : body.scopes,
      expiresAt,
    });

    return reply.status(201).send(
      success({
        token,
        session: {
          id: session.id,
          name: session.name,
          tokenPrefix: session.tokenPrefix,
          tokenSuffix: session.tokenSuffix,
          scopes: parseCliScopes(session.scopes),
          expiresAt: session.expiresAt.toISOString(),
          createdAt: session.createdAt.toISOString(),
        },
      }),
    );
  });

  // DELETE /api/v1/settings/cli-sessions/:id — revoke a CLI session
  fastify.delete(
    "/cli-sessions/:id",
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      await revokeCliSessionFlow(fastify, actorOf(request), id);
      return reply.send(success({ revoked: true }));
    },
  );
}

const idParams = z.object({ id: z.string().uuid('CLI 連線識別格式不正確') });

const createCliSessionSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).optional(),
  mcpRead: z.boolean().default(false),
  expiresInDays: z.number().int().positive().nullable().optional(),
});
