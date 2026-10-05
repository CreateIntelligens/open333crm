/**
 * 自動派案只派給看得到工單渠道的成員（change channel-visibility-fail-closed，code review）。
 * 渠道可見範圍改成 fail-closed 後，沒有綁定該渠道的成員看不到工單；派給他，工單會從他的
 * 收件匣消失、打開回 404，卻還算在他的工作量裡。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { getNextAgent } from '#src/modules/case/assignment.service.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type Agent = { id: string; name: string; direct: Record<string, string>; teamLevels: Record<string, string>; open: number };

/** mock 依被測程式送來的 where.OR 實際過濾：直綁或所屬團隊被授權該渠道，且層級在允許清單內 */
function mockPrisma(agents: Agent[]) {
  return {
    agent: {
      findMany: async ({ where }: { where: any }) => {
        const clauses: any[] = where.OR ?? [];
        return agents
          .filter((a) => {
            if (clauses.length === 0) return true;
            return clauses.some((c) => {
              const direct = c.channelAccesses?.some;
              if (direct) return direct.accessLevel.in.includes(a.direct[direct.channelId]);
              const team = c.teams?.some?.team?.channelAccesses?.some;
              if (team) return team.accessLevel.in.includes(a.teamLevels[team.channelId]);
              return false;
            });
          })
          .map((a) => ({ id: a.id, name: a.name, _count: { assignedCases: a.open } }));
      },
    },
  };
}

test('Assignment skips members who cannot see the channel：只派給直綁或團隊授權、而且能回覆的成員', async () => {
  const prisma = mockPrisma([
    { id: 'unbound', name: '沒綁定', direct: {}, teamLevels: {}, open: 0 },
    { id: 'readonly', name: '只能看', direct: { [CH]: 'read_only' }, teamLevels: {}, open: 0 },
    { id: 'team', name: '團隊授權', direct: {}, teamLevels: { [CH]: 'reply_only' }, open: 3 },
    { id: 'direct', name: '直綁', direct: { [CH]: 'full' }, teamLevels: {}, open: 2 },
  ]);
  const picked = await getNextAgent(prisma as never, TENANT, null, CH);
  assert.equal(picked?.id, 'direct', '工作量最少、而且看得到並能回覆的成員');
});

test('Nobody can see the channel：不派案', async () => {
  const prisma = mockPrisma([{ id: 'unbound', name: '沒綁定', direct: {}, teamLevels: {}, open: 0 }]);
  assert.equal(await getNextAgent(prisma as never, TENANT, null, CH), null);
});
