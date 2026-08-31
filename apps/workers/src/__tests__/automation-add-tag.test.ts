import assert from 'node:assert/strict';
import { executeWorkerAutomationActions } from '../lib/automation-actions';

/**
 * add_tag worker 動作測試（line-material-basics-and-click-tag 第 2 塊）。
 * 用 mock prisma 直接驗 executeWorkerAutomationActions 的 add_tag 分支：
 * 貼標成功 / 冪等 / 缺 contactId skip / 跨租戶 tag 擋 / 依 tagName 找不到則建立。
 */

interface FakeState {
  tags: Array<{ id: string; tenantId: string; name: string }>;
  contactTags: Array<{ contactId: string; tagId: string; addedBy: string }>;
  createdTags: number;
}

function makePrisma(state: FakeState) {
  return {
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
      async findFirst({ where }: { where: { contactId: string; tagId: string } }) {
        return (
          state.contactTags.find((ct) => ct.contactId === where.contactId && ct.tagId === where.tagId) ?? null
        );
      },
      async create({ data }: { data: { contactId: string; tagId: string; addedBy: string } }) {
        state.contactTags.push(data);
        return data;
      },
    },
  };
}

const redisPublisher = { async publish() { return 1; } };

async function run(state: FakeState, action: Record<string, unknown>, ctx: Record<string, unknown>) {
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

async function main() {
  await testAddTagByTagIdSuccess();
  await testAddTagIdempotent();
  await testAddTagMissingContactSkips();
  await testAddTagCrossTenantBlocked();
  await testAddTagByNameCreatesIfMissing();
  console.log('automation-add-tag tests passed');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
