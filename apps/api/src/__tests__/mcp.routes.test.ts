import assert from "node:assert/strict";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { registerChannelPlugin } from "@open333crm/channel-plugins";
import { encryptCredentials } from "../modules/channel/channel.service.js";

import mcpRoutes from "../modules/mcp/mcp.routes.js";
import type { McpChannelAccess } from "../modules/mcp/mcp.server.js";
import { ALL_CHANNELS } from "../services/channel-visibility.js";
import { AppError } from "../shared/utils/response.js";
import { notFound } from "../shared/messages/resource.js";
import { MCP_LINE_READ_SCOPE, MCP_LINE_SEND_SCOPE, MCP_READ_SCOPE } from "../modules/mcp/mcp.constants.js";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

/** 記錄 mock 收到的查詢條件，用來確認列表工具有帶渠道過濾 */
const recordedWhere: Record<string, unknown[]> = { conversation: [], case: [], contact: [] };
let messagesCreated = 0;

/** 總店：不限渠道（既有測試的預設） */
const unrestrictedAccess = (): McpChannelAccess => ({
  accessible: async () => ALL_CHANNELS,
  assertConversation: async () => {},
});

function createPrismaMock() {
  const conversation = {
    id: "55555555-5555-4555-8555-555555555555",
    tenantId: TENANT_ID,
    channelId: "66666666-6666-4666-8666-666666666666",
    channel: {
      id: "66666666-6666-4666-8666-666666666666",
      channelType: "LINE",
      displayName: "Test LINE",
      isActive: true,
      credentialsEncrypted: encryptCredentials({ channelAccessToken: "test-token" }),
    },
    contact: {
      id: "77777777-7777-4777-8777-777777777777",
      displayName: "LINE Contact",
      channelIdentities: [{
        id: "99999999-9999-4999-8999-999999999999",
        channelId: "66666666-6666-4666-8666-666666666666",
        uid: "U-test-contact",
      }],
      tags: [],
    },
    messages: [],
  };
  const message = {
    id: "88888888-8888-4888-8888-888888888888",
    conversationId: conversation.id,
    direction: "OUTBOUND",
    senderType: "AGENT",
    senderId: AGENT_ID,
    contentType: "text",
    content: { text: "hello" },
    metadata: {},
    createdAt: new Date(),
    sequence: 1,
    sender: null,
  };
  const broadcast = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    tenantId: TENANT_ID,
    channelId: conversation.channelId,
    status: "draft",
    targetType: "all",
    targetConfig: {},
    totalCount: 0,
    successCount: 0,
    failedCount: 0,
    material: null,
  };
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
      findMany: async (args: { include?: { channelIdentities?: { where?: unknown } } }) => { recordedWhere.contact!.push(args.include?.channelIdentities?.where); return [
        {
          id: "44444444-4444-4444-8444-444444444444",
          tenantId: TENANT_ID,
          displayName: "Ada Lovelace",
          legacyId: 9007199254740993n,
          channelIdentities: [],
          tags: [],
        },
      ]; },
      count: async () => 1,
    },
    case: {
      findMany: async (args: { where?: unknown }) => { recordedWhere.case!.push(args.where); return []; },
      count: async () => 0,
      findFirst: async () => ({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", tenantId: TENANT_ID, channelId: conversation.channelId, title: "Case", slaPolicy: null, events: [], notes: [], tags: [], conversations: [] }),
    },
    conversation: {
      findMany: async (args: { where?: unknown }) => { recordedWhere.conversation!.push(args.where); return [conversation]; },
      findFirst: async (args: { where?: { id?: string } }) =>
        args.where?.id && args.where.id !== conversation.id ? null : conversation,
      findUnique: async () => conversation,
      count: async () => 1,
      update: async () => conversation,
    },
    channel: {
      findFirst: async () => conversation.channel,
    },
    broadcast: {
      findFirst: async () => broadcast,
    },
    broadcastRecipient: {
      count: async () => 0,
    },
    message: {
      count: async () => 0,
      create: async () => { messagesCreated++; return message; },
      update: async () => message,
    },
    tenantAuditLog: {
      create: async () => ({}),
    },
  };
}

