export type CliEndpointMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface CliEndpointParam {
  desc: string;
  value: unknown;
}

export interface CliEndpoint {
  name: string;
  description: string;
  method: CliEndpointMethod;
  path: string;
  params: Record<string, CliEndpointParam>;
}

export interface CliCapability {
  name: string;
  description: string;
  scopes: string[];
  endpoints: CliEndpoint[];
}

export interface CliEndpointWithScopes extends CliEndpoint {
  scopes: string[];
}

export const cliCapabilities: CliCapability[] = [
  {
    name: 'identity',
    description: 'Server health and current CLI identity',
    scopes: ['cli:status'],
    endpoints: [
      {
        name: 'Health',
        description: 'Check whether the Open333 API is reachable',
        method: 'GET',
        path: '/health',
        params: {},
      },
      {
        name: 'Current Agent',
        description: 'Get the authenticated agent identity for the current CLI token',
        method: 'GET',
        path: '/api/v1/auth/me',
        params: {},
      },
    ],
  },
  {
    name: 'api-discovery',
    description: 'CLI API discovery metadata',
    scopes: ['cli:apis'],
    endpoints: [
      {
        name: 'List CLI APIs',
        description: 'List endpoints and capability scopes available to the current CLI token',
        method: 'GET',
        path: '/api/v1/cli/apis',
        params: {},
      },
    ],
  },
];

function hasAllScopes(tokenScopes: string[], requiredScopes: string[]): boolean {
  return requiredScopes.every((scope) => tokenScopes.includes(scope));
}

export function visibleCliCapabilities(tokenScopes: string[]): CliCapability[] {
  return cliCapabilities.filter((capability) => hasAllScopes(tokenScopes, capability.scopes));
}

export function flattenCliEndpoints(capabilities: CliCapability[]): CliEndpointWithScopes[] {
  return capabilities.flatMap((capability) =>
    capability.endpoints.map((endpoint) => ({
      ...endpoint,
      scopes: capability.scopes,
    })),
  );
}

export function cliRoutesFromEndpoints(endpoints: CliEndpoint[]): string[] {
  return endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`);
}
