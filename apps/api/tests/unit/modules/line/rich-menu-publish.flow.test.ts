/**
 * 圖文選單發布的補償、預設與展開（change migrate-line-tenant-ctx，spec line-rich-menu
 * 「發布在 LINE 上最多建立一次選單」「設預設失敗時保留原本的預設」「圖文選單展開狀態」「Default Rich Menu」）。
 *
 * prisma 以記憶體裡的列模擬，updateMany 照 where 條件比對，所以認領與條件更新照真的行為運作。
 * LINE 以 stub 的 fetch 取代，記錄每一次呼叫。並行與 RLS 見 feature 測試 rich-menu-publish。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { publishRichMenuFlow, unpublishRichMenuFlow } from '#src/modules/line/rich-menu.flow.js';
import { AppError } from '#src/shared/utils/response.js';
import { createFlowLog, mockTransactionPrisma } from '#tests/support/flow-harness.js';

process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

const T = 'a0000000-0000-0000-0000-000000000001';
const CH = 'c0000000-0000-4000-8000-000000000001';
const LINE = 'https://api.line.me';

type Row = Record<string, any>;

/** 支援這個 flow 用到的 where：等於、in、lt、gte、OR、NOT */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    if (key === 'NOT') return !matches(row, cond as Row);
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(row[key]);
      if ('lt' in cond) return row[key] < cond.lt;
      if ('gte' in cond) return row[key] >= cond.gte;
      if ('not' in cond) return row[key] !== cond.not;
    }
    if (cond instanceof Date) return row[key] instanceof Date && row[key].getTime() === cond.getTime();
    return row[key] === cond;
  });
}

let menus: Row[];
let failWrite: ((data: Row) => boolean) | null;
let calls: Array<{ url: string; method: string; body?: any }>;
let lineResponses: Record<string, number>;

function db() {
  const log = createFlowLog();
  const tx = {
    richMenu: {
      // 與 Prisma 相同，回傳複本：之後的 updateMany 不會改到呼叫端手上的物件
      findFirst: async ({ where }: { where: Row }) => {
        const found = menus.find((m) => matches(m, where));
        return found ? { ...found } : null;
      },
      count: async ({ where }: { where: Row }) => menus.filter((m) => matches(m, where)).length,
      findMany: async ({ where }: { where: Row }) => menus.filter((m) => matches(m, where)),
      update: async ({ where, data }: { where: Row; data: Row }) => {
        if (failWrite?.(data)) throw new Error('database down');
        const m = menus.find((r) => r.id === where.id)!;
        return Object.assign(m, data);
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (failWrite?.(data)) throw new Error('database down');
        const rows = menus.filter((m) => matches(m, where));
        // 與 Prisma 的 @updatedAt 相同：data 有寫 updatedAt 時用寫入的值
        for (const m of rows) Object.assign(m, { updatedAt: new Date() }, data);
        return { count: rows.length };
      },
    },
    channel: {
      findFirst: async () => ({
        id: CH,
        tenantId: T,
        channelType: 'LINE',
        credentialsEncrypted: encryptCredentials({ channelAccessToken: 'token' }),
      }),
    },
  };
  return { prisma: mockTransactionPrisma(log, tx), log };
}

function menu(data: Row): Row {
  return {
    id: 'rm-new',
    tenantId: T,
    channelId: CH,
    name: '新選單',
    chatBarText: '選單',
    size: { width: 2500, height: 843 },
    areas: [],
    imageUrl: 'https://img.example.test/menu.png',
    selected: true,
    isDefault: false,
    status: 'draft',
    lineRichMenuId: null,
    publishedAt: null,
    updatedAt: new Date(),
    ...data,
  };
}

const oldDefault = () => menu({ id: 'rm-old', isDefault: true, status: 'published', lineRichMenuId: 'line-old' });

beforeEach(() => {
  menus = [];
  failWrite = null;
  calls = [];
  lineResponses = {};
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: unknown }) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const status = lineResponses[`${method} ${url}`] ?? 200;
    if (url === 'https://img.example.test/menu.png') {
      return new Response(new Uint8Array([1, 2, 3]), { status, headers: { 'content-type': 'image/png' } });
    }
    if (url === `${LINE}/v2/bot/richmenu` && method === 'POST' && status === 200) {
      return new Response(JSON.stringify({ richMenuId: 'line-new' }), { status });
    }
    return new Response('{}', { status });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const called = (method: string, url: string) => calls.some((c) => c.method === method && c.url === url);
