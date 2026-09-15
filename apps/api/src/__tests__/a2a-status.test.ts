import assert from 'node:assert/strict';
import { buildA2AStatus } from '../modules/settings/a2a-status.service.js';

{
  const status = buildA2AStatus({
    A2A_BRIDGE_ENABLED: true,
    A2A_HUB_URL: 'https://a2a.david888.com',
    A2A_AGENT_ID: 'agent-1234567890',
  });
  assert.equal(status.enabled, true);
  assert.equal(status.agentId, 'agent-…7890');
  assert.equal(status.connectionState, 'connected');
  assert.equal('agentToken' in status, false);
  assert.equal('hubKey' in status, false);
}

{
  const status = buildA2AStatus({
    A2A_BRIDGE_ENABLED: false,
    A2A_HUB_URL: 'https://a2a.david888.com',
    A2A_AGENT_ID: undefined,
  });
  assert.equal(status.connectionState, 'disabled');
  assert.equal(status.agentId, null);
  assert.equal(status.agentConfigured, false);
}

console.log('a2a status tests passed');
