/**
 * remove_tag worker 動作（change fix-automation-remaining-actions，AUDIT AUTO-01）。
 * 原本 workers 沒有這個分支，規則可以存檔、也會命中，執行時卻直接略過。
 * 只刪除「聯絡人身上、本租戶、名稱或 ID 相符」的標籤：找不到就什麼都不做，不建立標籤；
 * 不限 scope，和 add_tag 對稱——add_tag 依名稱找標籤時不分 scope（AUDIT AUTO-03），
 * 它貼上的標籤要能用同名的 remove_tag 移除。
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

type DeleteWhere = { contactId: string; tagId?: string; tag: { tenantId: string; name?: string } };

function makePrisma(state: FakeState) {
  return {
    tag: {
      async create() {
        throw new Error('remove_tag 不應建立標籤');
      },
    },
    contactTag: {
      async deleteMany({ where }: { where: DeleteWhere }) {
        const before = state.contactTags.length;
        state.contactTags = state.contactTags.filter((ct) => {
          const tag = state.tags.find((t) => t.id === ct.tagId);
          const match =
            ct.contactId === where.contactId &&
            !!tag &&
            tag.tenantId === where.tag.tenantId &&
            (where.tagId === undefined || ct.tagId === where.tagId) &&
            (where.tag.name === undefined || tag.name === where.tag.name);
          return !match;
        });
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

test('Remove tag by name：只移除觸發聯絡人的這個標籤', async () => {
  const state: FakeState = {
    tags: [{ id: 'tag-vip', tenantId: 'tenant-1', name: 'VIP', scope: 'CONTACT' }],
    contactTags: [
      { contactId: 'contact-1', tagId: 'tag-vip' },
      { contactId: 'contact-2', tagId: 'tag-vip' },
    ],
  };
  await run(state, { tagName: 'VIP' });
  assert.deepEqual(state.contactTags, [{ contactId: 'contact-2', tagId: 'tag-vip' }]);
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

test('add_tag 貼上的其他 scope 同名標籤，也能用 remove_tag 移除（兩者對稱）', async () => {
  const state: FakeState = {
    tags: [{ id: 'tag-case-vip', tenantId: 'tenant-1', name: 'VIP', scope: 'CASE' }],
    contactTags: [{ contactId: 'contact-1', tagId: 'tag-case-vip' }],
  };
  await run(state, { tagName: 'VIP' });
  assert.equal(state.contactTags.length, 0);
});

test('其他租戶的標籤：不移除', async () => {
  const state: FakeState = {
    tags: [{ id: 'tag-other', tenantId: 'tenant-2', name: 'VIP', scope: 'CONTACT' }],
    contactTags: [{ contactId: 'contact-1', tagId: 'tag-other' }],
  };
  await run(state, { tagId: 'tag-other' });
  await run(state, { tagName: 'VIP' });
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
