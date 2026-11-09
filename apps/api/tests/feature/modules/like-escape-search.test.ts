/**
 * 後台搜尋把使用者輸入的 `%`、`_`、反斜線當成一般文字（#467）。
 *
 * Prisma 的 `contains` 把值包成 `%值%` 交給 PostgreSQL 的 ILIKE（mode: 'insensitive'），不跳脫值裡的
 * 萬用字元；各 service 先以 escapeLikeKeyword() 跳脫。這裡用真實資料庫驗證跳脫在 ILIKE（與券序號
 * 的原生 SQL LIKE）下確實生效，mock 驗不到這件事。
 *
 * 每個欄位跑三種輸入：
 * - `_`：搜 `a_1` 不命中 `ab1`（同時用大寫搜尋，確認仍不分大小寫）
 * - `%`：搜 `%` 只列出真的含 `%` 的資料，不會列出全部
 * - 反斜線：搜 `C:\dir` 命中 `C:\dir`、不命中 `C:dirz`（沒跳脫時 `\d` 會被當成字面的 d，
 *   反而只命中 `C:dirz`；不用 `C:dir` 是因為券序號有「去掉英數以外字元」的唯一索引，會與 `C:\dir` 衝突）
 *
 * 每個案例在 app_tenant 的交易內建資料、搜尋，最後拋錯 rollback，不留資料。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, it } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { withTenant } from '#src/lib/tenant-db.js';
import { ALL_CHANNELS } from '#src/services/channel-visibility.js';
import { listContacts } from '#src/modules/contact/contact.service.js';
import { listCoupons } from '#src/modules/coupon/coupon.service.js';
import { listInstances } from '#src/modules/coupon/coupon-stats.service.js';
import { listArticles } from '#src/modules/knowledge/knowledge.service.js';
import { listTemplates } from '#src/modules/marketing/marketing.service.js';
import { listMaterials } from '#src/modules/marketing/material.service.js';
import { listShortLinks } from '#src/modules/shortlink/shortlink.service.js';
import { ctxOf } from '#tests/support/tenant-run.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const tenantId = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
/** 標記不含 `%`、`_`、反斜線，避免標記本身被當成萬用字元 */
const MARK = `likeesc${Date.now()}x`;
const agentId = randomUUID();

afterAll(async () => {
  await prisma.$disconnect();
});

type Tx = Prisma.TransactionClient;

class Rollback extends Error {}

/** 不會被任何搜尋詞命中的填充值 */
const neutral = () => `n${randomUUID().replace(/-/g, '')}`;

interface SearchField {
  /** 測試名稱用 */
  name: string;
  /** 在交易內建一筆資料，被測欄位的值為 value，回傳可在搜尋結果中辨識這筆資料的 id */
  seed: (tx: Tx, value: string, state: Record<string, string>) => Promise<string>;
  /** 呼叫被測 service 搜尋，回傳結果的 id */
  search: (tx: Tx, q: string, state: Record<string, string>) => Promise<string[]>;
  /** 每個案例開始時建立共用資料（例如券序號要掛的券） */
  setup?: (tx: Tx, state: Record<string, string>) => Promise<void>;
}

