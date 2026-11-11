/**
 * 記錄滿意度分數（issue #339，change csat-reresolve-decisions-339）：
 * - 評分只處理一次：客人連點兩次時，條件更新只讓一次寫入，後續（感謝訊息、低分通知、case.closed）只做一次。
 * - 低分只通知有效權限含 case.assign、啟用中、看得到工單渠道的成員，不看舊的角色列舉（AUDIT RBAC-03）。
 * - 評分後關閉對話；工單記錄評分來源 csatRatedBy。
 *
 * 並行評分要兩條真的連線，不能包在 rollback 的交易裡：本檔建立自己的租戶，afterAll 刪除。
 * owner 連線與進站管線的 prismaAdmin 一樣不受 RLS 限制，租戶條件只能靠程式。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { TenantDb } from '#src/lib/tenant-db.js';
import { eventBus, type AppEvent } from '#src/events/event-bus.js';
import { recordCsatScore } from '#src/modules/csat/csat.service.js';
import { resolveCaseManagerRecipients } from '#src/modules/notification/notification.service.js';

const owner = new PrismaClient();
const second = new PrismaClient();
const stamp = `csat-rate-${Date.now().toString(36)}`;
const io = { to: () => ({ emit: () => true }) } as never;

const closedEvents: AppEvent[] = [];
eventBus.subscribe('case.closed', (event) => closedEvents.push(event));

let tenantId = '';
let channelId = '';
let contactId = '';
const agents: Record<'admin' | 'supervisor' | 'noAssign' | 'inactive' | 'noChannel', string> = {
  admin: '', supervisor: '', noAssign: '', inactive: '', noChannel: '',
};

async function createRole(slug: string, codes: string[]) {
  const role = await owner.role.create({ data: { tenantId, slug: `${stamp}-${slug}`, name: slug } });
  await owner.rolePermission.createMany({ data: codes.map((permissionCode) => ({ roleId: role.id, permissionCode })) });
  return role.id;
}

async function createAgent(slug: string, data: { roleId: string; role: 'ADMIN' | 'SUPERVISOR' | 'AGENT'; isActive?: boolean }) {
  return (await owner.agent.create({
    data: { tenantId, email: `${stamp}-${slug}@example.test`, name: slug, passwordHash: 'x', ...data },
  })).id;
}

beforeAll(async () => {
  tenantId = (await owner.tenant.create({ data: { name: `CI 滿意度評分 ${stamp}` } })).id;
  channelId = (await owner.channel.create({
    data: { tenantId, channelType: 'WEBCHAT', displayName: `CI ${stamp}`, credentialsEncrypted: 'x' },
  })).id;
  contactId = (await owner.contact.create({ data: { tenantId, displayName: `${stamp}-甲` } })).id;

  const manageAll = await createRole('manage-all', ['case.view', 'case.assign', 'channel.view', 'channel.view_all']);
  const manageScoped = await createRole('manage-scoped', ['case.view', 'case.assign']);
  const viewOnly = await createRole('view-only', ['case.view', 'case.update', 'channel.view', 'channel.view_all']);

  agents.admin = await createAgent('admin', { roleId: manageAll, role: 'ADMIN' });
  agents.supervisor = await createAgent('supervisor', { roleId: manageScoped, role: 'SUPERVISOR' });
  agents.noAssign = await createAgent('no-assign', { roleId: viewOnly, role: 'SUPERVISOR' });
  agents.inactive = await createAgent('inactive', { roleId: manageAll, role: 'SUPERVISOR', isActive: false });
  agents.noChannel = await createAgent('no-channel', { roleId: manageScoped, role: 'SUPERVISOR' });
  await owner.agentChannelAccess.create({ data: { channelId, agentId: agents.supervisor, accessLevel: 'full' } });
});

afterAll(async () => {
  await owner.notification.deleteMany({ where: { tenantId } });
  await owner.message.deleteMany({ where: { conversation: { tenantId } } });
  await owner.conversation.deleteMany({ where: { tenantId } });
  await owner.caseEvent.deleteMany({ where: { case: { tenantId } } });
  await owner.case.deleteMany({ where: { tenantId } });
  await owner.agentChannelAccess.deleteMany({ where: { channelId } });
  await owner.agent.deleteMany({ where: { tenantId } });
  await owner.role.deleteMany({ where: { tenantId } });
  await owner.contact.deleteMany({ where: { tenantId } });
  await owner.channel.deleteMany({ where: { tenantId } });
  await owner.tenantSettings.deleteMany({ where: { tenantId } });
  await owner.tenant.deleteMany({ where: { id: tenantId } });
  await owner.$disconnect();
  await second.$disconnect();
});

async function createCase() {
  const kase = await owner.case.create({
    data: { tenantId, contactId, channelId, title: `${stamp} 冷氣不冷`, status: 'RESOLVED', resolvedAt: new Date() },
  });
  const conversation = await owner.conversation.create({
    data: { tenantId, contactId, channelId, channelType: 'WEBCHAT', caseId: kase.id, status: 'AGENT_HANDLED' },
  });
  return { caseId: kase.id, conversationId: conversation.id };
}

const asDb = (client: PrismaClient) => client as unknown as TenantDb;
const customer = { get scope() { return { tenantId, contactId }; } };

async function lowScoreRecipients(caseId: string): Promise<string[]> {
  const rows = await owner.notification.findMany({
    where: { tenantId, type: 'csat_low_score', clickUrl: { contains: caseId } },
    select: { agentId: true },
  });
  return rows.map((r) => r.agentId).sort();
}

const followUpCount = (conversationId: string) =>
  owner.message.count({ where: { conversationId, metadata: { path: ['type'], equals: 'csat_followup' } } });

/**
 * 兩個請求同時評分：兩條連線都讀到「還沒評分」之後才繼續（讀取完在柵欄等另一邊），
 * 重現兩次都通過 JS 檢查的時序，不靠運氣。
 */
