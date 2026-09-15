import type { EnvConfig } from '../../config/env.js';

let liveConnectionState: 'connected' | 'disabled' | 'not_reported' = 'not_reported';

export function setA2ABridgeLiveState(state: 'connected' | 'disabled' | 'not_reported'): void {
  liveConnectionState = state;
}

export function getA2ABridgeLiveState(): 'connected' | 'disabled' | 'not_reported' {
  return liveConnectionState;
}

export interface A2AStatus {
  enabled: boolean;
  transport: 'official-a2a-bridge';
  protocol: string;
  hubUrl: string;
  agentId: string | null;
  agentConfigured: boolean;
  connectionState: 'connected' | 'disabled' | 'not_reported';
  tenantBinding: string;
}

export function buildA2AStatus(config: Pick<EnvConfig, 'A2A_BRIDGE_ENABLED' | 'A2A_HUB_URL' | 'A2A_AGENT_ID'>): A2AStatus {
  const agentId = config.A2A_AGENT_ID;
  const isEnabled = config.A2A_BRIDGE_ENABLED;

  const connectionState = !isEnabled
    ? 'disabled'
    : (liveConnectionState === 'connected' || Boolean(agentId))
      ? 'connected'
      : 'not_reported';

  return {
    enabled: isEnabled,
    transport: 'official-a2a-bridge',
    protocol: 'A2A HTTP+JSON 1.0 task/result correlation via bridge',
    hubUrl: config.A2A_HUB_URL,
    agentId: agentId ? `${agentId.slice(0, 6)}…${agentId.slice(-4)}` : null,
    agentConfigured: Boolean(agentId),
    connectionState,
    tenantBinding: 'Open333 CLI profile / Default Tenant',
  };
}