const CREATE = `${LINE}/v2/bot/richmenu`;
const UPLOAD = 'https://api-data.line.me/v2/bot/richmenu/line-new/content';
const SET_NEW_DEFAULT = `${LINE}/v2/bot/user/all/richmenu/line-new`;
const SET_OLD_DEFAULT = `${LINE}/v2/bot/user/all/richmenu/line-old`;
const CANCEL_DEFAULT = `${LINE}/v2/bot/user/all/richmenu`;
const DELETE_NEW = `${LINE}/v2/bot/richmenu/line-new`;
const row = (id: string) => menus.find((m) => m.id === id)!;

async function publish() {
  const { prisma } = db();
  return publishRichMenuFlow({ prisma }, T, 'rm-new');
}

test('上傳背景圖失敗：刪除剛建立的 LINE 選單，status 是 error，lineRichMenuId 是 null', async () => {
  menus = [menu({})];
  lineResponses[`POST ${UPLOAD}`] = 400;

  await assert.rejects(publish(), (err: unknown) => err instanceof AppError && err.code === 'LINE_API_ERROR' && err.statusCode === 400);
  assert.ok(called('DELETE', DELETE_NEW), '沒有刪除 LINE 選單');
  assert.equal(row('rm-new').status, 'error');
  assert.equal(row('rm-new').lineRichMenuId, null);
});

test('寫入發布結果失敗：刪除 LINE 選單，還沒設預設，不必設回舊預設', async () => {
  menus = [menu({ isDefault: true }), oldDefault()];
  failWrite = (data) => data.status === 'published';

  await assert.rejects(publish());
  assert.equal(called('POST', SET_NEW_DEFAULT), false, '寫入發布結果之前不能設預設');
  assert.equal(called('POST', SET_OLD_DEFAULT), false);
  assert.ok(called('DELETE', DELETE_NEW), '沒有刪除 LINE 選單');
  assert.notEqual(row('rm-new').status, 'published');
  assert.equal(row('rm-old').isDefault, true);
});

test('設預設成功、寫入預設失敗：仍是已發布，不刪除也不設回，記成非預設並回 DEFAULT_NOT_SET', async () => {
  menus = [menu({ isDefault: true }), oldDefault()];
  failWrite = (data) => data.isDefault === true;

  const result = await publish();
  assert.ok(called('POST', SET_NEW_DEFAULT));
  assert.equal(called('POST', SET_OLD_DEFAULT), false);
  assert.equal(called('DELETE', DELETE_NEW), false);
  assert.equal(result.status, 'published');
  assert.equal(result.isDefault, false);
  assert.deepEqual(result.warnings, ['DEFAULT_NOT_SET']);
  assert.equal(row('rm-new').status, 'published');
  assert.equal(row('rm-new').isDefault, false);
  assert.equal(row('rm-old').isDefault, true);
});

test('建立選單失敗：status 是 error，不呼叫刪除', async () => {
  menus = [menu({})];
  lineResponses[`POST ${CREATE}`] = 500;

  await assert.rejects(publish(), (err: unknown) => err instanceof AppError && err.code === 'LINE_API_ERROR' && err.statusCode === 400);
  assert.equal(row('rm-new').status, 'error');
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0);
});

test('背景圖下載失敗：不呼叫 LINE，狀態回到發布前', async () => {
  menus = [menu({})];
  lineResponses['GET https://img.example.test/menu.png'] = 404;

  await assert.rejects(publish(), (err: unknown) => err instanceof AppError && err.code === 'IMAGE_FETCH_FAILED');
  assert.equal(row('rm-new').status, 'draft');
  assert.equal(called('POST', CREATE), false);
});

test('重新發布失敗的選單：status=error 的選單發布成功', async () => {
  menus = [menu({ status: 'error' })];
  const result = await publish();
  assert.equal(result.status, 'published');
  assert.equal(row('rm-new').lineRichMenuId, 'line-new');
});

test('Set default：不呼叫取消全體預設，同渠道其他選單 isDefault=false', async () => {
  menus = [menu({ isDefault: true }), oldDefault()];
  await publish();
  assert.ok(called('POST', SET_NEW_DEFAULT));
  assert.equal(called('DELETE', CANCEL_DEFAULT), false);
  assert.equal(row('rm-old').isDefault, false);
});

