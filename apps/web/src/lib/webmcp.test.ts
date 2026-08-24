import assert from "node:assert/strict";
import test from "node:test";

import {
  registerCrmWebMcpTools,
  type WebMcpApiClient,
  type WebMcpModelContext,
} from "./webmcp.js";

test("registers the six read-only CRM WebMCP tools", async () => {
  const registered: Array<Record<string, unknown>> = [];
  const modelContext: WebMcpModelContext = {
    async registerTool(tool) {
      registered.push(tool as unknown as Record<string, unknown>);
    },
  };

  const api: WebMcpApiClient = {
    async get() {
      return { data: { data: [] } };
    },
  };

  await registerCrmWebMcpTools(modelContext, api);

  assert.deepEqual(
    registered.map((tool) => tool.name),
    [
      "crm_search_contacts",
      "crm_list_cases",
      "crm_get_case",
      "crm_get_contact",
      "crm_get_analytics_overview",
      "crm_get_current_agent",
    ],
  );
  assert.equal(registered.length, 6);
  for (const tool of registered) {
    assert.equal(
      (tool.annotations as { readOnlyHint: boolean }).readOnlyHint,
      true,
    );
  }
  assert.equal(
    (
      registered.find((tool) => tool.name === "crm_get_current_agent")
        ?.annotations as { untrustedContentHint?: boolean }
    ).untrustedContentHint,
    undefined,
  );
});

test("searches contacts through the authenticated frontend API client", async () => {
  const registered: Array<Record<string, unknown>> = [];
  const modelContext: WebMcpModelContext = {
    async registerTool(tool) {
      registered.push(tool as unknown as Record<string, unknown>);
    },
  };
  const calls: Array<{ url: string; config?: unknown }> = [];
  const api: WebMcpApiClient = {
    async get(url, config) {
      calls.push(config === undefined ? { url } : { url, config });
      return { data: { data: [{ id: "contact-1" }] } };
    },
  };

  await registerCrmWebMcpTools(modelContext, api);
  const searchTool = registered.find(
    (tool) => tool.name === "crm_search_contacts",
  );
  assert.ok(searchTool);

  const result = await (
    searchTool.execute as (input: unknown) => Promise<unknown>
  )({ q: "  王小明  ", page: 2, limit: 10 });

  assert.deepEqual(calls, [
    {
      url: "/contacts",
      config: { params: { q: "王小明", page: 2, limit: 10 } },
    },
  ]);
  assert.deepEqual(result, { data: [{ id: "contact-1" }] });
});

test("uses the current CRM API endpoints without accepting a token as tool input", async () => {
  const registered: Array<Record<string, unknown>> = [];
  const modelContext: WebMcpModelContext = {
    async registerTool(tool) {
      registered.push(tool as unknown as Record<string, unknown>);
    },
  };
  const calls: Array<{ url: string; config?: unknown }> = [];
  const api: WebMcpApiClient = {
    async get(url, config) {
      calls.push(config === undefined ? { url } : { url, config });
      return { data: { data: { id: "case-1" } } };
    },
  };

  await registerCrmWebMcpTools(modelContext, api);
  const getCaseTool = registered.find((tool) => tool.name === "crm_get_case");
  assert.ok(getCaseTool);
  const inputSchema = getCaseTool.inputSchema as Record<string, unknown>;

  await (getCaseTool.execute as (input: unknown) => Promise<unknown>)({
    id: "case-1",
    jwt: "must-not-be-used",
  });

  assert.deepEqual(inputSchema.properties, {
    id: { type: "string", description: "CRM case ID" },
  });
  assert.deepEqual(calls, [{ url: "/cases/case-1" }]);
});
