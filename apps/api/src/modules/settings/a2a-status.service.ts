import type { EnvConfig } from '../../config/env.js';

export interface A2AStatus {
  enabled: boolean;
  transport: 'official-a2a-bridge';
  protocol: string;
  hubUrl: string;
  agentId: string | null;
  agentConfigured: boolean;
  connectionState: 'disabled' | 'not_reported';
  tenantBinding: 'Open333 CLI profile';
}

export function buildA2AStatus(config: Pick<EnvConfig, 'A2A_BRIDGE_ENABLED' | 'A2A_HUB_URL' | 'A2A_AGENT_ID'>): A2AStatus {
  const agentId = config.A2A_AGENT_ID;
  return {
    enabled: config.A2A_BRIDGE_ENABLED,
    transport: 'official-a2a-bridge',
    protocol: 'A2A HTTP+JSON 1.0 task/result correlation via bridge',
    hubUrl: config.A2A_HUB_URL,
    agentId: agentId ? `${agentId.slice(0, 6)}…${agentId.slice(-4)}` : null,
    agentConfigured: Boolean(agentId),
    connectionState: config.A2A_BRIDGE_ENABLED ? 'not_reported' : 'disabled',
    tenantBinding: 'Open333 CLI profile',
  };
}
