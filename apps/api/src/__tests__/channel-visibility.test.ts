/**
 * 渠道級可見性（CM-173 / channel-scoped-visibility）核心解析器單元測試。
 *
 * 目標：驗證 getAccessibleChannelIds 的「分店/總店/legacy/fail-closed」語意，
 * 以及 channelIdWhereFilter 把可見集合轉成 Prisma where 條件的三種結果。
 *
 * 走純函式路線（mock prisma.channel.findMany），不依賴真實 DB。
 * mock 會依照被測程式送進來的 where（OR: legacy none / team members some）
 * 對 fixture 渠道逐一比對，確保測到的是真正的過濾語意，而非硬回一組清單。
 */
import assert from 'node:assert/strict';
import {
  getAccessibleChannelIds,
  channelIdWhereFilter,
  isChannelAccessible,
  ALL_CHANNELS,
} from '../services/channel-visibility.js';

// 固定 UUID（僅 [0-9a-f]，比照既有測試風格）
const tenantId = '11111111-1111-4111-8111-111111111111';
const agentSolo = '22222222-2222-4222-8222-222222222222'; // 只屬 teamA
const agentMulti = '33333333-3333-4333-8333-333333333333'; // 屬 teamA + teamB
const agentNone = '44444444-4444-4444-8444-444444444444'; // 不屬任何 team
const teamA = '55555555-5555-4555-8555-555555555555';
const teamB = '66666666-6666-4666-8666-666666666666';
const CH_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // 授權給 teamA
const CH_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // 授權給 teamB
const CH_LEGACY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // 無任何 teamAccesses

/**
 * fixture 渠道與其團隊授權/團隊成員關係。
 * agentTeams：某 agent 屬於哪些 team（模擬 AgentTeamMember）。
 * channelTeams：某 channel 被授權給哪些 team（模擬 ChannelTeamAccess）。空陣列＝legacy。
 */
const agentTeams: Record<string, string[]> = {
  [agentSolo]: [teamA],
  [agentMulti]: [teamA, teamB],
  [agentNone]: [],
};
const channelTeams: Record<string, string[]> = {
  [CH_A]: [teamA],
  [CH_B]: [teamB],
  [CH_LEGACY]: [],
};

/**
 * 建立 mock prisma。channel.findMany 會解析被測程式送進來的 where.OR：
 *   - { teamAccesses: { none: {} } } → legacy 渠道（channelTeams 為空）
 *   - { teamAccesses: { some: { team: { members: { some: { agentId } } } } } }
 *     → 該渠道有授權團隊，且 agent 屬於其中之一
 * 讓測試實際跑過 OR 過濾語意，而非硬回固定清單。
 */
function createPrisma() {
  return {
    channel: {
      findMany: async ({ where }: { where: any }): Promise<{ id: string }[]> => {
        assert.equal(where.tenantId, tenantId, 'findMany 必須帶當前 tenantId');
        const orClauses: any[] = where.OR ?? [];

        // 從 some 子句抽出被測程式要比對的 agentId
        let queriedAgentId: string | undefined;
        for (const clause of orClauses) {
          const agentIdCond =
            clause?.teamAccesses?.some?.team?.members?.some?.agentId;
          if (typeof agentIdCond === 'string') queriedAgentId = agentIdCond;
        }
        const allowLegacy = orClauses.some(
          (c) => c?.teamAccesses?.none !== undefined,
        );

        const matched = Object.entries(channelTeams).filter(([, teams]) => {
          if (teams.length === 0) return allowLegacy; // legacy 渠道
          if (!queriedAgentId) return false;
          const myTeams = agentTeams[queriedAgentId] ?? [];
          return teams.some((t) => myTeams.includes(t));
        });
        return matched.map(([id]) => ({ id }));
      },
    },
  };
}

function asSet(v: unknown): Set<string> {
  assert.ok(v instanceof Set, '預期回傳 Set<string>（非總店）');
  return v as Set<string>;
}

// 案例 1：分店 agent（屬 teamA，teamA 授權 CH-A）→ 只回 {CH-A}（含 legacy）
async function testBranchAgentSeesOwnChannel() {
  const accessible = await getAccessibleChannelIds(createPrisma() as never, {
    tenantId,
    agentId: agentSolo,
    hasViewAll: false,
  });
  const set = asSet(accessible);
  assert.ok(set.has(CH_A), '應看得到自己團隊的 CH-A');
  assert.ok(set.has(CH_LEGACY), '應看得到 legacy 渠道');
  assert.ok(!set.has(CH_B), '不應看到別團隊的 CH-B');
}

