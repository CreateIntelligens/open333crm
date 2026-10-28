/**
 * 公開的 POST /s/track 帶進來的 cid 要屬於短連結所屬的租戶（AUDIT RLS-07 的 code review）。
 * 搬遷前 trackClick 走 BYPASSRLS（請求沒有租戶），原本直接把 cid 寫進點擊紀錄，並拿去自動貼標：
 * 知道其他租戶聯絡人 UUID 的人，可以讓 A 租戶的標籤貼到 B 租戶的聯絡人身上，RLS 擋不住。
 * 現在點擊在綁定短連結租戶的交易內記錄（recordClick），查詢仍帶 tenantId。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { recordClick } from '#src/modules/shortlink/shortlink.service.js';

const TENANT = 'a0000000-0000-0000-0000-0000000000aa';
const OWN_CONTACT = 'c0000000-0000-0000-0000-000000000001';
const FOREIGN_CONTACT = 'c0000000-0000-0000-0000-000000000999';

const LINK = { id: 'link-1', lineChannelId: null, tagOnClick: 'tag-1' };

function mockTx() {
  const clickContacts: Array<string | undefined> = [];
  const taggedContacts: string[] = [];
  const tx = {
    $executeRawUnsafe: async () => 0,
    shortLink: {
      update: async () => ({ totalClicks: 1, uniqueClicks: 1 }),
    },
    contact: {
      findFirst: async (args: { where: { id: string; tenantId: string } }) =>
        args.where.id === OWN_CONTACT && args.where.tenantId === TENANT ? { id: OWN_CONTACT } : null,
    },
    clickLog: {
      create: async (args: { data: { contactId?: string } }) => {
        clickContacts.push(args.data.contactId);
        return {};
      },
      count: async () => 1,
    },
    tag: { findFirst: async () => ({ id: 'tag-1', tenantId: TENANT, scope: 'CONTACT', name: 'VIP' }) },
    contactTag: {
      upsert: async (args: { where: { contactId_tagId: { contactId: string } } }) => {
        taggedContacts.push(args.where.contactId_tagId.contactId);
        return { contactId: args.where.contactId_tagId.contactId, tag: { name: 'VIP' } };
      },
      findUnique: async () => null,
    },
  };
  return { tx, clickContacts, taggedContacts };
}

async function track(cid: string | undefined) {
  const m = mockTx();
  const click = await recordClick({ tx: m.tx as never, tenantId: TENANT }, LINK, { contactId: cid });
  return { ...m, click };
}

test('其他租戶的 cid：不寫進點擊紀錄，也不貼標', async () => {
  const m = await track(FOREIGN_CONTACT);
  assert.deepEqual(m.clickContacts, [undefined]);
  assert.deepEqual(m.taggedContacts, []);
  assert.equal(m.click.tagged, null);
});

test('不是 UUID 的 cid：當成匿名點擊，點擊照樣記錄', async () => {
  const m = await track('not-a-uuid');
  assert.deepEqual(m.clickContacts, [undefined]);
  assert.deepEqual(m.taggedContacts, []);
});

test('同租戶的 cid：照常記錄並貼標', async () => {
  const m = await track(OWN_CONTACT);
  assert.deepEqual(m.clickContacts, [OWN_CONTACT]);
  assert.deepEqual(m.taggedContacts, [OWN_CONTACT]);
  assert.deepEqual(m.click.tagged, { contactId: OWN_CONTACT, tagId: 'tag-1', tagName: 'VIP', source: 'system' });
});
