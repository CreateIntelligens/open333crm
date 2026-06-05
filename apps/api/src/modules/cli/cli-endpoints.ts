import {
  CLI_ANALYTICS_READ_SCOPE,
  CLI_APIS_SCOPE,
  CLI_STATUS_SCOPE,
} from '../auth/cli-session.service.js';

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
    scopes: [CLI_STATUS_SCOPE],
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
    scopes: [CLI_APIS_SCOPE],
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
  {
    name: 'statistics',
    description: 'Read-only CRM analytics for CLI workflows',
    scopes: [CLI_ANALYTICS_READ_SCOPE],
    endpoints: [
      {
        name: 'Overview Statistics',
        description: 'Get aggregate CRM message, case, SLA, and CSAT metrics',
        method: 'GET',
        path: '/api/v1/cli/analytics/overview',
        params: {
          from: { desc: 'Start date or timestamp for the reporting window', value: '2026-06-01' },
          to: { desc: 'End date or timestamp for the reporting window', value: '2026-06-30' },
        },
      },
      {
        name: 'Message Trend',
        description: 'Get grouped message counts by channel type',
        method: 'GET',
        path: '/api/v1/cli/analytics/message-trend',
        params: {
          from: { desc: 'Start date or timestamp for the reporting window', value: '2026-06-01' },
          to: { desc: 'End date or timestamp for the reporting window', value: '2026-06-30' },
          groupBy: { desc: 'Grouping granularity: day, week, or month', value: 'day' },
        },
      },
      {
        name: 'Case Statistics',
        description: 'Get aggregate case trend, distribution, and SLA violation counts',
        method: 'GET',
        path: '/api/v1/cli/analytics/cases',
        params: {
          from: { desc: 'Start date or timestamp for the reporting window', value: '2026-06-01' },
          to: { desc: 'End date or timestamp for the reporting window', value: '2026-06-30' },
        },
      },
      {
        name: 'Channel Analytics',
        description: 'Get aggregate channel message, conversation, and contact counts',
        method: 'GET',
        path: '/api/v1/cli/analytics/channels',
        params: {
          from: { desc: 'Start date or timestamp for the reporting window', value: '2026-06-01' },
          to: { desc: 'End date or timestamp for the reporting window', value: '2026-06-30' },
        },
      },
      {
        name: 'My Performance',
        description: 'Get current CLI agent performance metrics',
        method: 'GET',
        path: '/api/v1/cli/analytics/my',
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