async function createApp(options?: {
  scopes?: string[];
  authentication?: "cli" | "jwt";
  channelAccess?: () => McpChannelAccess;
}) {
  const app = Fastify();
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-mcp-confirmation-secret";
  process.env.CREDENTIAL_ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY || "test-credential-encryption-key-32-bytes!!";
  app.decorate("prisma", createPrismaMock());
  app.decorate("io", { to: () => ({ emit() {} }) });
  registerChannelPlugin({
    channelType: "LINE",
    parseWebhook: async () => [],
    getProfile: async (uid: string) => ({ uid, displayName: uid }),
    sendMessage: async () => ({ success: true, channelMsgId: "line-msg-1", requestId: "line-request-1" }),
    extensions: {
      analytics: {
        getMessageQuota: async () => ({ totalUsage: 10, maxMessages: 10 }),
        getFollowerStats: async () => ({ followers: 0, blocks: 0 }),
        getDemographics: async () => ({}),
        getDeliveryStats: async () => ({}),
      },
    },
  });
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
        ...(options?.authentication !== "jwt"
          ? {
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
            }
          : {}),
      };
      (request as FastifyRequest & { tenantPrisma: ReturnType<typeof createPrismaMock> }).tenantPrisma = createPrismaMock();
    },
  );
  await app.register(mcpRoutes, { channelAccess: options?.channelAccess ?? unrestrictedAccess });
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
      "crm_line_list_conversations",
      "crm_line_get_conversation",
      "crm_line_search_contacts",
      "crm_line_get_broadcast",
      "crm_line_direct_send",
      "crm_line_broadcast_initiate",
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

async function testRejectsJwtWithoutMcpScope() {
  const { app, address } = await createApp({ authentication: "jwt" });
  try {
    const response = await requestMcp(address, {
      authorization: "Bearer jwt_test",
      body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });

    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "INSUFFICIENT_SCOPE");
  } finally {
    await app.close();
  }
}

async function testAllowsSameOriginInDevelopmentWithoutConfiguredOrigins() {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousOrigins = process.env.MCP_ALLOWED_ORIGINS;
  process.env.NODE_ENV = "development";
  delete process.env.MCP_ALLOWED_ORIGINS;

  const { app, address } = await createApp();
  try {
    const origin = new URL(address).origin;
    const response = await requestMcp(address, {
      authorization: "Bearer cli_test",
      origin,
      body: initializeRequest,
    });
    assert.equal(response.status, 200);
  } finally {
    await app.close();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousOrigins === undefined) delete process.env.MCP_ALLOWED_ORIGINS;
    else process.env.MCP_ALLOWED_ORIGINS = previousOrigins;
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

async function testConfirmedLineDirectSend() {
  const { app, address } = await createApp({
    scopes: [MCP_READ_SCOPE, MCP_LINE_SEND_SCOPE],
  });
  try {
    const previewResponse = await requestMcp(address, {
      authorization: "Bearer cli_test",
      body: {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "crm_line_direct_send",
          arguments: {
            conversationId: "55555555-5555-4555-8555-555555555555",
            contentType: "text",
            content: { text: "hello" },
          },
        },
      },
    });
    assert.equal(previewResponse.status, 200);
    const previewBody = JSON.parse(await previewResponse.text()) as {
      result: { content: Array<{ text: string }> };
    };
    const preview = JSON.parse(previewBody.result.content[0]!.text) as {
      status: string;
      confirmationToken: string;
    };
    assert.equal(preview.status, "preview");
    assert.ok(preview.confirmationToken);

    const confirmedResponse = await requestMcp(address, {
      authorization: "Bearer cli_test",
      body: {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "crm_line_direct_send",
          arguments: {
            confirmation: true,
            confirmationToken: preview.confirmationToken,
          },
        },
      },
    });
    assert.equal(confirmedResponse.status, 200);
    const confirmedBody = JSON.parse(await confirmedResponse.text()) as {
      result: { content: Array<{ text: string }> };
    };
    const confirmed = JSON.parse(confirmedBody.result.content[0]!.text) as {
      status: string;
      messageId: string;
    };
    assert.equal(confirmed.status, "dispatched");
    assert.equal(confirmed.messageId, "88888888-8888-4888-8888-888888888888");
  } finally {
    await app.close();
  }
}

async function testRejectsLineDirectSendWithoutScope() {
  const { app, address } = await createApp({ scopes: [MCP_READ_SCOPE] });
  try {
    const response = await requestMcp(address, {
      authorization: "Bearer cli_test",
      body: {
        jsonrpc: "2.0",
        id: 15,
        method: "tools/call",
        params: {
          name: "crm_line_direct_send",
          arguments: {
            conversationId: "55555555-5555-4555-8555-555555555555",
            contentType: "text",
            content: { text: "should reject" },
          },
        },
      },
    });
    assert.equal(response.status, 403);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "INSUFFICIENT_SCOPE");
  } finally {
    await app.close();
  }
}

