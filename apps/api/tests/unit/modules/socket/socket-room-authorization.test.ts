/**
 * 訂閱目標的格式與授權（主規格 socket-room-authorization）。
 * 授權結果如何決定加入或離開房間，見 socket-room-handlers.test.ts。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { authorizeSocketRoom } from '#src/modules/socket/socket-room-authorization.js';

// 成員的有效權限：預設沒有 channel.view_all，個別測試再加上
const effective = vi.hoisted(() => ({ codes: new Set<string>() }));
vi.mock('#src/services/permission.service.js', () => ({
  getEffectiveTenantPermissions: async () => effective.codes,
}));

afterEach(() => {
  effective.codes = new Set();
});
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const agentA = '33333333-3333-4333-8333-333333333333';
const agentB = '44444444-4444-4444-8444-444444444444';
const teamA = '55555555-5555-4555-8555-555555555555';
const channelA = '66666666-6666-4666-8666-666666666666';
const conversationA = '77777777-7777-4777-8777-777777777777';
const conversationB = '88888888-8888-4888-8888-888888888888';

// 總店判定由 channel.view_all 權限驅動（取代舊 ADMIN/SUPERVISOR 白名單）。
// getEffectiveTenantPermissions 已 mock，有沒有 channel.view_all 由 effective.codes 決定。
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

test('不認得的房間名稱：類型對但 ID 不是 UUID 時回 INVALID_TARGET', testRejectsArbitraryRoomNames);

test('不認得的房間名稱：不認得的類型、物件缺欄位時回 INVALID_TARGET', async () => {
  for (const input of [`room:${conversationA}`, { type: 'conversation' }, { type: 'secret', id: conversationA }, 42, null]) {
    assert.deepEqual(await authorizeSocketRoom(createPrisma() as never, agentContext, input), { ok: false, code: 'INVALID_TARGET' }, JSON.stringify(input));
  }
});

test('以物件格式訂閱：與字串格式得到相同的房間', async () => {
  const result = await authorizeSocketRoom(createPrisma() as never, agentContext, { type: 'conversation', id: conversationA });
  assert.deepEqual(result, { ok: true, room: `conversation:${conversationA}` });
});

test('訂閱自己的租戶房間', async () => {
  const result = await authorizeSocketRoom(createPrisma() as never, agentContext, `tenant:${tenantA}`);
  assert.deepEqual(result, { ok: true, room: `tenant:${tenantA}` });
});

test('訂閱其他租戶的房間', testRejectsAnotherTenant);
test('沒有 channel.view_all 時訂閱其他成員的房間', testRejectsAnotherAgentPrivateRoom);

test('有 channel.view_all 時訂閱其他成員的房間', async () => {
  effective.codes = new Set(['channel.view_all']);
  const result = await authorizeSocketRoom(createPrisma() as never, agentContext, `agent:${agentB}`);
  assert.deepEqual(result, { ok: true, room: `agent:${agentB}` });
});

test('訂閱不屬於自己的團隊', async () => {
  const prisma = createPrisma();
  // 團隊在同一租戶，但成員不屬於這個團隊：帶 members 條件的查詢查不到
  prisma.team.findFirst = async ({ where }: { where: { id: string; tenantId: string; members?: unknown } }) => (
    where.id === teamA && where.tenantId === tenantA && !where.members ? { id: teamA } : null
  );
  const result = await authorizeSocketRoom(prisma as never, agentContext, `team:${teamA}`);
  assert.deepEqual(result, { ok: false, code: 'FORBIDDEN' });
});

test('訂閱權限範圍內的對話', testAllowsAuthorizedConversation);

test('訂閱其他租戶或不存在的對話：兩種情況都回 FORBIDDEN', async () => {
  const prisma = createPrisma();
  // conversationB 屬於租戶 B。和資料庫一樣：查詢帶租戶 A 時查不到，沒有租戶條件時查得到
  prisma.conversation.findFirst = async ({ where }: { where: { id: string; tenantId?: string } }) => (
    where.id === conversationB && (where.tenantId ?? tenantB) === tenantB
      ? { id: conversationB, teamId: null, assignedToId: null, channelId: channelA }
      : null
  );
  const otherTenant = await authorizeSocketRoom(prisma as never, agentContext, `conversation:${conversationB}`);
  const missing = await authorizeSocketRoom(prisma as never, agentContext, 'conversation:99999999-9999-4999-8999-999999999999');
  assert.deepEqual(otherTenant, { ok: false, code: 'FORBIDDEN' });
  assert.deepEqual(missing, otherTenant, '不存在與沒有權限得到相同的回應');
});

test('對話的渠道看不到：渠道沒有綁定任何團隊或成員', async () => {
  const prisma = createPrisma();
  prisma.channel.findFirst = async () => ({ agentAccesses: [], teamAccesses: [] });
  const result = await authorizeSocketRoom(prisma as never, agentContext, `conversation:${conversationA}`);
  assert.deepEqual(result, { ok: false, code: 'FORBIDDEN' });
});

test('團隊對話不因渠道看得到而放行', testTeamScopedConversationDoesNotFallBackToChannelAccess);
