import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { executeWorkerAutomationActions } from '#src/lib/automation-actions';

// outbox 的快路徑送進佇列：這裡只看 outbox，佇列換成不做事的假實作
vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add() {}
  },
}));

/**
 * add_tag worker 動作測試（line-material-basics-and-click-tag 第 2 塊）。
 * 用 mock prisma 直接驗 executeWorkerAutomationActions 的 add_tag 分支：
 * 貼標成功 / 冪等 / 缺 contactId skip / 跨租戶 tag 擋 / 依 tagName 找不到則建立。
 */

interface FakeState {
  tags: Array<{ id: string; tenantId: string; name: string }>;
  contactTags: Array<{ contactId: string; tagId: string; addedBy: string }>;
  createdTags: number;
  outbox?: Array<{ tenantId: string; name: string; payload: any }>;
}

function makePrisma(state: FakeState) {
  state.outbox ??= [];
  const prisma: Record<string, unknown> = {
    outbox: {
      async create({ data }: { data: { tenantId: string; name: string; payload: any } }) {
        const row = { id: `outbox-${state.outbox!.length + 1}`, ...data, kind: 'event', queueName: null, jobOptions: null, createdAt: new Date() };
        state.outbox!.push(row);
        return row;
      },
      async updateMany() {
        return { count: 1 };
      },
    },
    tag: {
      async findFirst({ where }: { where: { id?: string; name?: string; tenantId: string } }) {
        return (
          state.tags.find(
            (t) =>
              t.tenantId === where.tenantId &&
              (where.id ? t.id === where.id : true) &&
              (where.name ? t.name === where.name : true),
          ) ?? null
        );
      },
      async create({ data }: { data: { tenantId: string; name: string } }) {
        const tag = { id: `tag-new-${state.createdTags++}`, tenantId: data.tenantId, name: data.name };
        state.tags.push(tag);
        return tag;
      },
    },
    contactTag: {
      // 冪等 upsert（對齊實作改用 upsert）：已存在則不新增
      async upsert({ where, create }: {
        where: { contactId_tagId: { contactId: string; tagId: string } };
        create: { contactId: string; tagId: string; addedBy: string };
      }) {
        const key = where.contactId_tagId;
        const exist = state.contactTags.find((ct) => ct.contactId === key.contactId && ct.tagId === key.tagId);
        if (!exist) state.contactTags.push(create);
        return exist ?? create;
      },
    },
  };
  prisma.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma);
  return prisma;
}

// 記錄 worker 發出的 domain event（contact.tagged 橋接）
let published: Array<{ channel: string; msg: any }> = [];
const redisPublisher = {
  async publish(channel: string, message: string) {
    published.push({ channel, msg: JSON.parse(message) });
    return 1;
  },
};

async function run(state: FakeState, action: Record<string, unknown>, ctx: Record<string, unknown>) {
  published = [];
  await executeWorkerAutomationActions(
    makePrisma(state) as any,
    redisPublisher as any,
    [action as any],
    { tenantId: 'tenant-1', ...ctx } as any,
  );
}

async function testAddTagByTagIdSuccess() {
  const state: FakeState = {
    tags: [{ id: 'tag-vip', tenantId: 'tenant-1', name: 'VIP' }],
    contactTags: [],
    createdTags: 0,
  };
  await run(state, { type: 'add_tag', params: { tagId: 'tag-vip' } }, { contactId: 'contact-1' });
  assert.equal(state.contactTags.length, 1);
  assert.equal(state.contactTags[0].tagId, 'tag-vip');
  assert.equal(state.contactTags[0].addedBy, 'automation');
  // Automation add_tag emits event：貼標與 contact.tagged 在同一個交易寫進 outbox（change outbox-event-delivery）
  assert.equal(published.some((p) => p.channel === 'domain:event'), false);
  const evts = state.outbox!.filter((o) => o.name === 'contact.tagged');
  assert.equal(evts.length, 1, '應把 contact.tagged 寫進 outbox');
  assert.equal(evts[0]!.tenantId, 'tenant-1');
  assert.equal(evts[0]!.payload.source, 'automation');
  assert.equal(evts[0]!.payload.tagId, 'tag-vip');
}

async function testAddTagIdempotent() {
  const state: FakeState = {
    tags: [{ id: 'tag-vip', tenantId: 'tenant-1', name: 'VIP' }],
    contactTags: [{ contactId: 'contact-1', tagId: 'tag-vip', addedBy: 'system' }],
    createdTags: 0,
  };
  await run(state, { type: 'add_tag', params: { tagId: 'tag-vip' } }, { contactId: 'contact-1' });
  // 已有該 tag → 不重複建立
  assert.equal(state.contactTags.length, 1);
}

async function testAddTagMissingContactSkips() {
  const state: FakeState = {
    tags: [{ id: 'tag-vip', tenantId: 'tenant-1', name: 'VIP' }],
    contactTags: [],
    createdTags: 0,
  };
  await run(state, { type: 'add_tag', params: { tagId: 'tag-vip' } }, { contactId: null });
  assert.equal(state.contactTags.length, 0); // 缺 contactId 安全 skip、不報錯
}

async function testAddTagCrossTenantBlocked() {
  const state: FakeState = {
    tags: [{ id: 'tag-other', tenantId: 'tenant-2', name: 'VIP' }], // 別租戶的 tag
    contactTags: [],
    createdTags: 0,
  };
  await run(state, { type: 'add_tag', params: { tagId: 'tag-other' } }, { contactId: 'contact-1' });
  assert.equal(state.contactTags.length, 0); // 跨租戶 tag 找不到 → skip
}

async function testAddTagByNameCreatesIfMissing() {
  const state: FakeState = { tags: [], contactTags: [], createdTags: 0 };
  await run(state, { type: 'add_tag', params: { tagName: '點過雙11' } }, { contactId: 'contact-1' });
  // 依名稱找不到 → 建立新 tag（同租戶）→ 貼標
  assert.equal(state.tags.length, 1);
  assert.equal(state.tags[0].name, '點過雙11');
  assert.equal(state.contactTags.length, 1);
}

test('add tag by tag id success', testAddTagByTagIdSuccess);
test('add tag idempotent', testAddTagIdempotent);
test('add tag missing contact skips', testAddTagMissingContactSkips);
test('add tag cross tenant blocked', testAddTagCrossTenantBlocked);
test('add tag by name creates if missing', testAddTagByNameCreatesIfMissing);
