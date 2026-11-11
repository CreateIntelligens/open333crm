/**
 * shortlink 的 flow（#337 階段 3，AGENTS.md 結構規則 2）：
 * - 點擊：link.clicked、contact.tagged 與點擊一起寫進 outbox，commit 之後才送出；
 *   link.stats.updated 在 commit 之後推播。寫入失敗時 rollback，事件與推播都不送出。
 * - 建立短連結：OG 快照在 commit 之後才抓；建立失敗時不抓。
 *
 * prisma.$transaction 以 mock 模擬，見 tests/support/flow-harness.ts。OG 抓取以 vi.mock 替換。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type { ShortLink } from '@prisma/client';
import { createFlowLog, mockTransactionPrisma, recordingIo, recordingPublisher, type FlowLog } from '#tests/support/flow-harness.js';

const scraped = vi.hoisted(() => [] as string[]);
/** 目前測試的 log：抓取時記一筆 'scrape'，用來檢查先後順序 */
const current = vi.hoisted(() => ({ log: null as { entries: string[] } | null }));
vi.mock('#src/modules/shortlink/og-scraper.js', () => ({
  scrapeOg: async (url: string) => {
    scraped.push(url);
    current.log?.entries.push('scrape');
    return {};
  },
}));

const { createShortLinkFlow, trackClickFlow } = await import('#src/modules/shortlink/shortlink.flow.js');

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const CONTACT_ID = 'c0000000-0000-0000-0000-000000000001';

const link = {
  id: 'link-1',
  slug: 'abc',
  tenantId: TENANT_ID,
  lineChannelId: null,
  tagOnClick: 'tag-1',
} as unknown as ShortLink;

function clickTx(log: FlowLog, failCount = false) {
  return {
    $executeRawUnsafe: async () => 0,
    contact: { findFirst: async () => ({ id: CONTACT_ID }) },
    clickLog: {
      create: async () => {
        log.entries.push('write:clickLog');
        return {};
      },
    },
    shortLink: {
      update: async () => {
        if (failCount) throw new Error('update failed');
        log.entries.push('write:shortLink');
        return { totalClicks: 3, uniqueClicks: 2 };
      },
    },
    tag: { findFirst: async () => ({ id: 'tag-1', tenantId: TENANT_ID, scope: 'CONTACT', name: 'VIP' }) },
    contactTag: {
      upsert: async () => {
        log.entries.push('write:contactTag');
        return { tag: { name: 'VIP' } };
      },
    },
  };
}

function clickDeps(log: FlowLog, failCount = false) {
  return { prisma: mockTransactionPrisma(log, clickTx(log, failCount)), io: recordingIo(log), events: recordingPublisher(log) };
}

test('Click events commit with the click：事件與點擊一起寫入，commit 之後才送出與推播', async () => {
  const log = createFlowLog();

  await trackClickFlow(clickDeps(log), link, { contactId: CONTACT_ID });

  assert.deepEqual(log.entries, [
    'write:clickLog',
    'write:shortLink',
    'write:contactTag',
    'event:contact.tagged',
    'event:link.clicked',
    'commit',
    'push:link.stats.updated',
    'dispatch:contact.tagged',
    'dispatch:link.clicked',
  ]);
  assert.deepEqual(log.events, [
    { name: 'contact.tagged', payload: { contactId: CONTACT_ID, tagId: 'tag-1', tagName: 'VIP', source: 'system' } },
    { name: 'link.clicked', payload: { shortLinkId: 'link-1', slug: 'abc', contactId: CONTACT_ID, lineUid: undefined, isUnique: true } },
  ]);
  assert.deepEqual(log.pushes, [
    { room: `tenant:${TENANT_ID}`, event: 'link.stats.updated', data: { shortLinkId: 'link-1', totalClicks: 3, uniqueClicks: 2 } },
  ]);
});

test('點擊：寫入失敗時 rollback，事件與推播都不送出', async () => {
  const log = createFlowLog();

  await assert.rejects(() => trackClickFlow(clickDeps(log, true), link, { contactId: CONTACT_ID }), /update failed/);

  assert.deepEqual(log.entries, ['write:clickLog', 'rollback']);
  assert.deepEqual(log.pushes, []);
});

function createTx(log: FlowLog, fail = false) {
  return {
    shortLink: {
      findUnique: async () => null,
      create: async ({ data }: { data: { targetUrl: string } }) => {
        if (fail) throw new Error('create failed');
        log.entries.push('write:shortLink');
        return { id: 'link-new', ...data };
      },
    },
  };
}

test('建立短連結（沒有填 OG）：commit 之後才抓 OG 快照', async () => {
  const log = createFlowLog();
  scraped.length = 0;
  current.log = log;
  const prisma = mockTransactionPrisma(log, createTx(log));

  await createShortLinkFlow({ prisma }, TENANT_ID, 'agent-1', { targetUrl: 'https://example.com/x' });

  assert.deepEqual(log.entries, ['write:shortLink', 'commit', 'scrape']);
  assert.deepEqual(scraped, ['https://example.com/x']);
});

test('建立短連結（手動填了 OG）：不抓 OG 快照', async () => {
  const log = createFlowLog();
  scraped.length = 0;
  const prisma = mockTransactionPrisma(log, createTx(log));

  await createShortLinkFlow({ prisma }, TENANT_ID, 'agent-1', { targetUrl: 'https://example.com/y', ogTitle: '手動標題' });

  assert.deepEqual(scraped, []);
});

test('建立短連結失敗：rollback，不抓 OG 快照', async () => {
  const log = createFlowLog();
  scraped.length = 0;
  const prisma = mockTransactionPrisma(log, createTx(log, true));

  await assert.rejects(
    () => createShortLinkFlow({ prisma }, TENANT_ID, 'agent-1', { targetUrl: 'https://example.com/z' }),
    /create failed/,
  );

  assert.deepEqual(log.entries, ['rollback']);
  assert.deepEqual(scraped, []);
});
