import assert from 'node:assert/strict';
import { authorizeSocketRoom } from '../modules/socket/socket-room-authorization.js';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const agentA = '33333333-3333-4333-8333-333333333333';
const agentB = '44444444-4444-4444-8444-444444444444';
const teamA = '55555555-5555-4555-8555-555555555555';
const channelA = '66666666-6666-4666-8666-666666666666';
const conversationA = '77777777-7777-4777-8777-777777777777';
const conversationB = '88888888-8888-4888-8888-888888888888';

function createPrisma() {
  return {
    agent: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => (
        where.id === agentB && where.tenantId === tenantA ? { id: agentB } : null
      ),
    },
    team: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => (
        where.id === teamA && where.tenantId === tenantA ? { id: teamA } : null
      ),
    },
    channel: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => (
        where.id === channelA && where.tenantId === tenantA ? { id: channelA } : null
      ),
    },
    conversation: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => (
        where.id === conversationA && where.tenantId === tenantA
          ? { id: conversationA, teamId: null, assignedToId: null, channelId: channelA }
          : null
      ),
    },
  };
}

const agentContext = { agentId: agentA, tenantId: tenantA, role: 'AGENT' } as const;

async function testRejectsArbitraryRoomNames() {
  const result = await authorizeSocketRoom(createPrisma() as never, agentContext, 'tenant:arbitrary-room');

  assert.deepEqual(result, { ok: false, code: 'INVALID_TARGET' });
}

async function testRejectsAnotherTenant() {
  const result = await authorizeSocketRoom(createPrisma() as never, agentContext, `tenant:${tenantB}`);

  assert.deepEqual(result, { ok: false, code: 'FORBIDDEN' });
}

async function testRejectsAnotherAgentPrivateRoom() {
  const result = await authorizeSocketRoom(createPrisma() as never, agentContext, `agent:${agentB}`);

  assert.deepEqual(result, { ok: false, code: 'FORBIDDEN' });
}

async function testAllowsAuthorizedConversation() {
  const result = await authorizeSocketRoom(createPrisma() as never, agentContext, `conversation:${conversationA}`);

  assert.deepEqual(result, { ok: true, room: `conversation:${conversationA}` });
}

async function testRejectsConversationOutsideScope() {
  const result = await authorizeSocketRoom(createPrisma() as never, agentContext, `conversation:${conversationB}`);

  assert.deepEqual(result, { ok: false, code: 'FORBIDDEN' });
}

await testRejectsArbitraryRoomNames();
await testRejectsAnotherTenant();
await testRejectsAnotherAgentPrivateRoom();
await testAllowsAuthorizedConversation();
await testRejectsConversationOutsideScope();

console.log('socket room authorization tests passed');
