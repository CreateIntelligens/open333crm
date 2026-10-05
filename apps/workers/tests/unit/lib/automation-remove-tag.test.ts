/**
 * remove_tag worker 動作（change fix-automation-remaining-actions，AUDIT AUTO-01）。
 * 原本 workers 沒有這個分支，規則可以存檔、也會命中，執行時卻直接略過。
 * 與 add_tag 不同：找不到標籤時略過、不建立，也只找 CONTACT scope 的標籤（避免同名的工單標籤）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { executeWorkerAutomationActions } from '#src/lib/automation-actions';

interface FakeTag {
  id: string;
  tenantId: string;
  name: string;
  scope: string;
}

interface FakeState {
  tags: FakeTag[];
  contactTags: Array<{ contactId: string; tagId: string }>;
}

function makePrisma(state: FakeState) {
  return {
    tag: {
      async findFirst({ where }: { where: { id?: string; name?: string; tenantId: string; scope?: string } }) {
        return (
          state.tags.find(
            (t) =>
              t.tenantId === where.tenantId &&
              (where.id === undefined || t.id === where.id) &&
              (where.name === undefined || t.name === where.name) &&
              (where.scope === undefined || t.scope === where.scope),
          ) ?? null
        );
      },
      async create() {
        throw new Error('remove_tag 不應建立標籤');
      },
    },
    contactTag: {
      async deleteMany({ where }: { where: { contactId: string; tagId: string } }) {
        const before = state.contactTags.length;
        state.contactTags = state.contactTags.filter(
          (ct) => !(ct.contactId === where.contactId && ct.tagId === where.tagId),
        );
        return { count: before - state.contactTags.length };
      },
    },
  };
}

const redisPublisher = { publish: async () => 1 };

async function run(state: FakeState, params: Record<string, unknown>, contactId: string | null = 'contact-1') {
  await executeWorkerAutomationActions(
    makePrisma(state) as never,
    redisPublisher as never,
    [{ type: 'remove_tag', params } as never],
    { tenantId: 'tenant-1', contactId } as never,
  );
}

test('Remove tag by name：移除聯絡人的這個標籤', async () => {
  const state: FakeState = {
    tags: [{ id: 'tag-vip', tenantId: 'tenant-1', name: 'VIP', scope: 'CONTACT' }],
    contactTags: [
      { contactId: 'contact-1', tagId: 'tag-vip' },
      { contactId: 'contact-2', tagId: 'tag-vip' },
    ],
  };
  await run(state, { tagName: 'VIP' });
  assert.deepEqual(state.contactTags, [{ contactId: 'contact-2', tagId: 'tag-vip' }], '只移除觸發對象的標籤');
});

test('Remove a tag that does not exist：略過，不建立標籤', async () => {
  const state: FakeState = { tags: [], contactTags: [] };
  await run(state, { tagName: '不存在的標籤' });
  assert.equal(state.tags.length, 0);
});

test('依 tagId 移除', async () => {
  const state: FakeState = {
    tags: [{ id: 'tag-vip', tenantId: 'tenant-1', name: 'VIP', scope: 'CONTACT' }],
    contactTags: [{ contactId: 'contact-1', tagId: 'tag-vip' }],
  };
  await run(state, { tagId: 'tag-vip' });
  assert.equal(state.contactTags.length, 0);
});

test('只找 CONTACT scope 的標籤：同名的工單標籤不影響', async () => {
  const state: FakeState = {
    tags: [
      { id: 'tag-case-vip', tenantId: 'tenant-1', name: 'VIP', scope: 'CASE' },
      { id: 'tag-vip', tenantId: 'tenant-1', name: 'VIP', scope: 'CONTACT' },
    ],
    contactTags: [{ contactId: 'contact-1', tagId: 'tag-vip' }],
  };
  await run(state, { tagName: 'VIP' });
  assert.equal(state.contactTags.length, 0, '移除的是 CONTACT scope 的 VIP');
});

test('其他租戶的標籤：略過', async () => {
  const state: FakeState = {
    tags: [{ id: 'tag-other', tenantId: 'tenant-2', name: 'VIP', scope: 'CONTACT' }],
    contactTags: [{ contactId: 'contact-1', tagId: 'tag-other' }],
  };
  await run(state, { tagId: 'tag-other' });
  assert.equal(state.contactTags.length, 1);
});

test('沒有聯絡人或沒有標籤資訊：略過、不報錯', async () => {
  const state: FakeState = {
    tags: [{ id: 'tag-vip', tenantId: 'tenant-1', name: 'VIP', scope: 'CONTACT' }],
    contactTags: [{ contactId: 'contact-1', tagId: 'tag-vip' }],
  };
  await run(state, { tagName: 'VIP' }, null);
  await run(state, {});
  assert.equal(state.contactTags.length, 1);
});
