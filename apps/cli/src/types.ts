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

export interface CliAnalyticsOverview {
  totalMessages: number;
  inboundMessages: number;
  outboundMessages: number;
  openCases: number;
  newCases: number;
  resolvedCases: number;
  slaAchievementRate: number | null;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  csatAvg: number | null;
  csatPositiveRate: number | null;
}

export interface CliMessageTrendPoint {
  date: string;
  total: number;
  [channel: string]: string | number;
}

export interface CliDistributionPoint {
  name: string;
  value: number;
}

export interface CliCaseStats {
  trend: Array<{ date: string; opened: number; closed: number }>;
  categoryDistribution: CliDistributionPoint[];
  priorityDistribution: CliDistributionPoint[];
  statusDistribution: CliDistributionPoint[];
  escalationRate: number;
  slaViolationCount: number;
}

export interface CliChannelAnalytics {
  messagesByChannel: CliDistributionPoint[];
  conversationsByChannel: CliDistributionPoint[];
  botVsHuman: CliDistributionPoint[];
  newContactsByChannel: CliDistributionPoint[];
}

export interface CliAgentPerformance {
  agentId: string;
  name: string;
  role: string;
  casesHandled: number;
  casesResolved: number;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  csatAvg: number | null;
  slaAchievementRate: number | null;
  pendingCases: number;
  slaSoonExpiring: number;
}

export interface CliStatsResponse {
  overview: CliAnalyticsOverview;
  messageTrend: CliMessageTrendPoint[];
  cases: CliCaseStats;
  channels: CliChannelAnalytics;
  my: CliAgentPerformance;
}