async function rateTwiceConcurrently(caseId: string, score: number): Promise<boolean[]> {
  let arrived = 0;
  let release!: () => void;
  const bothRead = new Promise<void>((resolve) => { release = resolve; });
  const gated = (client: PrismaClient) => new Proxy(client, {
    get(target, prop) {
      if (prop !== 'case') return Reflect.get(target, prop);
      return new Proxy(target.case, {
        get(model, key) {
          if (key !== 'findFirst') return Reflect.get(model, key);
          return async (args: never) => {
            const row = await model.findFirst(args);
            arrived += 1;
            if (arrived === 2) release();
            await bothRead;
            return row;
          };
        },
      });
    },
  });
  return Promise.all([
    recordCsatScore(asDb(gated(owner)), io, caseId, score, undefined, customer.scope),
    recordCsatScore(asDb(gated(second)), io, caseId, score, undefined, customer.scope),
  ]);
}

describe('評分只處理一次', () => {
  it('客人連點兩次評分只處理一次', async () => {
    const { caseId, conversationId } = await createCase();

    const results = await rateTwiceConcurrently(caseId, 2);

    assert.deepEqual(results.filter(Boolean).length, 1, '只有一次回傳已記錄');
    assert.equal(await followUpCount(conversationId), 1, '只有一則感謝訊息');
    assert.equal(closedEvents.filter((e) => e.payload.caseId === caseId).length, 1, 'case.closed 只發一次');
    const recipients = await lowScoreRecipients(caseId);
    assert.equal(recipients.length, new Set(recipients).size, '每位收件成員只收到一則低分通知');
  });

  it('同一份評分同時送達兩次', async () => {
    const { caseId, conversationId } = await createCase();

    await rateTwiceConcurrently(caseId, 2);

    const row = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    assert.equal(row.csatScore, 2);
    assert.equal(await followUpCount(conversationId), 1);
  });
});

describe('低分只通知負責工單的成員', () => {
  it('低分通知有工單指派權限的管理員與主管', async () => {
    const { caseId } = await createCase();

    assert.equal(await recordCsatScore(asDb(owner), io, caseId, 2, undefined, customer.scope), true);

    const recipients = await lowScoreRecipients(caseId);
    assert.ok(recipients.includes(agents.admin), '持 case.assign 與 channel.view_all 的管理員收到');
    assert.ok(recipients.includes(agents.supervisor), '直綁渠道並持 case.assign 的主管收到');
    const row = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    assert.equal(row.status, 'CLOSED', '只通知，不升級工單');
  });

  it('沒有工單指派權限的成員不收低分通知', async () => {
    const { caseId } = await createCase();
    await recordCsatScore(asDb(owner), io, caseId, 1, undefined, customer.scope);
    assert.equal((await lowScoreRecipients(caseId)).includes(agents.noAssign), false);
  });

  it('看不到渠道的成員不收低分通知', async () => {
    const { caseId } = await createCase();
    await recordCsatScore(asDb(owner), io, caseId, 1, undefined, customer.scope);
    assert.equal((await lowScoreRecipients(caseId)).includes(agents.noChannel), false);
  });

  it('停用的成員不收低分通知', async () => {
    const { caseId } = await createCase();
    await recordCsatScore(asDb(owner), io, caseId, 1, undefined, customer.scope);
    assert.equal((await lowScoreRecipients(caseId)).includes(agents.inactive), false);
    // 寫入通知時 createNotificationForActiveAgent 也會擋停用成員（#484）：另外直接檢查收件人名單，確定是這裡排除的
    const recipients = await resolveCaseManagerRecipients({ tx: owner as never, tenantId }, channelId);
    assert.equal(recipients.includes(agents.inactive), false, '收件人名單不含停用的成員');
    assert.deepEqual([...recipients].sort(), [agents.admin, agents.supervisor].sort());
  });

  it('3 分不發低分通知', async () => {
    const { caseId } = await createCase();
    await recordCsatScore(asDb(owner), io, caseId, 3, undefined, customer.scope);
    assert.deepEqual(await lowScoreRecipients(caseId), []);
  });
});

describe('評分後關閉對話與評分來源', () => {
  it('客人評分後對話關閉', async () => {
    const { caseId, conversationId } = await createCase();

    await recordCsatScore(asDb(owner), io, caseId, 5, undefined, customer.scope);

    const kase = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    const conversation = await owner.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    assert.equal(kase.status, 'CLOSED');
    assert.equal(conversation.status, 'CLOSED');
  });

  it('客服代評後對話關閉', async () => {
    const { caseId, conversationId } = await createCase();

    await recordCsatScore(asDb(owner), io, caseId, 4, undefined, { tenantId, agentId: agents.admin });

    const conversation = await owner.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    assert.equal(conversation.status, 'CLOSED');
  });

  it('客人評分記錄來源', async () => {
    const { caseId } = await createCase();
    await recordCsatScore(asDb(owner), io, caseId, 5, undefined, customer.scope);
    const row = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    assert.equal((row as { csatRatedBy?: string | null }).csatRatedBy, 'customer');
  });

  it('客服代評記錄來源', async () => {
    const { caseId } = await createCase();
    await recordCsatScore(asDb(owner), io, caseId, 4, undefined, { tenantId, agentId: agents.admin });
    const row = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    assert.equal((row as { csatRatedBy?: string | null }).csatRatedBy, 'agent');
  });
});
