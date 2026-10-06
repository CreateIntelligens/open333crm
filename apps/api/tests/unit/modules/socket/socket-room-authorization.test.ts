import assert from 'node:assert/strict';
import { authorizeSocketRoom } from '#src/modules/socket/socket-room-authorization.js';

import { test } from 'vitest';
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const agentA = '33333333-3333-4333-8333-333333333333';
const agentB = '44444444-4444-4444-8444-444444444444';
const teamA = '55555555-5555-4555-8555-555555555555';
const channelA = '66666666-6666-4666-8666-666666666666';
const conversationA = '77777777-7777-4777-8777-777777777777';
const conversationB = '88888888-8888-4888-8888-888888888888';

// 總店判定改由 channel.view_all 權限驅動（取代舊 ADMIN/SUPERVISOR 白名單）。
// 這裡的 mock 讓租戶無方案（planId: null），context 帶 roleId: null，
// 使 getEffectiveTenantPermissions 回空集合 → hasViewAll = false，
// 對應「一般 AGENT、非總店」的既有情境。
function createPrisma() {
  return {
    tenant: {
      findUnique: async () => ({ planId: null }),
    },
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
      // canAccessChannel 共用 resolveChannelAccessLevel（CM-173 review altitude），select 需
      // agentAccesses + teamAccesses。channelA 直綁給 agentA（fail-closed 後沒有綁定的渠道不可見，
      // change channel-visibility-fail-closed）。
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => (
        where.id === channelA && where.tenantId === tenantA
          ? { agentAccesses: [{ accessLevel: 'full' }], teamAccesses: [] }
          : null
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

const agentContext = { agentId: agentA, tenantId: tenantA, role: 'AGENT', roleId: null } as const;

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

async function testTeamScopedConversationDoesNotFallBackToChannelAccess() {
  const prisma = createPrisma();
  prisma.conversation.findFirst = async () => ({
    id: conversationA,
    teamId: teamA,
    assignedToId: null,
    channelId: channelA,
  });
  prisma.team.findFirst = async () => null;

  const result = await authorizeSocketRoom(prisma as never, agentContext, `conversation:${conversationA}`);

  assert.deepEqual(result, { ok: false, code: 'FORBIDDEN' });
}

test('rejects arbitrary room names', testRejectsArbitraryRoomNames);
test('rejects another tenant', testRejectsAnotherTenant);
test('rejects another agent private room', testRejectsAnotherAgentPrivateRoom);
test('allows authorized conversation', testAllowsAuthorizedConversation);
test('rejects conversation outside scope', testRejectsConversationOutsideScope);

// Unbound channel hidden from a member：沒有綁定任何團隊或成員的渠道，對話房間也不能訂閱
test('Unbound channel hidden from a member：沒有綁定的渠道不能訂閱對話房間', async () => {
  const prisma = createPrisma();
  prisma.channel.findFirst = async () => ({ agentAccesses: [], teamAccesses: [] });
  const result = await authorizeSocketRoom(prisma as never, agentContext, `conversation:${conversationA}`);
  assert.deepEqual(result, { ok: false, code: 'FORBIDDEN' });
});
test('team scoped conversation does not fall back to channel access', testTeamScopedConversationDoesNotFallBackToChannelAccess);
