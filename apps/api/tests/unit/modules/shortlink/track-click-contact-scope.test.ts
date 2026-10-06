/**
 * 公開的 POST /s/track 帶進來的 cid 要屬於短連結所屬的租戶（AUDIT RLS-07 的 code review）。
 * trackClick 走 BYPASSRLS（請求沒有租戶），原本直接把 cid 寫進點擊紀錄，並拿去自動貼標：
 * 知道其他租戶聯絡人 UUID 的人，可以讓 A 租戶的標籤貼到 B 租戶的聯絡人身上，RLS 擋不住。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

vi.mock('#src/events/event-bus.js', () => ({ eventBus: { publish: vi.fn() } }));

const { trackClick } = await import('#src/modules/shortlink/shortlink.service.js');

const TENANT = 'a0000000-0000-0000-0000-0000000000aa';
const OWN_CONTACT = 'c0000000-0000-0000-0000-000000000001';
const FOREIGN_CONTACT = 'c0000000-0000-0000-0000-000000000999';

function mockPrisma() {
  const clickContacts: Array<string | undefined> = [];
  const taggedContacts: string[] = [];
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));
  const prisma = {
    shortLink: {
      findUnique: async () => ({
        id: 'link-1', slug: 'abc', tenantId: TENANT, isActive: true, expiresAt: null,
        targetUrl: 'https://example.com', lineChannelId: null, tagOnClick: 'tag-1',
        utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null,
      }),
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
        return { contactId: args.where.contactId_tagId.contactId };
      },
      findUnique: async () => null,
    },
  };
  // 點擊紀錄與貼標是 fire-and-forget：以 eventBus.publish（最後一步）作為完成訊號
  return { prisma, clickContacts, taggedContacts, done, resolveDone };
}

async function track(cid: string | undefined) {
  const m = mockPrisma();
  const { eventBus } = await import('#src/events/event-bus.js');
  (eventBus.publish as ReturnType<typeof vi.fn>).mockImplementationOnce(() => m.resolveDone());
  await trackClick(m.prisma as never, 'abc', { contactId: cid });
  await Promise.race([m.done, new Promise((r) => setTimeout(r, 1000))]);
  return m;
}

test('其他租戶的 cid：不寫進點擊紀錄，也不貼標', async () => {
  const m = await track(FOREIGN_CONTACT);
  assert.deepEqual(m.clickContacts, [undefined]);
  assert.deepEqual(m.taggedContacts, []);
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
});