// 案例 2：屬多 team（teamA + teamB）→ 取聯集（CH-A ∪ CH-B ∪ legacy）
async function testMultiTeamUnion() {
  const accessible = await getAccessibleChannelIds(createPrisma() as never, {
    tenantId,
    agentId: agentMulti,
    hasViewAll: false,
  });
  const set = asSet(accessible);
  assert.ok(set.has(CH_A), '多團隊應含 teamA 的 CH-A');
  assert.ok(set.has(CH_B), '多團隊應含 teamB 的 CH-B');
  assert.ok(set.has(CH_LEGACY), '多團隊仍應含 legacy 渠道');
}

// 案例 3：hasViewAll=true（總店）→ 回哨兵 ALL_CHANNELS，且完全不查 DB
async function testViewAllReturnsSentinel() {
  let queried = false;
  const prisma = {
    channel: {
      findMany: async () => {
        queried = true;
        return [];
      },
    },
  };
  const accessible = await getAccessibleChannelIds(prisma as never, {
    tenantId,
    agentId: agentSolo,
    hasViewAll: true,
  });
  assert.equal(accessible, ALL_CHANNELS, '總店應回 ALL_CHANNELS 哨兵');
  assert.equal(queried, false, '總店應短路、不查渠道表');
}

// 案例 4：legacy 渠道（無 teamAccesses）→ 對所有 agent 可見（含不屬任何 team 者）
async function testLegacyChannelVisibleToAll() {
  const accessible = await getAccessibleChannelIds(createPrisma() as never, {
    tenantId,
    agentId: agentNone,
    hasViewAll: false,
  });
  const set = asSet(accessible);
  assert.ok(set.has(CH_LEGACY), 'legacy 渠道對不屬任何團隊的 agent 也可見');
}

// 案例 5：無授權且非總店（不屬任何 team、且無 legacy 情境）→ 空 Set（fail-closed）
async function testFailClosedEmptySet() {
  // 這裡把 fixture 收斂成「全部渠道都已指派團隊、agent 不屬任何團隊」
  const prisma = {
    channel: {
      findMany: async ({ where }: { where: any }): Promise<{ id: string }[]> => {
        const orClauses: any[] = where.OR ?? [];
        let queriedAgentId: string | undefined;
        for (const clause of orClauses) {
          const c = clause?.teamAccesses?.some?.team?.members?.some?.agentId;
          if (typeof c === 'string') queriedAgentId = c;
        }
        // 所有渠道皆已指派團隊（無 legacy），且此 agent 不屬任何團隊 → 無命中
        void queriedAgentId;
        return [];
      },
    },
  };
  const accessible = await getAccessibleChannelIds(prisma as never, {
    tenantId,
    agentId: agentNone,
    hasViewAll: false,
  });
  const set = asSet(accessible);
  assert.equal(set.size, 0, 'fail-closed：非總店且無可見渠道 → 空集合');
  assert.equal(
    isChannelAccessible(set, CH_A),
    false,
    '空集合下任何 channelId 皆不可見',
  );
}

// 案例 6：channelIdWhereFilter 三種輸入
function testChannelIdWhereFilter() {
  // ALL → undefined（不加渠道條件）
  assert.equal(
    channelIdWhereFilter(ALL_CHANNELS),
    undefined,
    'ALL_CHANNELS 應回 undefined',
  );

  // 非空 Set → { in: [...] }（順序無關，比對集合）
  const some = channelIdWhereFilter(new Set([CH_A, CH_B]));
  assert.ok(some && Array.isArray(some.in), '應回 { in: [...] }');
  assert.deepEqual(
    new Set(some!.in),
    new Set([CH_A, CH_B]),
    'in 陣列應等於可見集合',
  );

  // 空 Set → { in: [] }（產生查無資料，即 fail-closed）
  const empty = channelIdWhereFilter(new Set<string>());
  assert.deepEqual(empty, { in: [] }, '空集合應回 { in: [] }');
}

await testBranchAgentSeesOwnChannel();
await testMultiTeamUnion();
await testViewAllReturnsSentinel();
await testLegacyChannelVisibleToAll();
await testFailClosedEmptySet();
testChannelIdWhereFilter();

console.log('channel visibility tests passed');
