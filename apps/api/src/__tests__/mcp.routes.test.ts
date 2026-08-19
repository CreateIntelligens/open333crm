import assert from "node:assert/strict";
import Fastify from "fastify";

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
  };
}

async function createApp(options?: {
  authorization?: string;
  scopes?: string[];
}) {
  const app = Fastify();
  app.decorate("prisma", createPrismaMock());
  app.decorate(
    "authenticateJwtOrCliSession",
    async (request: any, reply: any) => {
      if (!options?.authorization) {
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
          scopes: options.scopes ?? [MCP_READ_SCOPE],
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
  options: { authorization?: string; body: unknown },
) {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  if (options.authorization) headers.authorization = options.authorization;

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
    authorization: "Bearer cli_test",
  });
  try {
    const response = await requestMcp(address, {
      authorization: "Bearer cli_test",
      body: initializeRequest,
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
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
    authorization: "Bearer cli_test",
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

async function testListsReadOnlyTools() {
  const { app, address } = await createApp({
    authorization: "Bearer cli_test",
  });
  try {
    const response = await requestMcp(address, {
      authorization: "Bearer cli_test",
      body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
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
    authorization: "Bearer cli_test",
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

await testRejectsMissingAuthentication();
await testInitializesMcpServer();
await testRejectsUntrustedOrigin();
await testListsReadOnlyTools();
await testRejectsCliTokenWithoutMcpScope();
console.log("mcp.routes.test.ts passed");
process.exit(0);