async function testRejectsForeignLineConversation() {
  const { app, address } = await createApp({
    scopes: [MCP_READ_SCOPE, MCP_LINE_SEND_SCOPE],
  });
  try {
    const response = await requestMcp(address, {
      authorization: "Bearer cli_test",
      body: {
        jsonrpc: "2.0",
        id: 16,
        method: "tools/call",
        params: {
          name: "crm_line_direct_send",
          arguments: {
            conversationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            contentType: "text",
            content: { text: "should not leak" },
          },
        },
      },
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal(body.includes("LINE Contact"), false);
  } finally {
    await app.close();
  }
}

async function testListsLineConversationsWithTenantScope() {
  const { app, address } = await createApp({
    scopes: [MCP_READ_SCOPE, MCP_LINE_READ_SCOPE],
  });
  try {
    const response = await requestMcp(address, {
      authorization: "Bearer cli_test",
      body: {
        jsonrpc: "2.0",
        id: 14,
        method: "tools/call",
        params: {
          name: "crm_line_list_conversations",
          arguments: { page: 1, limit: 20 },
        },
      },
    });
    assert.equal(response.status, 200);
    const body = JSON.parse(await response.text()) as { result: { content: Array<{ text: string }> } };
    const result = JSON.parse(body.result.content[0]!.text) as { total: number; conversations: unknown[] };
    assert.equal(result.total, 1);
    assert.equal(result.conversations.length, 1);
  } finally {
    await app.close();
  }
}

async function testConfirmedLineBroadcastRejectsQuota() {
  const { app, address } = await createApp({
    scopes: [MCP_READ_SCOPE, "mcp:line:broadcast"],
  });
  try {
    const previewResponse = await requestMcp(address, {
      authorization: "Bearer cli_test",
      body: {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "crm_line_broadcast_initiate",
          arguments: { broadcastId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        },
      },
    });
    assert.equal(previewResponse.status, 200);
    const previewBody = JSON.parse(await previewResponse.text()) as { result: { content: Array<{ text: string }> } };
    const preview = JSON.parse(previewBody.result.content[0]!.text) as { confirmationToken: string };
    assert.ok(preview.confirmationToken);

    const confirmedResponse = await requestMcp(address, {
      authorization: "Bearer cli_test",
      body: {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "crm_line_broadcast_initiate",
          arguments: { confirmation: true, confirmationToken: preview.confirmationToken },
        },
      },
    });
    assert.equal(confirmedResponse.status, 200);
    const confirmedBody = JSON.parse(await confirmedResponse.text()) as {
      result: { isError?: boolean; content: Array<{ text: string }> };
    };
    assert.equal(confirmedBody.result.isError, true);
    assert.match(confirmedBody.result.content[0]?.text ?? "", /QUOTA_EXCEEDED/);
  } finally {
    await app.close();
  }
}


// ── CM-173：分店帳號透過 MCP 只看得到、只操作得到自己渠道的資料 ──
const OTHER_CHANNEL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
/** 分店：只看得到 OTHER_CHANNEL；mock 裡的對話／案件都在另一個渠道 */
const branchAccess = (assertError?: AppError) => (): McpChannelAccess => ({
  accessible: async () => new Set([OTHER_CHANNEL]),
  assertConversation: async () => {
    throw assertError ?? new AppError("Conversation not found", "NOT_FOUND", 404);
  },
});

async function callTool(address: string, name: string, args: Record<string, unknown>) {
  const response = await requestMcp(address, {
    authorization: "Bearer cli_test",
    body: { jsonrpc: "2.0", id: 50, method: "tools/call", params: { name, arguments: args } },
  });
  assert.equal(response.status, 200);
  return JSON.parse(await response.text()) as {
    result: { isError?: boolean; content: Array<{ text: string }> };
  };
}

async function testBranchListToolsFilterByVisibleChannels() {
  const { app, address } = await createApp({
    scopes: [MCP_READ_SCOPE, MCP_LINE_READ_SCOPE],
    channelAccess: branchAccess(),
  });
  try {
    for (const key of Object.keys(recordedWhere)) recordedWhere[key] = [];
    await callTool(address, "crm_line_list_conversations", { page: 1, limit: 20 });
    await callTool(address, "crm_list_cases", { page: 1, limit: 20 });
    await callTool(address, "crm_search_contacts", { q: "Ada", page: 1, limit: 20 });
    await callTool(address, "crm_line_search_contacts", { q: "Ada", page: 1, limit: 20 });

    const channelIn = (where: unknown) => (where as { channelId?: { in: string[] } }).channelId;
    assert.deepEqual(channelIn(recordedWhere.conversation![0]), { in: [OTHER_CHANNEL] }, "對話列表要帶可見渠道過濾");
    assert.deepEqual(channelIn(recordedWhere.case![0]), { in: [OTHER_CHANNEL] }, "案件列表要帶可見渠道過濾");
    // 聯絡人的渠道身份只列可見渠道（過濾在 include.channelIdentities.where）
    assert.equal(recordedWhere.contact!.length, 2, "兩個聯絡人搜尋工具都有查詢");
    for (const where of recordedWhere.contact!) {
      assert.match(JSON.stringify(where), new RegExp(`"channelId":\\{"in":\\["${OTHER_CHANNEL}"\\]\\}`), "聯絡人的渠道身份要帶可見渠道過濾");
    }
  } finally {
    await app.close();
  }
}

async function testBranchCannotReadOtherChannelRecords() {
  const { app, address } = await createApp({
    scopes: [MCP_READ_SCOPE, MCP_LINE_READ_SCOPE],
    channelAccess: branchAccess(),
  });
  try {
    // 回應與「查無此對話／案件」完全相同，不洩漏他店資料是否存在
    const conv = await callTool(address, "crm_line_get_conversation", { id: "55555555-5555-4555-8555-555555555555" });
    assert.equal(conv.result.isError, true);
    assert.equal(conv.result.content[0]!.text, notFound("conversation"));

    const kase = await callTool(address, "crm_get_case", { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    assert.equal(kase.result.isError, true);
    assert.equal(kase.result.content[0]!.text, notFound("case"));
  } finally {
    await app.close();
  }
}

async function testUnrestrictedAgentStillReadsRecords() {
  const { app, address } = await createApp({ scopes: [MCP_READ_SCOPE, MCP_LINE_READ_SCOPE] });
  try {
    const conv = await callTool(address, "crm_line_get_conversation", { id: "55555555-5555-4555-8555-555555555555" });
    assert.notEqual(conv.result.isError, true);
    assert.match(conv.result.content[0]!.text, /LINE Contact/);
    const kase = await callTool(address, "crm_get_case", { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    assert.notEqual(kase.result.isError, true);
  } finally {
    await app.close();
  }
}

async function testAccessResolutionFailureIsSanitized() {
  const { app, address } = await createApp({
    scopes: [MCP_READ_SCOPE, MCP_LINE_READ_SCOPE],
    channelAccess: () => ({
      accessible: async () => { throw new Error("connect ECONNREFUSED 10.0.0.5:5432 password=secret"); },
      assertConversation: async () => { throw new Error("redis internal detail"); },
    }),
  });
  try {
    const list = await callTool(address, "crm_line_list_conversations", { page: 1, limit: 20 });
    assert.equal(list.result.isError, true);
    assert.doesNotMatch(list.result.content[0]!.text, /ECONNREFUSED|password|10\.0\.0\.5/, "不可把內部錯誤原文回給用戶端");
  } finally {
    await app.close();
  }
}

async function testBranchDirectSendChecksChannelLevel() {
  const scopes = [MCP_READ_SCOPE, MCP_LINE_SEND_SCOPE];
  const args = { conversationId: "55555555-5555-4555-8555-555555555555", contentType: "text", content: { text: "hello" } };

  // 預覽：唯讀渠道不可發
  const readOnly = await createApp({
    scopes,
    channelAccess: branchAccess(new AppError("level insufficient", "CHANNEL_ACCESS_LEVEL_INSUFFICIENT", 403)),
  });
  try {
    const preview = await callTool(readOnly.address, "crm_line_direct_send", args);
    assert.equal(preview.result.isError, true);
    assert.match(preview.result.content[0]!.text, /CHANNEL_ACCESS_LEVEL_INSUFFICIENT/);
    assert.doesNotMatch(preview.result.content[0]!.text, /confirmationToken/);
  } finally {
    await readOnly.app.close();
  }

  // 確認：預覽時有權限，確認前被收回 → 不送出
  const open = await createApp({ scopes });
  let token: string;
  try {
    const preview = await callTool(open.address, "crm_line_direct_send", args);
    token = (JSON.parse(preview.result.content[0]!.text) as { confirmationToken: string }).confirmationToken;
  } finally {
    await open.app.close();
  }
  const revoked = await createApp({ scopes, channelAccess: branchAccess() });
  try {
    const before = messagesCreated;
    const confirmed = await callTool(revoked.address, "crm_line_direct_send", { confirmation: true, confirmationToken: token });
    assert.equal(confirmed.result.isError, true);
    assert.equal(confirmed.result.content[0]!.text, notFound("conversation"));
    assert.equal(messagesCreated, before, "權限收回後不可送出訊息");
  } finally {
    await revoked.app.close();
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
await testConfirmedLineDirectSend();
await testRejectsLineDirectSendWithoutScope();
await testRejectsForeignLineConversation();
await testListsLineConversationsWithTenantScope();
await testConfirmedLineBroadcastRejectsQuota();
await testRejectsCliTokenWithoutMcpScope();
await testRejectsJwtWithoutMcpScope();
await testAllowsSameOriginInDevelopmentWithoutConfiguredOrigins();
await testBranchListToolsFilterByVisibleChannels();
await testBranchCannotReadOtherChannelRecords();
await testUnrestrictedAgentStillReadsRecords();
await testBranchDirectSendChecksChannelLevel();
await testAccessResolutionFailureIsSanitized();
console.log("mcp.routes.test.ts passed");
process.exit(0);
