/**
 * agent 的 flow（change migrate-role-agent-tenant-ctx，design 決策 4、7）：
 * - bcrypt 在開啟交易之前執行，不佔住交易與連線。
 * - 寫入與稽核在同一個交易：稽核在 commit 之前寫入。
 * - 不可停用或刪除自己：在開啟交易之前擋下。
 *
 * service 以 mock 取代，這裡只檢查 flow 的編排順序；service 的規則由各自的測試負責。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import type { RequestActor } from '#src/lib/request-actor.js';

const log: string[] = [];

vi.mock('#src/shared/utils/password.js', () => ({
  hashPassword: async (plain: string) => {
    log.push(`hash:${plain}`);
    return `hashed:${plain}`;
  },
}));
vi.mock('#src/modules/agent/agent.service.js', () => ({
  createAgent: async (_ctx: unknown, _data: unknown, _roleId: unknown, opts: { passwordHash: string }) => {
    log.push(`createAgent:${opts.passwordHash}`);
    return { id: 'new-agent', role: 'AGENT' };
  },
  resetAgentPassword: async (_ctx: unknown, id: string, hash: string) => {
    log.push(`reset:${id}:${hash}`);
  },
  changeOwnPassword: async (_ctx: unknown, id: string, _current: string, hash: string) => {
    log.push(`change:${id}:${hash}`);
  },
  deactivateAgent: async (_ctx: unknown, id: string) => {
    log.push(`deactivate:${id}`);
  },
  purgeAgent: async (_ctx: unknown, id: string) => {
    log.push(`purge:${id}`);
  },
}));

const flow = await import('#src/modules/agent/agent.flow.js');

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const actor: RequestActor = { tenantId: TENANT_ID, agentId: 'agent-1', roleId: 'role-1', ip: '127.0.0.1' };

beforeEach(() => {
  log.length = 0;
});

function mockPrisma() {
  const tx = {
    $executeRaw: async () => 1,
    tenantAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        log.push(`audit:${data.action}:${data.targetId}`);
        return data;
      },
    },
  };
  return {
    async $transaction(cb: (t: typeof tx) => Promise<unknown>) {
      log.push('begin');
      const result = await cb(tx);
      log.push('commit');
      return result;
    },
  } as never;
}

test('createAgentFlow：交易之前雜湊密碼，建立成員與稽核一起 commit', async () => {
  await flow.createAgentFlow({ prisma: mockPrisma() }, actor, {
    data: { email: 'a@example.com', name: 'A', password: 'pw-1' } as never,
    grantable: 'ALL' as never,
  });
  assert.deepEqual(log, ['hash:pw-1', 'begin', 'createAgent:hashed:pw-1', 'audit:agent.create:new-agent', 'commit']);
});

test('resetAgentPasswordFlow：交易之前雜湊密碼，重設與稽核一起 commit', async () => {
  await flow.resetAgentPasswordFlow({ prisma: mockPrisma() }, actor, 'agent-2', 'pw-2');
  assert.deepEqual(log, ['hash:pw-2', 'begin', 'reset:agent-2:hashed:pw-2', 'audit:agent.password.reset:agent-2', 'commit']);
});

test('changeOwnPasswordFlow：交易之前雜湊新密碼', async () => {
  await flow.changeOwnPasswordFlow({ prisma: mockPrisma() }, actor, 'old', 'pw-3');
  assert.deepEqual(log, ['hash:pw-3', 'begin', 'change:agent-1:hashed:pw-3', 'commit']);
});

test('deactivateAgentFlow：不可停用自己，不開啟交易', async () => {
  await assert.rejects(
    flow.deactivateAgentFlow({ prisma: mockPrisma() }, actor, 'agent-1'),
    (err: { code?: string }) => err.code === 'SELF_ACTION_FORBIDDEN',
  );
  assert.deepEqual(log, []);
});

test('purgeAgentFlow：不可刪除自己，不開啟交易', async () => {
  await assert.rejects(
    flow.purgeAgentFlow({ prisma: mockPrisma() }, actor, 'agent-1'),
    (err: { code?: string }) => err.code === 'SELF_ACTION_FORBIDDEN',
  );
  assert.deepEqual(log, []);
});

test('purgeAgentFlow：刪除與稽核一起 commit', async () => {
  await flow.purgeAgentFlow({ prisma: mockPrisma() }, actor, 'agent-2');
  assert.deepEqual(log, ['begin', 'purge:agent-2', 'audit:agent.purge:agent-2', 'commit']);
});