test('設預設失敗：新選單 isDefault=false，舊選單不變，warnings 含 DEFAULT_NOT_SET', async () => {
  menus = [menu({ isDefault: true }), oldDefault()];
  lineResponses[`POST ${SET_NEW_DEFAULT}`] = 500;

  const result = await publish();
  assert.equal(result.status, 'published');
  assert.equal(result.isDefault, false);
  assert.deepEqual(result.warnings, ['DEFAULT_NOT_SET']);
  assert.equal(row('rm-old').isDefault, true);
  assert.equal(called('DELETE', CANCEL_DEFAULT), false);
});

test('設預設成功：isDefault=true，沒有 DEFAULT_NOT_SET', async () => {
  menus = [menu({ isDefault: true })];
  const result = await publish();
  assert.equal(result.isDefault, true);
  assert.deepEqual(result.warnings, []);
});

test('預設選單設為收合：LINE 建立選單的 selected 是 false，仍設成預設', async () => {
  menus = [menu({ isDefault: true, selected: false })];
  await publish();
  assert.equal(calls.find((c) => c.url === CREATE)?.body.selected, false);
  assert.ok(called('POST', SET_NEW_DEFAULT));
});

test('非預設選單設為展開：LINE 建立選單的 selected 是 true，不呼叫設預設', async () => {
  menus = [menu({ isDefault: false, selected: true })];
  await publish();
  assert.equal(calls.find((c) => c.url === CREATE)?.body.selected, true);
  assert.equal(called('POST', SET_NEW_DEFAULT), false);
});

// ── 取消發布（design D5） ──

const GET_DEFAULT = `${LINE}/v2/bot/user/all/richmenu`;
const DELETE_PUBLISHED = `${LINE}/v2/bot/richmenu/line-x`;
const published = (data: Row = {}) => menu({ status: 'published', lineRichMenuId: 'line-x', publishedAt: new Date(), ...data });

function stubCurrentDefault(lineId: string | null) {
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
    if (url === GET_DEFAULT && (init?.method ?? 'GET') === 'GET') {
      calls.push({ url, method: 'GET' });
      return lineId
        ? new Response(JSON.stringify({ richMenuId: lineId }), { status: 200 })
        : new Response('{}', { status: 404 });
    }
    return original(url, init as never);
  });
}

async function unpublish() {
  const { prisma } = db();
  return unpublishRichMenuFlow({ prisma }, T, 'rm-new');
}

test('Cancel default：LINE 目前的預設是這個選單時取消預設', async () => {
  menus = [published({ isDefault: true })];
  stubCurrentDefault('line-x');
  await unpublish();
  assert.ok(called('DELETE', CANCEL_DEFAULT));
  assert.equal(row('rm-new').status, 'draft');
});

test('取消發布時 LINE 的預設是別的選單：不取消預設', async () => {
  menus = [published({ isDefault: true })];
  stubCurrentDefault('line-other');
  await unpublish();
  assert.equal(called('DELETE', CANCEL_DEFAULT), false);
  assert.ok(called('DELETE', DELETE_PUBLISHED));
  assert.equal(row('rm-new').status, 'draft');
});

test('取消發布非預設的選單：不查也不取消 LINE 的預設', async () => {
  menus = [published({ isDefault: false })];
  await unpublish();
  assert.equal(called('GET', GET_DEFAULT), false);
  assert.equal(called('DELETE', CANCEL_DEFAULT), false);
});

test('取消發布時 LINE 刪除回 404：仍寫回 draft，清空 LINE 的 id', async () => {
  menus = [published()];
  lineResponses[`DELETE ${DELETE_PUBLISHED}`] = 404;
  const result = await unpublish();
  assert.equal(result.status, 'draft');
  assert.equal(row('rm-new').lineRichMenuId, null);
});

test('取消發布保留 isDefault：重新發布時仍會設成預設', async () => {
  menus = [published({ isDefault: true })];
  stubCurrentDefault('line-x');
  await unpublish();
  assert.equal(row('rm-new').isDefault, true);
});

test('另一個取消發布先完成：寫回的條件不成立時回傳目前的選單，不丟錯誤', async () => {
  menus = [published()];
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
    // LINE 刪除期間，另一個請求已把選單寫回 draft
    if (url === DELETE_PUBLISHED) Object.assign(row('rm-new'), { status: 'draft', lineRichMenuId: null });
    return original(url, init as never);
  });
  const result = await unpublish();
  assert.equal(result.status, 'draft');
});
