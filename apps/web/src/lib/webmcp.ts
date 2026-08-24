export interface WebMcpApiClient {
  get(
    url: string,
    config?: { params?: Record<string, string | number> },
  ): Promise<{ data: unknown }>;
}

export interface WebMcpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: true;
    untrustedContentHint?: true;
  };
  execute(input: unknown): Promise<unknown>;
}

export interface WebMcpModelContext {
  registerTool(
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

interface ToolOptions {
  signal?: AbortSignal;
  onRegistrationError?: (toolName: string, error: unknown) => void;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function inputObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function optionalString(
  input: Record<string, unknown>,
  key: string,
  maxLength = 120,
): string | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }

  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${key} must be ${maxLength} characters or fewer`);
  }
  return normalized || undefined;
}

function requiredString(
  input: Record<string, unknown>,
  key: string,
  maxLength = 120,
): string {
  const value = optionalString(input, key, maxLength);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function pageValue(input: Record<string, unknown>): number {
  const value = input.page ?? DEFAULT_PAGE;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("page must be a positive integer");
  }
  return value;
}

function limitValue(input: Record<string, unknown>): number {
  const value = input.limit ?? DEFAULT_LIMIT;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_LIMIT
  ) {
    throw new Error(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return value;
}

function pagination(input: Record<string, unknown>) {
  return {
    page: pageValue(input),
    limit: limitValue(input),
  };
}

function queryWithDefinedValues(
  values: Record<string, string | number | undefined>,
): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Record<string, string | number>;
}

function createTools(api: WebMcpApiClient): WebMcpTool[] {
  return [
    {
      name: "crm_search_contacts",
      title: "Search CRM contacts",
      description:
        "Search contacts in the current CRM tenant by name, phone, or email.",
      inputSchema: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description: "Name, phone number, or email to search for.",
          },
          page: { type: "integer", minimum: 1, default: DEFAULT_PAGE },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: MAX_LIMIT,
            default: DEFAULT_LIMIT,
          },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (rawInput) => {
        const input = inputObject(rawInput);
        const { page, limit } = pagination(input);
        const q = optionalString(input, "q");
        const response = await api.get("/contacts", {
          params: queryWithDefinedValues({ q, page, limit }),
        });
        return response.data;
      },
    },
    {
      name: "crm_list_cases",
      title: "List CRM cases",
      description:
        "List cases in the current CRM tenant with status, priority, assignee, category, or SLA filters.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", description: "Case status filter." },
          priority: { type: "string", description: "Case priority filter." },
          assigneeId: { type: "string", description: "Assignee UUID filter." },
          category: { type: "string", description: "Case category filter." },
          slaStatus: {
            type: "string",
            enum: ["normal", "warning", "breached"],
            description: "SLA state filter.",
          },
          page: { type: "integer", minimum: 1, default: DEFAULT_PAGE },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: MAX_LIMIT,
            default: DEFAULT_LIMIT,
          },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (rawInput) => {
        const input = inputObject(rawInput);
        const { page, limit } = pagination(input);
        const response = await api.get("/cases", {
          params: queryWithDefinedValues({
            status: optionalString(input, "status", 40),
            priority: optionalString(input, "priority", 40),
            assigneeId: optionalString(input, "assigneeId", 80),
            category: optionalString(input, "category"),
            slaStatus: optionalString(input, "slaStatus", 20),
            page,
            limit,
          }),
        });
        return response.data;
      },
    },
    {
      name: "crm_get_case",
      title: "Get CRM case",
      description:
        "Get one case from the current CRM tenant, including its contact, assignee, team, and tags.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "CRM case ID" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (rawInput) => {
        const id = requiredString(inputObject(rawInput), "id", 80);
        const response = await api.get(`/cases/${encodeURIComponent(id)}`);
        return response.data;
      },
    },
    {
      name: "crm_get_contact",
      title: "Get CRM contact",
      description:
        "Get one contact from the current CRM tenant, including channel identities and tags.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "CRM contact ID" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (rawInput) => {
        const id = requiredString(inputObject(rawInput), "id", 80);
        const response = await api.get(`/contacts/${encodeURIComponent(id)}`);
        return response.data;
      },
    },
    {
      name: "crm_get_analytics_overview",
      title: "Get CRM analytics overview",
      description:
        "Get tenant-scoped message, case, SLA, and CSAT metrics for an optional date range.",
      inputSchema: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description: "Inclusive ISO timestamp; defaults to 30 days ago.",
          },
          to: {
            type: "string",
            description: "Inclusive ISO timestamp; defaults to now.",
          },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (rawInput) => {
        const input = inputObject(rawInput);
        const response = await api.get("/analytics/overview", {
          params: queryWithDefinedValues({
            from: optionalString(input, "from", 40),
            to: optionalString(input, "to", 40),
          }),
        });
        return response.data;
      },
    },
    {
      name: "crm_get_current_agent",
      title: "Get current CRM agent",
      description:
        "Get the authenticated CRM agent identity and tenant-scoped role.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        const response = await api.get("/auth/me");
        return response.data;
      },
    },
  ];
}

export async function registerCrmWebMcpTools(
  modelContext: WebMcpModelContext,
  api: WebMcpApiClient,
  options: ToolOptions = {},
): Promise<void> {
  const onRegistrationError =
    options.onRegistrationError ??
    ((toolName: string, error: unknown) => {
      console.error(`[WebMCP] Failed to register tool: ${toolName}`, error);
    });

  for (const tool of createTools(api)) {
    if (options.signal?.aborted) return;

    try {
      await modelContext.registerTool(tool, options);
    } catch (error) {
      if (options.signal?.aborted) return;
      onRegistrationError(tool.name, error);
    }
  }
}