/** 建資料、搜尋、rollback；回傳本案例建立的資料中被搜到的那些（依 seed 順序的 index） */
async function searchSeeded(field: SearchField, values: string[], q: string): Promise<number[]> {
  let hits: number[] = [];
  try {
    await withTenant(prisma, tenantId, async (rawTx) => {
      const tx = rawTx as Tx;
      const state: Record<string, string> = {};
      await field.setup?.(tx, state);
      const ids: string[] = [];
      for (const v of values) ids.push(await field.seed(tx, v, state));
      const found = new Set(await field.search(tx, q, state));
      hits = ids.map((id, i) => (found.has(id) ? i : -1)).filter((i) => i >= 0);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return hits;
}

const LIMIT = 100;

const contactField = (key: 'displayName' | 'phone' | 'email'): SearchField => ({
  name: `聯絡人 ${key}`,
  seed: async (tx, value) => {
    const data = { tenantId, displayName: neutral(), phone: neutral(), email: neutral(), [key]: value };
    return (await tx.contact.create({ data })).id;
  },
  search: async (tx, q) => {
    const r = await listContacts(ctxOf(tx, tenantId), { q }, { page: 1, limit: LIMIT }, ALL_CHANNELS);
    return r.contacts.map((c) => c.id);
  },
});

const couponField = (key: 'name' | 'displayCode'): SearchField => ({
  name: `優惠券列表 ${key}`,
  seed: async (tx, value) => {
    const data = { tenantId, createdById: agentId, name: neutral(), displayCode: neutral(), [key]: value };
    return (await tx.coupon.create({ data })).id;
  },
  search: async (tx, q) => {
    const r = await listCoupons(ctxOf(tx, tenantId), { q, limit: LIMIT });
    return r.items.map((c) => c.id);
  },
});

const instanceSetup = async (tx: Tx, state: Record<string, string>) => {
  state.couponId = (await tx.coupon.create({
    data: { tenantId, createdById: agentId, name: neutral(), displayCode: neutral() },
  })).id;
};
const instanceSearch = async (tx: Tx, q: string, state: Record<string, string>) => {
  const r = await listInstances(ctxOf(tx, tenantId), state.couponId, { q, limit: 200 });
  return r.items.map((i) => i.id);
};

/** 券序號走原生 SQL `LIKE`（先去掉連字號與空白並轉大寫） */
const instanceCodeField: SearchField = {
  name: '優惠券序號 code（原生 SQL）',
  setup: instanceSetup,
  seed: async (tx, value, state) =>
    (await tx.couponInstance.create({ data: { tenantId, couponId: state.couponId, code: value } })).id,
  search: instanceSearch,
};

const instanceContactField: SearchField = {
  name: '優惠券序號 顧客名稱',
  setup: instanceSetup,
  seed: async (tx, value, state) => {
    const contact = await tx.contact.create({ data: { tenantId, displayName: value } });
    return (await tx.couponInstance.create({
      data: { tenantId, couponId: state.couponId, code: neutral(), contactId: contact.id },
    })).id;
  },
  search: instanceSearch,
};

const articleField = (key: 'title' | 'summary' | 'content'): SearchField => ({
  name: `知識庫 ${key}`,
  seed: async (tx, value) => {
    const data = {
      tenantId, createdById: agentId, category: 'test',
      title: neutral(), summary: neutral(), content: neutral(), [key]: value,
    };
    return (await tx.kmArticle.create({ data })).id;
  },
  search: async (tx, q) => {
    const r = await listArticles(ctxOf(tx, tenantId), { q, page: 1, limit: LIMIT });
    return r.articles.map((a) => a.id);
  },
});

const templateField = (key: 'name' | 'description'): SearchField => ({
  name: `行銷範本 ${key}`,
  seed: async (tx, value) => {
    const data = {
      tenantId, category: 'test', contentType: 'text', body: {},
      name: neutral(), description: neutral(), [key]: value,
    };
    return (await tx.messageTemplate.create({ data })).id;
  },
  search: async (tx, q) => {
    const r = await listTemplates(tx, tenantId, { q, limit: LIMIT });
    return r.templates.map((t) => t.id);
  },
});

const materialField = (key: 'name' | 'description'): SearchField => ({
  name: `素材庫 ${key}`,
  seed: async (tx, value) => {
    const data = {
      tenantId, channelType: 'LINE', contentType: 'text', body: {},
      name: neutral(), description: neutral(), [key]: value,
    };
    return (await tx.material.create({ data })).id;
  },
  search: async (tx, q) => {
    const r = await listMaterials(tx, tenantId, { q, limit: LIMIT });
    return r.items.map((m) => m.id);
  },
});

const shortLinkField = (key: 'title' | 'slug' | 'targetUrl'): SearchField => ({
  name: `短連結 ${key}`,
  seed: async (tx, value) => {
    const data = {
      tenantId, createdById: agentId,
      title: neutral(), slug: neutral(), targetUrl: `https://example.com/${neutral()}`, [key]: value,
    };
    return (await tx.shortLink.create({ data })).id;
  },
  search: async (tx, q) => {
    const r = await listShortLinks(ctxOf(tx, tenantId), { q, limit: LIMIT });
    return r.items.map((l) => l.id);
  },
});

const fields: SearchField[] = [
  contactField('displayName'),
  contactField('phone'),
  contactField('email'),
  couponField('name'),
  couponField('displayCode'),
  instanceCodeField,
  instanceContactField,
  articleField('title'),
  articleField('summary'),
  articleField('content'),
  templateField('name'),
  templateField('description'),
  materialField('name'),
  materialField('description'),
  shortLinkField('title'),
  shortLinkField('slug'),
  shortLinkField('targetUrl'),
];

describe.each(fields)('$name 搜尋把 % _ \\ 當成一般文字', (field) => {
  it('搜 a_1 不命中 ab1（大寫搜尋仍不分大小寫）', async () => {
    const hits = await searchSeeded(field, [`${MARK}a_1`, `${MARK}ab1`], `${MARK}A_1`);
    assert.deepEqual(hits, [0]);
  });

  it('搜 % 只列出含 % 的資料，不會列出全部', async () => {
    const hits = await searchSeeded(field, [`${MARK}50%off`, `${MARK}plain`], '%');
    assert.deepEqual(hits, [0]);
  });

  it('搜含反斜線的字串命中原字串，不把反斜線當跳脫字元', async () => {
    const hits = await searchSeeded(field, [`${MARK}C:\\dir`, `${MARK}C:dirz`], `${MARK}C:\\dir`);
    assert.deepEqual(hits, [0]);
  });
});

it('聯絡人 email：搜 a_b@x.com 不命中 axb@x.com', async () => {
  const hits = await searchSeeded(contactField('email'), [`${MARK}a_b@x.com`, `${MARK}axb@x.com`], `${MARK}a_b@x.com`);
  assert.deepEqual(hits, [0]);
});
