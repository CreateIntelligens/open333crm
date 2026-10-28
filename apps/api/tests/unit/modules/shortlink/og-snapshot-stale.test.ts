/**
 * OG 快照只寫回抓取時的目標網址（PR #386 的機器人審查）。
 *
 * 連續兩次修改目標網址時，兩次 OG 抓取在背景並行。第一次抓得比第二次慢時，
 * 舊網址的 OG 不能蓋掉新網址的 OG：寫回時目標網址已經改變，就不寫。
 *
 * 走 updateShortLinkFlow：commit 之後在背景抓 OG，再另開交易寫回（og-snapshot.ts）。
 * 短連結以記憶體中的一筆資料模擬：update 直接套用，updateMany 只在 where 的欄位都相符時套用。
 * prisma.$transaction 以 mock 模擬，見 tests/support/flow-harness.ts。
 * OG 抓取以 vi.mock 替換，每個網址各自決定何時回傳。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { createFlowLog, mockTransactionPrisma } from '#tests/support/flow-harness.js';

const pending = vi.hoisted(() => new Map<string, (og: { ogTitle: string }) => void>());
vi.mock('#src/modules/shortlink/og-scraper.js', () => ({
  scrapeOg: (url: string) => new Promise((resolve) => pending.set(url, resolve)),
}));

const { updateShortLinkFlow } = await import('#src/modules/shortlink/shortlink.flow.js');

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

type Row = Record<string, unknown>;

function fakeDb(row: Row) {
  const matches = (where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);
  return {
    shortLink: {
      findFirst: async ({ where }: { where: Row }) => (matches(where) ? { ...row } : null),
      update: async ({ where, data }: { where: Row; data: Row }) => {
        assert.ok(matches(where));
        for (const [k, v] of Object.entries(data)) if (v !== undefined) row[k] = v;
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (!matches(where)) return { count: 0 };
        for (const [k, v] of Object.entries(data)) if (v !== undefined) row[k] = v;
        return { count: 1 };
      },
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function updateTarget(row: Row, targetUrl: string) {
  const prisma = mockTransactionPrisma(createFlowLog(), fakeDb(row));
  return updateShortLinkFlow({ prisma }, TENANT_ID, row.id as string, { targetUrl });
}

test('連續修改目標網址，舊網址的 OG 晚到：不蓋掉新網址的 OG', async () => {
  const row: Row = { id: 'l-1', tenantId: TENANT_ID, targetUrl: 'https://example.com/a', ogTitle: null };

  await updateTarget(row, 'https://example.com/b');
  await updateTarget(row, 'https://example.com/c');

  pending.get('https://example.com/c')!({ ogTitle: 'OG c' });
  await flush();
  pending.get('https://example.com/b')!({ ogTitle: 'OG b' });
  await flush();

  assert.equal(row.targetUrl, 'https://example.com/c');
  assert.equal(row.ogTitle, 'OG c');
});

test('目標網址沒有再改：OG 照常寫回', async () => {
  const row: Row = { id: 'l-2', tenantId: TENANT_ID, targetUrl: 'https://example.com/a', ogTitle: null };

  await updateTarget(row, 'https://example.com/d');
  pending.get('https://example.com/d')!({ ogTitle: 'OG d' });
  await flush();

  assert.equal(row.ogTitle, 'OG d');
});
