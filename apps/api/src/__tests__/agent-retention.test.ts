import assert from 'node:assert/strict';
import { addRetentionExpiry, cleanupExpiredAgentData, AGENT_RETENTION_DAYS } from '../modules/ai/agent/retention.js';

const created = new Date('2026-08-28T00:00:00.000Z');
assert.equal(AGENT_RETENTION_DAYS, 3);
assert.equal(addRetentionExpiry(created).toISOString(), '2026-08-31T00:00:00.000Z');

const calls: string[] = [];
const store = {
  agentRun: { updateMany: async (args: unknown) => { calls.push(`run:${JSON.stringify(args)}`); return { count: 2 }; } },
  agentToolCall: { updateMany: async (args: unknown) => { calls.push(`tool:${JSON.stringify(args)}`); return { count: 4 }; } },
  agentReportDraft: { updateMany: async (args: unknown) => { calls.push(`draft:${JSON.stringify(args)}`); return { count: 1 }; } },
};
const result = await cleanupExpiredAgentData(store, new Date('2026-09-01T00:00:00.000Z'));
assert.deepEqual(result, { runs: 2, toolCalls: 4, drafts: 1 });
assert.equal(calls.length, 3);
assert.match(calls[0], /EXPIRED/);
assert.match(calls[1], /"status":\{"not":"EXPIRED"\}/);
assert.match(calls[1], /"result":null/);
assert.match(calls[2], /"markdown":null/);

console.log('agent-retention tests passed');
