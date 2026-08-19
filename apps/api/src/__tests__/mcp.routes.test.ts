import assert from "node:assert/strict";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";

import mcpRoutes from "../modules/mcp/mcp.routes.js";
import { MCP_READ_SCOPE } from "../modules/mcp/mcp.constants.js";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

function createPrismaMock() {
  return {
    agent: {
      findFirst: async () => ({
        id: AGENT_ID,
        tenantId: TENANT_ID,
        email: "agent@example.test",
        name: "MCP Agent",
        role: "ADMIN",
        avatarUrl: null,
        isActive: true,
      }),
    },
    contact: {
      findMany: async () => [
        {
          id: "44444444-4444-4444-8444-444444444444",
          tenantId: TENANT_ID,
          displayName: "Ada Lovelace",
          legacyId: 9007199254740993n,
          channelIdentities: [],
          tags: [],
        },
      ],
      count: async () => 1,
    },
  };
}

async function createApp(options?: { scopes?: string[] }) {
  const app = Fastify();
  app.decorate("prisma", createPrismaMock());
  app.decorate(
    "authenticateJwtOrCliSession",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.headers.authorization) {
        return reply.status(401).send({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Missing token" },
        });
      }

      request.agent = {
        id: AGENT_ID,
        tenantId: TENANT_ID,
        role: "ADMIN",
        isCliSession: true,
        cliSession: {
          id: "33333333-3333-4333-8333-333333333333",
          name: "MCP test",
          scopes: options?.scopes ?? [MCP_READ_SCOPE],
          expiresAt: new Date(Date.now() + 60_000),
          lastUsedAt: null,
          tokenPrefix: "cli_test",
          tokenSuffix: "test",
        },
      };
    },
  );
  await app.register(mcpRoutes);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  return { app, address };
}

async function requestMcp(
  address: string,
  options: {
    authorization?: string;
    cookie?: string;
    origin?: string;
    body: unknown;
  },
) {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  if (options.authorization) headers.authorization = options.authorization;
  if (options.cookie) headers.cookie = options.cookie;
  if (options.origin) headers.origin = options.origin;

  return fetch(`${address}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body),
  });
}

const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  },
};

async function testRejectsMissingAuthentication() {
  const { app, address } = await createApp();
  try {
    const response = await requestMcp(address, { body: initializeRequest });
    assert.equal(response.status, 401);
  } finally {
    await app.close();
  }
}

async function testInitializesMcpServer() {
  const { app, address } = await createApp({
    scopes: [MCP_READ_SCOPE],
  });
  try {
    const response = await requestMcp(address, {
      authorization: "Bearer cli_test",
      body: initializeRequest,
    });

    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const body = JSON.parse(responseText) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    assert.equal(body.result.protocolVersion, "2025-06-18");
    assert.equal(body.result.serverInfo.name, "open333crm");
  } finally {
    await app.close();
  }
}

async function testRejectsUntrustedOrigin() {
  const { app, address } = await createApp({
    scopes: [MCP_READ_SCOPE],
  });
  try {
    const response = await fetch(`${address}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer cli_test",
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify(initializeRequest),
    });

    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "FORBIDDEN_ORIGIN");
  } finally {
    await app.close();
  }
}

async function testAllowsConfiguredOriginOnly() {
  const previousOrigins = process.env.MCP_ALLOWED_ORIGINS;
  process.env.MCP_ALLOWED_ORIGINS = "https://crm.example.test";
  const { app, address } = await createApp();
  try {
    const response = await requestMcp(address, {
      authorization: "Bearer cli_test",
      origin: "https://crm.example.test",
      body: initializeRequest,
    });
    assert.equal(response.status, 200);
  } finally {
    await app.close();
    if (previousOrigins === undefined) {
      delete process.env.MCP_ALLOWED_ORIGINS;
    } else {
      process.env.MCP_ALLOWED_ORIGINS = previousOrigins;
    }
  }
}

async function testListsReadOnlyTools() {
  const { app, address } = await createApp({
    scopes: [MCP_READ_SCOPE],
  });
  try {
    const response = await requestMcp(address, {
      authorization: "Bearer cli_test",
      body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });

    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const body = JSON.parse(responseText) as {
      result: { tools: Array<{ name: string }> };
    };
    const names = body.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, [
      "crm_get_current_agent",
      "crm_search_contacts",
      "crm_list_cases",
      "crm_get_case",
      "crm_get_contact",
      "crm_get_analytics_overview",
      "crm_get_case_statistics",
    ]);
  } finally {
    await app.close();
  }
}

async function testRejectsCliTokenWithoutMcpScope() {
  const { app, address } = await createApp({
    scopes: ["cli:status"],
  });
  try {
    const response = await requestMcp(address, {
      authorization: "Bearer cli_test",
      body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });

    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "INSUFFICIENT_SCOPE");
  } finally {
    await app.close();
  }
}

async function testRejectsCookieOnlyAuthentication() {
  const { app, address } = await createApp();
  try {
    const response = await requestMcp(address, {
      cookie: "refreshToken=not-an-access-token",
      body: initializeRequest,
    });
    assert.equal(response.status, 401);
  } finally {
    await app.close();
  }
}

async function testCallsSearchContactsAndPreservesBigInt() {
  const { app, address } = await createApp();
  try {
    const response = await requestMcp(address, {
      authorization: "Bearer cli_test",
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "crm_search_contacts",
          arguments: { q: "Ada", page: 1, limit: 20 },
        },
      },
    });

    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const body = JSON.parse(responseText) as {
      result: { content: Array<{ type: string; text: string }> };
    };
    assert.equal(body.result.content[0]?.type, "text");
    const result = JSON.parse(body.result.content[0]!.text) as {
      contacts: Array<{ legacyId: string }>;
      total: number;
    };
    assert.equal(result.total, 1);
    assert.equal(result.contacts[0]?.legacyId, "9007199254740993");
  } finally {
    await app.close();
  }
}

async function testRejectsInvalidToolInput() {
  const { app, address } = await createApp();
  try {
    const response = await requestMcp(address, {
      authorization: "Bearer cli_test",
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "crm_search_contacts",
          arguments: { limit: 999 },
        },
      },
    });

    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const body = JSON.parse(responseText) as {
      result: {
        isError?: boolean;
        content: Array<{ type: string; text: string }>;
      };
    };
    assert.equal(body.result.isError, true);
    assert.match(body.result.content[0]?.text ?? "", /invalid|limit/i);
  } finally {
    await app.close();
  }
}

await testRejectsMissingAuthentication();
await testRejectsCookieOnlyAuthentication();
await testInitializesMcpServer();
await testRejectsUntrustedOrigin();
await testAllowsConfiguredOriginOnly();
await testListsReadOnlyTools();
await testCallsSearchContactsAndPreservesBigInt();
await testRejectsInvalidToolInput();
await testRejectsCliTokenWithoutMcpScope();
console.log("mcp.routes.test.ts passed");
process.exit(0);
