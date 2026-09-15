import assert from 'node:assert/strict';
import { buildA2AStatus, type A2AStatus } from '../modules/settings/a2a-status.service.js';

// Test 1: Full status construction with secrets sanitization
{
  const status: A2AStatus = buildA2AStatus({
    A2A_BRIDGE_ENABLED: true,
    A2A_HUB_URL: 'https://a2a.david888.com',
    A2A_AGENT_ID: 'agent-production-998877665544',
  });

  assert.equal(status.enabled, true);
  assert.equal(status.transport, 'official-a2a-bridge');
  assert.equal(status.agentConfigured, true);
  assert.equal(status.agentId, 'agent-…5544');
  assert.equal(status.connectionState, 'not_reported');
  assert.equal(status.tenantBinding, 'Open333 CLI profile');

  // Verify strict secrecy: no sensitive credentials leaked
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes('A2A_HUB_KEY'), false);
  assert.equal(serialized.includes('agentToken'), false);
  assert.equal(serialized.includes('998877'), false, 'Full agentId must be masked');
}

// Test 2: Disabled bridge status
{
  const status: A2AStatus = buildA2AStatus({
    A2A_BRIDGE_ENABLED: false,
    A2A_HUB_URL: 'https://a2a.david888.com',
    A2A_AGENT_ID: undefined,
  });

  assert.equal(status.enabled, false);
  assert.equal(status.agentConfigured, false);
  assert.equal(status.agentId, null);
  assert.equal(status.connectionState, 'disabled');
}

// Test 3: Safe protocol contract metadata
{
  const status = buildA2AStatus({
    A2A_BRIDGE_ENABLED: true,
    A2A_HUB_URL: 'https://a2a.custom-hub.net',
    A2A_AGENT_ID: 'agent-1234567890',
  });

  assert.match(status.protocol, /A2A HTTP\+JSON 1\.0/);
  assert.equal(status.hubUrl, 'https://a2a.custom-hub.net');
}

console.log('a2a bridge contract and security tests passed');
