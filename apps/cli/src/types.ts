export interface AgentIdentity {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarUrl: string | null;
  tenantId: string;
}

export interface CliLoginResponse {
  token: string;
  session: {
    id: string;
    name: string;
    tokenPrefix: string;
    tokenSuffix: string;
    scopes: string[];
    expiresAt: string;
    lastUsedAt: string | null;
  };
  agent: AgentIdentity;
}

export interface MeResponse extends AgentIdentity {
  isActive: boolean;
}

export interface CliEndpointParam {
  desc: string;
  value: unknown;
}

export interface CliEndpoint {
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  params: Record<string, CliEndpointParam>;
}

export interface CliApisResponse {
  token: {
    id: string;
    name: string;
    scopes: string[];
    expiresAt: string;
    lastUsedAt: string | null;
    tokenPrefix: string;
    tokenSuffix: string;
  };
  endpoints: Array<CliEndpoint & { scopes: string[] }>;
  capabilities: Array<{
    name: string;
    description: string;
    scopes: string[];
    routes: string[];
    endpoints: CliEndpoint[];
  }>;
}
