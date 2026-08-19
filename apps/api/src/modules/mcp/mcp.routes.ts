import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { hasCliScope } from "../auth/cli-session.service.js";
import { MCP_READ_SCOPE } from "./mcp.constants.js";
import { createMcpServer } from "./mcp.server.js";

function toWebRequest(request: FastifyRequest): Request {
  const protocol = request.protocol;
  const host = request.headers.host ?? request.hostname;
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = JSON.stringify(request.body ?? null);
    init.duplex = "half";
  }

  return new Request(`${protocol}://${host}${request.raw.url ?? "/mcp"}`, init);
}

async function sendWebResponse(
  reply: FastifyReply,
  response: Response,
): Promise<void> {
  reply.hijack();
  reply.raw.statusCode = response.status;
  response.headers.forEach((value, key) => reply.raw.setHeader(key, value));

  if (!response.body) {
    reply.raw.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      reply.raw.write(chunk.value);
    }
  } finally {
    reader.releaseLock();
    reply.raw.end();
  }
}

function jsonRpcMethodNotAllowed(reply: FastifyReply) {
  return reply.status(405).send({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
}

function isAllowedOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (origin === "null") return false;

  const configuredOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configuredOrigins.includes(origin);
}

async function authenticateMcp(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  await fastify.authenticateJwtOrCliSession(request, reply);
  if (reply.sent) return false;

  const cliSession = request.agent.cliSession;
  if (cliSession && !hasCliScope(cliSession.scopes, MCP_READ_SCOPE)) {
    reply.status(403).send({
      success: false,
      error: {
        code: "INSUFFICIENT_SCOPE",
        message: `MCP token requires ${MCP_READ_SCOPE} scope`,
      },
    });
    return false;
  }

  return true;
}

export default async function mcpRoutes(fastify: FastifyInstance) {
  const preHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isAllowedOrigin(request)) {
      reply.status(403).send({
        success: false,
        error: {
          code: "FORBIDDEN_ORIGIN",
          message: "Origin is not allowed for MCP requests",
        },
      });
      return;
    }

    await authenticateMcp(fastify, request, reply);
  };

  fastify.post("/mcp", { preHandler }, async (request, reply) => {
    if (reply.sent) return reply;

    const server = createMcpServer(fastify.prisma, request.agent);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      const response = await transport.handleRequest(toWebRequest(request));
      await sendWebResponse(reply, response);
    } catch (error) {
      request.log.error({ err: error }, "MCP request failed");
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.setHeader("content-type", "application/json");
        reply.raw.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal MCP server error",
            },
            id: null,
          }),
        );
      }
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });

  fastify.get("/mcp", { preHandler }, async (_request, reply) =>
    jsonRpcMethodNotAllowed(reply),
  );
  fastify.delete("/mcp", { preHandler }, async (_request, reply) =>
    jsonRpcMethodNotAllowed(reply),
  );
}
