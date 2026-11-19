/**
 * 手冊第 18 章「優惠券」後台畫面的截圖與影片（新版 UI）。
 *
 * ⚠️ UAT 就是正式環境：只開表單、填示範文字、用框線指出送出按鈕，然後按「取消」或離開；
 *   不建立、不儲存、不發布、不發送。guardWrites（startRecording／newShotPage 內建）擋下所有非 GET 請求。
 *   唯一例外是「ch18 截圖：帳號已建立與核銷台」：使用者授權建立門市「示範：信義門市」與一個核銷帳號
 *   （已存在就沿用、重設密碼），以及核銷台登入；查券、核銷、今日紀錄都在瀏覽器端回覆示範資料。
 *
 * 示範資料：錄製用的示範帳戶（admin@open333crm.dev）只有一張已結束的券、沒有門市，
 *   所以優惠券與門市相關的 GET 回應改由本檔的示範資料（名稱都標「示範」）在瀏覽器端回覆，
 *   不寫入伺服器。只攔 GET；其他方法一律交回 guardWrites 處理。
 *
 * 保留舊檔、不在這裡重拍的項目：顧客手機畫面、LINE／FB 聊天室、
 *   收件匣對話發券（示範帳戶沒有由真人接手的對話，接管是寫入）。
 *
 * 跑法：npx playwright test --config=playwright.shots.config.ts tests/manual-ch18.spec.ts
 */
import { test, Page, Locator, BrowserContext, Browser } from '@playwright/test';
import * as path from 'path';
import { randomInt } from 'crypto';
import {
  startRecording, stopRecording, poster, caption, point, tap, typeIn, go, newShotPage, guardWrites, Recorder,
} from './manual-video-helpers';
import { BASE_URL, SHOTS_DIR, sanitize } from './manual-helpers';

test.describe.configure({ mode: 'serial' });

// ─── 示範資料 ────────────────────────────────────────────────────────────────

const ID = {
  autumn: 'c0ffee00-0000-4000-8000-000000000001',
  service: 'c0ffee00-0000-4000-8000-000000000002',
  welcome: 'c0ffee00-0000-4000-8000-000000000003',
  exchange: 'c0ffee00-0000-4000-8000-000000000004',
  gift: 'c0ffee00-0000-4000-8000-000000000005',
  summer: 'c0ffee00-0000-4000-8000-000000000006',
  storeA: 'c0ffee00-0000-4000-8000-0000000000a1',
  storeB: 'c0ffee00-0000-4000-8000-0000000000a2',
  account: 'c0ffee00-0000-4000-8000-0000000000b1',
  link: 'c0ffee00-0000-4000-8000-0000000000c1',
  lineChannel: 'c0ffee00-0000-4000-8000-0000000000d1',
  fbLink: 'c0ffee00-0000-4000-8000-0000000000c2',
  fbChannel: 'c0ffee00-0000-4000-8000-0000000000d2',
};

const BASE_COUPON = {
  tenantId: 'demo', description: null, terms: '限直營門市使用\n不得與其他優惠併用', imageUrl: null,
  couponType: 'DISCOUNT_AMOUNT', purpose: 'MARKETING', discountAmount: 50, discountPercent: null, minSpend: 500,
  percentCap: null, giftName: null, giftQty: null, exchangeItem: null, exchangeValueCap: null,
  validityMode: 'AFTER_CLAIM', startAt: null, endAt: null, afterClaimDays: 30, afterOpenMinutes: null,
  codeMode: 'UNIQUE_CODE', sharedCode: null, codePrefix: 'DEMO', redeemMode: 'STAFF_SCAN', staffCode: null,
  totalLimit: 500, perContactLimit: 1, claimTagId: null, claimTagTtlDays: null, maskCodeBeforeStart: true,
  status: 'ACTIVE', createdById: 'demo', createdAt: '2026-11-01T02:00:00.000Z', updatedAt: '2026-11-10T02:00:00.000Z',
};

const COUPONS = [
  { ...BASE_COUPON, id: ID.autumn, displayCode: 'CP-DEMO01', name: '示範：秋季感謝祭 NT$50 折價券', issuedCount: 128, claimedCount: 96, redeemedCount: 41 },
  { ...BASE_COUPON, id: ID.service, displayCode: 'CP-DEMO02', name: '示範：客服補償 NT$100 折價券', purpose: 'SERVICE', discountAmount: 100, minSpend: 0, redeemMode: 'STAFF_CODE', totalLimit: null, issuedCount: 23, claimedCount: 20, redeemedCount: 12 },
  { ...BASE_COUPON, id: ID.welcome, displayCode: 'CP-DEMO03', name: '示範：新朋友 9 折券', couponType: 'DISCOUNT_PERCENT', discountAmount: null, discountPercent: 10, percentCap: 200, minSpend: null, redeemMode: 'SELF', totalLimit: 1000, issuedCount: 54, claimedCount: 50, redeemedCount: 18 },
  { ...BASE_COUPON, id: ID.exchange, displayCode: 'CP-DEMO04', name: '示範：冷氣清洗兌換券', couponType: 'EXCHANGE', discountAmount: null, minSpend: null, exchangeItem: '冷氣免費清洗一次', exchangeValueCap: 1500, status: 'PAUSED', totalLimit: 100, issuedCount: 30, claimedCount: 27, redeemedCount: 9 },
  { ...BASE_COUPON, id: ID.gift, displayCode: 'CP-DEMO05', name: '示範：週年慶贈品券', couponType: 'GIFT', discountAmount: null, minSpend: null, giftName: '電鍋專用蒸架', giftQty: 1, status: 'DRAFT', totalLimit: 300, issuedCount: 0, claimedCount: 0, redeemedCount: 0 },
  { ...BASE_COUPON, id: ID.summer, displayCode: 'CP-DEMO06', name: '示範：夏季檔期折價券', validityMode: 'FIXED', afterClaimDays: null, startAt: '2026-07-01T00:00:00.000Z', endAt: '2026-08-31T15:59:59.000Z', status: 'ENDED', issuedCount: 210, claimedCount: 180, redeemedCount: 97 },
];

const STATUS_COUNTS = COUPONS.reduce(
  (acc, c) => ({ ...acc, [c.status]: (acc as Record<string, number>)[c.status] + 1 }),
  { ALL: COUPONS.length, ACTIVE: 0, PAUSED: 0, DRAFT: 0, ENDED: 0 } as Record<string, number>,
);

const NAMES = ['示範顧客 A', '示範顧客 B', '示範顧客 C', '示範顧客 D', '示範顧客 E', '示範顧客 F'];
const VIA: [string, string | null, string | null][] = [
  ['broadcast', '秋季感謝祭廣播', null],
  ['keyword', '領券關鍵字', null],
  ['claim_link', '門市海報', null],
  ['follow', '加好友禮', null],
  ['manual', null, '示範座席'],
  ['batch', '批次發放', '示範座席'],
];
const STATUSES = ['REDEEMED', 'CLAIMED', 'OPENED', 'CLAIMED', 'REDEEMED', 'ISSUED'];
function instances(couponId: string) {
  return NAMES.map((name, i) => ({
    id: `c0ffee00-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
    couponId,
    code: `DEMO-${['6NPMUURK9K', 'H3QX7PZ2TA', 'K8W4MN5RCE', 'P2LD9VB6YF', 'R7TJ3QH8XG', 'W5FC2KN4MU'][i]}`,
    status: STATUSES[i],
    issuedAt: `2026-11-1${i}T03:20:00.000Z`,
    claimedAt: STATUSES[i] === 'ISSUED' ? null : `2026-11-1${i}T03:25:00.000Z`,
    openedAt: null,
    redeemedAt: STATUSES[i] === 'REDEEMED' ? `2026-11-1${i + 1}T06:10:00.000Z` : null,
    issuedVia: VIA[i][0],
    issuedSourceName: VIA[i][1],
    issuedByName: VIA[i][2],
    redeemChannel: STATUSES[i] === 'REDEEMED' ? 'staff_console' : null,
    contact: { id: `c0ffee00-0000-4000-8000-0000000002${String(i).padStart(2, '0')}`, displayName: name },
  }));
}

const STORES = [
  {
    id: ID.storeA, name: '示範門市', isActive: true, createdAt: '2026-10-01T02:00:00.000Z',
    accounts: [{ id: ID.account, storeId: ID.storeA, username: 'demo-store-01', canRedeem: true, isActive: true, lockedUntil: null, lastLoginAt: '2026-11-18T09:30:00.000Z', createdAt: '2026-10-01T02:00:00.000Z' }],
  },
  { id: ID.storeB, name: '內湖門市', isActive: true, createdAt: '2026-11-19T02:00:00.000Z', accounts: [] },
];

const CLAIM_LINKS = [
  {
    id: ID.link, couponId: ID.autumn, name: '門市海報', code: 'DEMO2026', status: 'ACTIVE', startAt: null, endAt: null,
    openCount: 36, claimCount: 21, createdAt: '2026-11-05T02:00:00.000Z',
    url: `${BASE_URL}/claim/DEMO2026`,
    channel: { id: ID.lineChannel, channelType: 'LINE', displayName: 'LINE OA', ready: true },
  },
  {
    id: ID.fbLink, couponId: ID.autumn, name: '粉專置頂貼文', code: 'DEMOFB26', status: 'ACTIVE', startAt: null, endAt: null,
    openCount: 18, claimCount: 9, createdAt: '2026-11-06T02:00:00.000Z',
    url: `${BASE_URL}/claim/DEMOFB26`,
    channel: { id: ID.fbChannel, channelType: 'FB', displayName: 'Open333test', ready: true },
  },
];

const BATCH = [
  {
    id: 'c0ffee00-0000-4000-8000-0000000000e1', name: '批次發放 2026-11-12', status: 'completed', couponIssuedVia: 'batch',
    couponIssuedByName: '示範座席', totalCount: 12, couponIssuedCount: 12, failureReason: null, failureCode: null,
    createdAt: '2026-11-12T03:00:00.000Z', summary: { issued: 12, pending: 0, skipped: {}, failed: {} },
  },
];

const DEMO_CONTACTS = [
  { id: 'c0ffee00-0000-4000-8000-000000000301', displayName: '示範顧客 王先生', phone: null, email: null },
  { id: 'c0ffee00-0000-4000-8000-000000000302', displayName: '示範顧客 王小姐', phone: null, email: null },
  { id: 'c0ffee00-0000-4000-8000-000000000303', displayName: '示範顧客 王大明', phone: null, email: null },
];

/** 含 {{coupon.url}} 的示範素材：附加在真實素材清單前面 */
const COUPON_URL_MATERIAL = {
  id: 'c0ffee00-0000-4000-8000-000000000401', tenantId: 'demo', templateId: null, name: '示範：秋季感謝祭（含券連結）',
  description: null, category: null, categoryId: null, tags: [], status: 'draft', channelType: 'line', contentType: 'line_text',
  body: { text: '秋季感謝祭！點這裡領取你的專屬優惠券：{{coupon.url}}' }, maskedBody: null, privacyMode: 'original',
  variables: [], targetChannels: [], previewImageUrl: null, isActive: true, usageCount: 0, lastUsedAt: null,
  createdById: 'demo', createdAt: '2026-11-10T02:00:00.000Z', updatedAt: '2026-11-10T02:00:00.000Z', template: null, materialCategory: null,
};

/** 海報上的示範 QR 圖（只是方格圖樣，錄影時圖片本來就會模糊；不依賴未宣告的 qrcode 套件） */
const DEMO_QR = (() => {
  const n = 25;
  let cells = '';
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const finder = (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
      if (finder ? (x % 6 === 0 || y % 6 === 0 || (x % 6 >= 2 && x % 6 <= 4 && y % 6 >= 2 && y % 6 <= 4)) : (x * 7 + y * 13 + x * y) % 3 === 0) {
        cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${n + 2} ${n + 2}"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/>${cells}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
})();

const json = (data: unknown, meta?: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(meta ? { success: true, data, meta } : { success: true, data }),
});

/** 只回覆 GET；其他方法 fallback 給 guardWrites（後註冊先處理，所以這條要在 guardWrites 之後註冊） */
async function mockDemo(context: BrowserContext) {
  const qr = DEMO_QR;
  await context.route('**/api/v1/**', async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') return route.fallback();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^.*\/api\/v1/, '');
    const q = url.searchParams;
    let m: RegExpMatchArray | null;

    if (p === '/coupons') {
      let rows = COUPONS;
      if (q.get('status')) rows = rows.filter((c) => c.status === q.get('status'));
      if (q.get('purpose')) rows = rows.filter((c) => c.purpose === q.get('purpose'));
      if (q.get('q')) rows = rows.filter((c) => c.name.includes(q.get('q')!) || c.displayCode.includes(q.get('q')!));
      return route.fulfill(json(rows, { total: rows.length, page: 1, limit: 100, totalPages: 1, statusCounts: STATUS_COUNTS }));
    }
    if ((m = p.match(/^\/coupons\/(c0ffee00-[0-9a-f-]+)$/))) {
      return route.fulfill(json(COUPONS.find((c) => c.id === m![1]) ?? COUPONS[0]));
    }
    if ((m = p.match(/^\/coupons\/(c0ffee00-[0-9a-f-]+)\/stats$/))) {
      const c = COUPONS.find((x) => x.id === m![1]) ?? COUPONS[0];
      return route.fulfill(json({
        couponId: c.id, poolSize: null, issued: c.issuedCount, claimed: c.claimedCount, opened: Math.round(c.claimedCount * 0.8),
        redeemed: c.redeemedCount, expired: 0, revoked: 0, pendingClaim: c.issuedCount - c.claimedCount,
        linkOpened: Math.round(c.issuedCount * 0.85),
        claimRate: c.issuedCount ? Math.round((c.claimedCount / c.issuedCount) * 1000) / 10 : null,
        redeemRate: c.claimedCount ? Math.round((c.redeemedCount / c.claimedCount) * 1000) / 10 : null,
      }));
    }
    if ((m = p.match(/^\/coupons\/(c0ffee00-[0-9a-f-]+)\/instances$/))) {
      let rows = instances(m[1]);
      const kw = q.get('q');
      if (kw) rows = rows.filter((r) => r.code.includes(kw.toUpperCase()) || r.contact.displayName.includes(kw));
      if (q.get('status')) rows = rows.filter((r) => r.status === q.get('status'));
      return route.fulfill(json(rows, { total: rows.length, page: 1, limit: 50 }));
    }
    if (/^\/coupons\/c0ffee00-[0-9a-f-]+\/batch-issues$/.test(p)) return route.fulfill(json(BATCH));
    if (/^\/coupons\/c0ffee00-[0-9a-f-]+\/claim-links$/.test(p)) return route.fulfill(json(CLAIM_LINKS));
    if (p === '/stores') return route.fulfill(json(STORES));
    if ((m = p.match(/^\/stores\/(c0ffee00-[0-9a-f-]+)\/poster$/))) {
      const s = STORES.find((x) => x.id === m![1]) ?? STORES[0];
      return route.fulfill(json({ storeName: s.name, url: `${BASE_URL}/redeem`, shortUrl: `${BASE_URL.replace(/^https?:\/\//, '')}/redeem`, qrDataUrl: qr }));
    }
    if (p === '/contacts' && q.get('q')) return route.fulfill(json(DEMO_CONTACTS, { total: DEMO_CONTACTS.length, page: 1, limit: 20 }));
    if (p === '/marketing/materials' && q.get('isActive') === 'true' && (!q.get('channelType') || q.get('channelType') === 'line')) {
      const res = await route.fetch();
      const body = await res.json();
      body.data = [COUPON_URL_MATERIAL, ...(body.data ?? [])];
      return route.fulfill({ response: res, body: JSON.stringify(body) });
    }
    return route.fallback();
  });
}

/** 藏掉 [E2E] 測試資料、部署驗證資料；模糊領券網址與代碼 */
const TIDY = `(() => {
  const css = 'li[aria-label] .break-all, li[aria-label] .font-mono{filter:blur(5px)!important}';
  const bad = /\\[E2E|部署驗證|個資測試/;
  // 寫入保險擋下「人數預覽」POST 後出現的網路錯誤，是錄影環境造成的，不是真實畫面，藏起來
  const blocked = /網路連線異常|無法確認優惠券名額/;
  const fix = () => {
    // 只藏不刪：刪掉 React 管理的 <option>，之後選項更新時 React removeChild 會整頁出錯
    document.querySelectorAll('option').forEach((o) => { if (bad.test(o.textContent || '')) { o.hidden = true; o.disabled = true; } });
    document.querySelectorAll('tr,[role=row],label').forEach((tr) => { if (bad.test(tr.textContent || '')) tr.style.display = 'none'; });
    document.querySelectorAll('p,div').forEach((el) => {
      if (el.children.length <= 2 && blocked.test(el.textContent || '') && (el.textContent || '').length < 120) el.style.display = 'none';
    });
  };
  const boot = () => {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    fix(); new MutationObserver(fix).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();`;

async function rec(browser: Browser, name: string): Promise<Recorder> {
  const r = await startRecording(browser, name);
  await r.context.addInitScript(TIDY);
  await mockDemo(r.context);
  return r;
}

async function finish(r: Recorder, at = 2) {
  await stopRecording(r);
  poster(r.name, at);
}

/** 截圖：找不到元素直接失敗（共用的 shot() 找不到只印 ✗ 不會讓測試失敗） */
async function snap(page: Page, locator: Locator, name: string) {
  const el = locator.first();
  await el.waitFor({ state: 'visible', timeout: 15_000 });
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(600);
  await sanitize(page);
  await el.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });
  console.log(`✓ ${name}.png`);
}

/** 先清空再逐字輸入（欄位有預設值時用） */
async function typeOver(page: Page, locator: Locator, text: string) {
  await locator.first().fill('');
  await typeIn(page, locator, text);
}

/** 選原生 select 的選項（依選項文字比對） */
async function pick(page: Page, select: Locator, label: RegExp) {
  const value = await select.evaluate((el, src) => {
    const re = new RegExp(src);
    return [...(el as HTMLSelectElement).options].find((o) => re.test(o.text))?.value ?? null;
  }, label.source);
  if (!value) throw new Error(`找不到選項 ${label}`);
  await point(page, select, 500);
  await select.selectOption(value);
  await page.waitForTimeout(1000);
}

// ─── 影片 ─────────────────────────────────────────────────────────────────────

test('ch18-create 建立優惠券', async ({ browser }) => {
  test.setTimeout(180_000);
  const r = await rec(browser, 'ch18-create');
  const { page } = r;
  await go(page, '/dashboard/marketing/coupons');
  await caption(page, '左側選單「行銷 → 優惠券」，按右上角「建立優惠券」');
  await tap(page, page.getByRole('button', { name: '建立優惠券' }), 2000);
  await page.getByRole('heading', { name: '建立優惠券', level: 1 }).waitFor();
  await caption(page, '表單分成七個區塊，右側「設定進度」顯示每塊是否完成', 2600);
  await caption(page, '① 基本資料：券名稱是顧客在票券上看到的名字', 1200);
  await typeIn(page, page.getByLabel('券名稱'), '秋季感謝祭 NT$50 折價券');
  await typeIn(page, page.getByLabel('使用條款'), '限直營門市使用');
  await caption(page, '② 券型與用途：先選券型，下方會出現對應的欄位', 1200);
  await tap(page, page.getByRole('radio', { name: /^元折抵/ }), 800);
  await typeIn(page, page.getByLabel('折抵金額'), '50');
  await typeOver(page, page.getByLabel('最低消費門檻'), '500');
  await caption(page, '用途選「行銷推廣」；要在對話中發券則選「客服補償」', 1200);
  await tap(page, page.getByRole('radio', { name: /^行銷推廣/ }), 800);
  await caption(page, '③ 效期：這裡選「領取後 N 天」，預設 30 天', 1200);
  await tap(page, page.getByRole('radio', { name: /^領取後 N 天/ }), 800);
  await caption(page, '④ 券號：「一人一碼」可以追蹤到每一位顧客', 1200);
  await tap(page, page.getByRole('radio', { name: /^一人一碼/ }), 800);
  await typeIn(page, page.getByLabel('券號前綴'), 'AUTUMN');
  await caption(page, '⑤ 發行控制：限制總量與每人可以領幾張', 1200);
  await typeIn(page, page.getByLabel('發行總量上限'), '500');
  await caption(page, '⑥ 核銷方式：選誰來確認使用', 1200);
  await tap(page, page.getByRole('radio', { name: /^店員用核銷台掃顧客手機上的 QR Code/ }), 800);
  await caption(page, '⑦ 防濫用與自動化：預設兩項都勾選，建議保留', 1200);
  await point(page, page.locator('#coupon-section-guard, section').filter({ hasText: '防濫用與自動化' }).last(), 1600);
  await caption(page, '右側同時算出這張券的「最壞成本」', 1200);
  await point(page, page.getByText('最壞成本').first(), 1600);
  await caption(page, '按「發布優惠券」會先跳出確認視窗；也可以先「儲存草稿」', 2000);
  await point(page, page.getByRole('button', { name: '發布優惠券' }), 1800);
  await caption(page, '示範到這裡，按「取消」離開', 1400);
  await tap(page, page.getByRole('button', { name: '取消', exact: true }).last(), 1500);
  const discard = page.getByRole('button', { name: '放棄建立' });
  if (await discard.isVisible().catch(() => false)) {
    await caption(page, '還沒存檔就離開時會詢問；選「放棄建立」', 1200);
    await tap(page, discard, 1200);
  }
  await finish(r, 3);
});

test('ch18-stores 門市與核銷帳號', async ({ browser }) => {
  test.setTimeout(150_000);
  const r = await rec(browser, 'ch18-stores');
  const { page } = r;
  await go(page, '/dashboard/settings/stores');
  await caption(page, '「設定 → 門市與核銷帳號」：每間門市一張卡片', 2400);
  await caption(page, '按右上角「新增門市」', 800);
  await tap(page, page.getByRole('button', { name: '新增門市' }), 1200);
  await typeIn(page, page.getByLabel('門市名稱'), '信義門市');
  await caption(page, '門市名稱會印在櫃檯海報上；按「新增門市」就建立了', 2000);
  await point(page, page.getByRole('dialog').getByRole('button', { name: /新增|建立/ }).last(), 1400);
  await tap(page, page.getByRole('dialog').getByRole('button', { name: '取消' }), 1000);
  const card = page.getByTestId('store-card').filter({ hasText: '內湖門市' });
  await caption(page, '還沒有帳號的門市會提示「建立帳號後，店員才能登入核銷台」', 2600);
  await point(page, card, 1800);
  await caption(page, '按「新增帳號」，為門市建立店員共用的帳號', 1000);
  await tap(page, card.getByRole('button', { name: '新增帳號' }), 1200);
  await typeIn(page, page.getByLabel('帳號名稱'), 'demo-neihu');
  await caption(page, '密碼可以按「產生隨機密碼」', 1000);
  await tap(page, page.getByRole('button', { name: '產生隨機密碼' }), 800);
  await caption(page, '按「建立帳號」後，密碼只會顯示一次', 2000);
  await point(page, page.getByRole('button', { name: '建立帳號' }), 1400);
  await tap(page, page.getByRole('dialog').getByRole('button', { name: '取消' }), 1000);
  const cardA = page.getByTestId('store-card').filter({ hasText: '示範門市' });
  await caption(page, '按「列印櫃檯海報」，店員用手機掃 QR Code 就能開啟核銷台', 1200);
  await tap(page, cardA.getByRole('button', { name: '列印櫃檯海報' }), 2000);
  await caption(page, 'QR Code 只會開啟登入頁，不含密碼', 2600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await caption(page, '帳號列表的「⋯」可以重設密碼、強制登出、停用或刪除', 2600);
  await point(page, cardA.getByRole('table'), 1600);
  await finish(r);
});

test('ch18-records 券詳情與成效', async ({ browser }) => {
  test.setTimeout(150_000);
  const r = await rec(browser, 'ch18-records');
  const { page } = r;
  await go(page, '/dashboard/marketing/coupons');
  await caption(page, '優惠券列表可以看每張券的發放數、領取數與核銷率', 2600);
  await caption(page, '點一張券進入詳情', 800);
  await tap(page, page.getByRole('row', { name: /秋季感謝祭/ }), 2500);
  await caption(page, '上方是發送、開啟連結、領取、開封、核銷與核銷率', 2800);
  await caption(page, '「序號明細」列出每一張券的顧客、發放來源與狀態', 2600);
  await point(page, page.getByRole('region', { name: '序號明細' }).or(page.getByText('序號明細').last()), 1400);
  await caption(page, '顧客來電詢問時，直接輸入序號查詢', 1000);
  await typeIn(page, page.getByRole('searchbox').or(page.getByPlaceholder(/序號|顧客名稱/)).first(), 'DEMO-6NPM');
  await page.waitForTimeout(1500);
  await point(page, page.getByText('DEMO-6NPMUURK9K', { exact: true }).first(), 1800);
  await caption(page, '也可以依狀態、領取時間、核銷時間篩選，或按「匯出 CSV」', 2600);
  await caption(page, '「設定」分頁可以看這張券的所有設定', 1000);
  await tap(page, page.getByRole('tab', { name: '設定' }), 2000);
  await caption(page, '全部券的成效，在「報表」的「優惠券成效」分頁', 1000);
  await go(page, '/dashboard/analytics');
  await tap(page, page.getByRole('tab', { name: '優惠券成效' }), 2500);
  await caption(page, '期間內的發出、領取、核銷與每日趨勢', 2600);
  await finish(r);
});

test('ch18-batch 批次發券', async ({ browser }) => {
  test.setTimeout(150_000);
  const r = await rec(browser, 'ch18-batch');
  const { page } = r;
  await go(page, `/dashboard/marketing/coupons/${ID.autumn}`);
  await caption(page, '打開一張進行中的券，按右上角「發送給…」', 1000);
  await tap(page, page.getByRole('button', { name: '發送給…' }), 1500);
  const dlg = page.getByRole('dialog');
  await caption(page, '先選渠道', 800);
  await pick(page, dlg.locator('#batch-issue-channel'), /LINE OA/);
  await caption(page, '對象可以搜尋聯絡人勾選、選標籤或分眾，最多 1,000 人', 2400);
  await point(page, dlg.locator('#batch-issue-target'), 1200);
  await typeIn(page, dlg.getByLabel('搜尋聯絡人'), '示範');
  await page.waitForTimeout(1200);
  await caption(page, '在搜尋結果勾選要發的人', 2000);
  await point(page, dlg.locator('ul').first(), 1400);
  await caption(page, '「訊息文字」選填；不填就用預設的發券文字', 1200);
  await typeIn(page, dlg.locator('#batch-issue-message'), '感謝您的支持，送您一張秋季折價券！');
  await caption(page, '勾選後下方顯示「可送達 N 人，剩餘名額 N 張」，確認後按「送出」', 2800);
  await point(page, dlg.getByRole('button', { name: '送出' }), 1600);
  await caption(page, '示範到這裡，按「取消」', 1200);
  await tap(page, dlg.getByRole('button', { name: '取消' }), 1000);
  await caption(page, '送出後，上方的「發放紀錄」會顯示進度與發券張數', 2600);
  await finish(r);
});

test('ch18-keyword 關鍵字發券', async ({ browser }) => {
  test.setTimeout(150_000);
  const r = await rec(browser, 'ch18-keyword');
  const { page } = r;
  await go(page, '/dashboard/line/keyword-replies');
  await caption(page, '「渠道 → 關鍵字回覆」，按「建立關鍵字回覆」', 1000);
  await tap(page, page.getByRole('button', { name: '建立關鍵字回覆' }), 1500);
  const dlg = page.getByRole('dialog', { name: '關鍵字回覆表單' });
  await caption(page, '先選渠道：LINE、Facebook 或 Instagram，儲存後不能改', 2000);
  await point(page, dlg.getByLabel('渠道', { exact: true }), 1200);
  await typeIn(page, dlg.getByLabel('規則名稱'), '領券關鍵字');
  await caption(page, '輸入關鍵字後按 Enter 加入，可以加多個', 1000);
  await typeIn(page, dlg.getByLabel(/^關鍵字/), '領券');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await caption(page, '只想發券時，回覆素材可以不選', 1800);
  await point(page, dlg.getByLabel('回覆素材'), 1200);
  await caption(page, '「同時發送優惠券」選一張進行中的券', 1000);
  await pick(page, dlg.getByLabel('同時發送優惠券'), /秋季感謝祭/);
  await caption(page, '「發不出時回覆顧客」選填，例如已經領過時要回的話', 1200);
  await typeIn(page, dlg.getByLabel('發不出時回覆顧客'), '您已經領過這張券囉，謝謝支持！');
  await caption(page, '按「儲存」就完成了；示範到這裡，按「取消」', 2400);
  await point(page, dlg.getByRole('button', { name: '儲存' }), 1400);
  await tap(page, dlg.getByRole('button', { name: '取消' }), 1000);
  await finish(r);
});

test('ch18-follow-gift 加好友禮', async ({ browser }) => {
  test.setTimeout(120_000);
  const r = await rec(browser, 'ch18-follow-gift');
  const { page } = r;
  await go(page, '/dashboard/line/follow-gift');
  await caption(page, '「渠道 → 加好友禮」：新好友第一次加入就送券', 2200);
  await caption(page, '打開「啟用加好友禮」開關', 800);
  await tap(page, page.getByRole('switch', { name: '啟用加好友禮' }), 1000);
  await caption(page, '發送條件固定為「只發給第一次加入好友的顧客」', 2200);
  await caption(page, '選一張進行中的券', 800);
  await pick(page, page.getByLabel('加好友時發送的優惠券'), /新朋友/);
  await typeIn(page, page.getByLabel('發不出時回覆顧客'), '新朋友禮已經發完了，歡迎關注下一波活動');
  await caption(page, '按「儲存」後就會生效；示範不儲存，直接離開', 2600);
  await point(page, page.getByRole('button', { name: '儲存' }), 1600);
  await finish(r);
});

async function openBroadcastForm(page: Page) {
  await go(page, '/dashboard/marketing/broadcasts');
  await caption(page, '「行銷 → 廣播」，按「建立廣播」', 1000);
  await tap(page, page.getByRole('button', { name: '建立廣播' }), 1500);
  await page.getByRole('heading', { name: '建立廣播', level: 1 }).waitFor();
  return page.getByRole('heading', { name: '建立廣播', level: 1 }).locator('xpath=ancestor::*[.//select][1]');
}

test('ch18-broadcast 附券廣播', async ({ browser }) => {
  test.setTimeout(150_000);
  const r = await rec(browser, 'ch18-broadcast');
  const { page } = r;
  const dlg = await openBroadcastForm(page);
  await typeIn(page, page.getByRole('textbox', { name: '廣播名稱' }), '秋季感謝祭 附券廣播');
  await caption(page, '選渠道', 800);
  await pick(page, dlg.locator('select').first(), /LINE OA/);
  await caption(page, '附券時素材可以不選，顧客會收到預設的發券文字與券連結', 2400);
  await caption(page, '受眾選「依標籤篩選」，勾選要發的標籤', 1000);
  await pick(page, dlg.locator('select', { has: page.locator('option', { hasText: '依標籤篩選' }) }), /依標籤篩選/);
  const vip = dlg.getByText('VIP', { exact: true });
  if (await vip.isVisible().catch(() => false)) await tap(page, vip, 800);
  await caption(page, '下方會顯示符合條件的人數，請確認人數再發送', 2200);
  await caption(page, '「附上優惠券」選一張進行中的行銷券', 1000);
  await pick(page, dlg.getByLabel('附上優惠券（選填）'), /秋季感謝祭/);
  await caption(page, '下方會顯示剩餘名額；名額不夠時要勾選確認才能建立', 2600);
  await caption(page, '按「建立」先存成草稿，再到列表按「立即發送」', 2600);
  await point(page, page.getByRole('button', { name: '建立', exact: true }), 1400);
  await caption(page, '示範到這裡，按「取消」', 1000);
  await tap(page, page.getByRole('button', { name: '取消', exact: true }), 1000);
  await finish(r);
});

test('ch18-broadcast-url 素材含券連結的附券廣播', async ({ browser }) => {
  test.setTimeout(150_000);
  const r = await rec(browser, 'ch18-broadcast-url');
  const { page } = r;
  const dlg = await openBroadcastForm(page);
  await typeIn(page, page.getByRole('textbox', { name: '廣播名稱' }), '秋季感謝祭 券連結廣播');
  await pick(page, dlg.locator('select').first(), /LINE OA/);
  await caption(page, '選一個放了顧客專屬券連結 {{coupon.url}} 的素材', 1000);
  await pick(page, dlg.locator('select', { has: page.locator('option', { hasText: '含券連結' }) }), /含券連結/);
  await caption(page, '還沒附券時，系統會提醒並停用「建立」', 2600);
  await point(page, dlg.getByText(/請在「附上優惠券」選一張券/).first(), 1400);
  await point(page, page.getByRole('button', { name: '建立', exact: true }), 1000);
  await caption(page, '在「附上優惠券」選一張進行中的券', 1000);
  await pick(page, dlg.getByLabel('附上優惠券（選填）'), /秋季感謝祭/);
  await caption(page, '{{coupon.url}} 會換成每位收件人自己的券連結', 2600);
  await caption(page, '建立後到列表按「立即發送」；完成後按眼睛圖示看發券結果', 2800);
  await caption(page, '示範到這裡，按「取消」', 1000);
  await tap(page, page.getByRole('button', { name: '取消', exact: true }), 1000);
  await finish(r);
});

test('ch18-richmenu-claim 圖文選單領券按鈕', async ({ browser }) => {
  test.setTimeout(180_000);
  const r = await rec(browser, 'ch18-richmenu-claim');
  const { page } = r;
  await go(page, '/dashboard/line/rich-menus');
  await caption(page, '「渠道 → Rich Menu」，先選官方帳號', 1000);
  await pick(page, page.getByLabel('官方帳號'), /LINE OA/);
  await page.waitForTimeout(1200);
  await caption(page, '按「建立 Rich Menu」', 800);
  await tap(page, page.getByRole('button', { name: /建立.*Rich Menu|新增 Rich Menu/ }).first(), 2000);
  await caption(page, '選版型，這裡用小選單的「全寬單格」', 1200);
  await tap(page, page.getByRole('button', { name: /全寬|單格/ }).last(), 2000);
  await typeOver(page, page.getByLabel('名稱', { exact: false }).first(), '領券選單');
  await caption(page, '底部按鈕文字是好友在 LINE 聊天室看到的字', 1000);
  await typeOver(page, page.getByLabel('底部按鈕文字'), '點我領券');
  await caption(page, '先不要勾「設為所有好友的預設選單」', 2000);
  await point(page, page.getByLabel('設為所有好友的預設選單'), 1200);
  await caption(page, '還要上傳符合尺寸的背景圖（JPEG 或 PNG，1 MB 以內）', 2200);
  await caption(page, '區域動作選「開啟網址（uri）」', 1000);
  await pick(page, page.getByLabel('動作類型').first(), /開啟網址/);
  await typeIn(page, page.getByLabel('標籤').first(), '領取優惠券');
  await caption(page, '網址貼上這張券的 LINE 領券連結', 1000);
  await typeIn(page, page.getByRole('textbox', { name: /^網址/ }).first(), 'https://example.com/claim/DEMO2026');
  await caption(page, '按「儲存草稿」，確認無誤後才「發布」；示範到這裡不存檔', 2800);
  await point(page, page.getByRole('button', { name: '儲存草稿' }), 1400);
  await finish(r, 3);
});

// ─── 卡片素材＋領券連結、Facebook 關鍵字發券（新版 UI 重錄，只開表單不存檔）───

const UNBLUR_SAMPLES = `img[src*="material-samples"]{filter:none!important}`;
const CLAIM_URL = `${BASE_URL}/claim/DEMO2026`;
const FB_CLAIM_URL = `${BASE_URL}/claim/DEMOFB26`;

/** 券詳情「領券連結」分頁：指出連結與複製按鈕 */
async function showClaimLink(page: Page, linkName = '門市海報') {
  await go(page, `/dashboard/marketing/coupons/${ID.autumn}`);
  await caption(page, '先在券詳情的「領券連結」分頁建立連結（見 11-5）', 1000);
  await tap(page, page.getByRole('tab', { name: '領券連結' }), 1500);
  await page.getByRole('listitem', { name: linkName }).waitFor();
  await caption(page, '渠道選要推播的那個渠道，按複製圖示複製網址', 2200);
  await point(page, page.getByRole('listitem', { name: linkName }), 1600);
}

async function newMaterial(page: Page, platform: RegExp, type: RegExp) {
  await go(page, '/dashboard/marketing/materials');
  await caption(page, '到「素材庫」，按「從版型建立新素材」', 1000);
  await tap(page, page.getByRole('button', { name: '從版型建立新素材' }), 1800);
  await tap(page, page.getByRole('button', { name: platform }).first(), 1200);
  await tap(page, page.getByRole('button', { name: type }).first(), 1800);
  await page.addStyleTag({ content: UNBLUR_SAMPLES });
}

async function broadcastWithoutCoupon(page: Page, channel: RegExp) {
  const dlg = await openBroadcastForm(page);
  await typeIn(page, page.getByRole('textbox', { name: '廣播名稱' }), '秋季感謝祭 領券卡片');
  await pick(page, dlg.locator('select').first(), channel);
  await caption(page, '素材選剛做好的卡片素材，「附上優惠券」維持「不附券」', 2600);
  await point(page, dlg.getByLabel('附上優惠券（選填）'), 1200);
  await caption(page, '建立後到列表按「立即發送」；示範到這裡，按「取消」', 2400);
  await point(page, page.getByRole('button', { name: '建立', exact: true }), 1200);
  await tap(page, page.getByRole('button', { name: '取消', exact: true }), 1000);
}

test('ch18-card-line LINE 卡片素材連到領券連結', async ({ browser }) => {
  test.setTimeout(180_000);
  const r = await rec(browser, 'ch18-card-line');
  const { page } = r;
  await showClaimLink(page);
  await newMaterial(page, /LINE 官方帳號訊息/, /卡片訊息/);
  await caption(page, 'LINE 選「卡片訊息」，填素材名稱與標題、說明', 1000);
  await typeOver(page, page.getByPlaceholder('如：母親節新品推播'), '秋季感謝祭 領券卡片');
  await typeOver(page, page.getByPlaceholder('輸入標題'), '秋季感謝祭 NT$50 折價券');
  await typeOver(page, page.getByPlaceholder('輸入文字說明'), '點下方按鈕領取，限量 500 張');
  await caption(page, '「動作 1」類型選「網址連結」', 1000);
  const action = page.getByPlaceholder('輸入動作標籤').first().locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]');
  await typeOver(page, page.getByPlaceholder('輸入動作標籤').first(), '領取優惠券');
  await pick(page, action.locator('select').first(), /網址連結/);
  await caption(page, '網址貼上 LINE 的領券連結', 1000);
  await typeOver(page, action.getByPlaceholder(/^https:/), CLAIM_URL);
  await caption(page, '填好按「存為素材」；示範到這裡不存檔', 2200);
  await point(page, page.getByRole('button', { name: '存為素材' }), 1200);
  await tap(page, page.getByRole('button', { name: '取消', exact: true }), 1000);
  await broadcastWithoutCoupon(page, /LINE OA/);
  await finish(r, 3);
});

test('ch18-card-fb Facebook 商品輪播連到領券連結', async ({ browser }) => {
  test.setTimeout(180_000);
  const r = await rec(browser, 'ch18-card-fb');
  const { page } = r;
  await caption(page, 'Facebook 要用渠道是 Facebook 的那條領券連結', 800);
  await showClaimLink(page, '粉專置頂貼文');
  await newMaterial(page, /FB Messenger/, /商品輪播/);
  await caption(page, 'Facebook 選「商品輪播」，填素材名稱與卡片標題', 1000);
  await typeOver(page, page.getByPlaceholder('如：母親節新品推播'), '秋季感謝祭 FB 領券卡片');
  await typeOver(page, page.getByPlaceholder('商品標題').first(), '秋季感謝祭 NT$50 折價券');
  await typeOver(page, page.getByPlaceholder('副標題（選填）').first(), '點下方按鈕領取，限量 500 張');
  await caption(page, '按鈕選「開啟網址」，網址貼上 Facebook 的領券連結', 1200);
  const btnType = page.getByLabel('第 1 顆按鈕的類型').first();
  const btnRow = btnType.locator('xpath=..');
  await pick(page, btnType, /開啟網址/);
  await typeOver(page, btnRow.getByPlaceholder('按鈕文字'), '領取優惠券');
  // 「網址」要找按鈕這一列的，卡片上方還有一個圖片網址欄
  await typeOver(page, btnRow.getByPlaceholder('網址', { exact: true }), FB_CLAIM_URL);
  await caption(page, '多餘的卡片按垃圾桶刪掉，填好按「存為素材」；示範到這裡不存檔', 2600);
  await point(page, page.getByRole('button', { name: '存為素材' }), 1200);
  await tap(page, page.getByRole('button', { name: '取消', exact: true }), 1000);
  await broadcastWithoutCoupon(page, /Open333test/);
  await finish(r, 3);
});

test('ch18-keyword-fb Facebook 關鍵字發券', async ({ browser }) => {
  test.setTimeout(150_000);
  // 這支用 UAT 示範租戶的真實示範資料（券「示範：秋季折價券」），不套 mockDemo
  const r = await startRecording(browser, 'ch18-keyword-fb');
  await r.context.addInitScript(TIDY);
  const { page } = r;
  await go(page, '/dashboard/line/keyword-replies');
  await caption(page, '「渠道 → 關鍵字回覆」，上方可以依渠道篩選', 1000);
  await tap(page, page.getByRole('button', { name: 'Facebook', exact: true }), 1600);
  await caption(page, '按「建立關鍵字回覆」', 800);
  await tap(page, page.getByRole('button', { name: '建立關鍵字回覆' }), 1500);
  const dlg = page.getByRole('dialog', { name: '關鍵字回覆表單' });
  await caption(page, '渠道選「Facebook」，規則只在 Facebook 的對話觸發', 1200);
  await pick(page, dlg.getByLabel('渠道', { exact: true }), /Facebook/);
  await typeIn(page, dlg.getByLabel('規則名稱'), '粉專領券');
  await typeIn(page, dlg.getByLabel(/^關鍵字/), '粉專優惠');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await caption(page, '素材只列出 Facebook 的素材；只發券時可以不選', 2000);
  await point(page, dlg.getByLabel('回覆素材'), 1200);
  await caption(page, '「同時發送優惠券」選一張進行中的券', 1000);
  await pick(page, dlg.getByLabel('同時發送優惠券'), /示範：秋季折價券/);
  await caption(page, '按「儲存」就完成了；示範到這裡，按「取消」', 2400);
  await point(page, dlg.getByRole('button', { name: '儲存' }), 1400);
  await tap(page, dlg.getByRole('button', { name: '取消' }), 1000);
  await finish(r);
});

// ─── 收件匣發券（對象是使用者本人 Daniel，2026-11-19 使用者同意真的發券）────────────

/** demo 站 Daniel 的對話：LINE OA（錄影前先用 API 重新開啟）、Facebook Open333test */
const DANIEL_LINE_CONV = 'fe6d7425-49a6-400c-a8b5-2895273892ac';
const DANIEL_FB_CONV = '138e8ea6-279f-4411-bdb1-850a21ab3339';
const INBOX_PII = `(() => {
  const css = \`
    [data-testid="chat-messages"] div.bg-background[class*="rounded-tl-"]{filter:blur(6px)!important}
    [data-testid="other-channel-message"]{filter:blur(5px)!important}
    div.inline-flex.rounded-full.overflow-hidden{filter:blur(6px)!important}
    div.w-80.border-l dd:not(.flex){filter:blur(5px)!important}
  \`;
  const NAMES = ['Daniel', 'D', 'YD', '劉柏毅', '楊丹尼', 'Yang Daniel'];
  function run(){
    if (!document.getElementById('pii-style') && document.head) {
      const s = document.createElement('style'); s.id = 'pii-style'; s.textContent = css; document.head.appendChild(s);
    }
    // 左欄列表：不是匿名訪客的項目，模糊姓名與最後訊息
    document.querySelectorAll('div.w-80.border-r button').forEach(b => {
      if (!b.querySelector('p')) return;
      if ((b.textContent || '').includes('Chatbox Visitor')) return;
      b.querySelectorAll('span.truncate.text-sm, p').forEach(e => { e.style.filter = 'blur(5px)'; });
    });
    // 聊天表頭姓名、右欄姓名
    document.querySelectorAll('h3.text-xl, div.w-80.border-l h3').forEach(e => {
      if (!(e.textContent || '').includes('Chatbox Visitor')) e.style.filter = 'blur(6px)';
    });
    document.querySelectorAll('h1,h2,h3,h4,p,span,div').forEach(e => {
      if (e.children.length) return;
      if (NAMES.includes((e.textContent || '').trim())) e.style.filter = 'blur(6px)';
    });
    // 下拉選單選中的值是真實姓名（例如負責人）時也模糊
    document.querySelectorAll('select').forEach(sel => {
      const o = sel.selectedOptions && sel.selectedOptions[0];
      if (o && NAMES.includes((o.textContent || '').trim())) sel.style.filter = 'blur(5px)';
    });
    // 右欄「其他渠道的對話」預覽
    const h = [...document.querySelectorAll('h4')].find(x => (x.textContent||'').includes('其他渠道的對話'));
    if (h && h.parentElement) h.parentElement.querySelectorAll('p, span.block.truncate').forEach(p => p.style.filter = 'blur(5px)');
    // 浮動工具列（非本系統元件）
    document.querySelectorAll('[title="聊天室"],[title="網頁摘要與對話"],[title="切換主題"]').forEach(b => {
      let e = b; for (let i = 0; i < 8 && e && e.parentElement && e.parentElement !== document.body; i++) e = e.parentElement;
      if (e && e !== document.body) e.style.display = 'none';
    });
  }
  // DOM 一變就遮，不等下一輪計時器，避免新載入的姓名在模糊前被錄進影片
  run();
  const start = () => new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  setInterval(run, 250);
})();`;

async function openInboxConv(browser: Browser, name: string, convId: string, allow: RegExp[]) {
  const r = await startRecording(browser, name, { allowPost: allow });
  await r.context.addInitScript(INBOX_PII);
  await r.context.addInitScript(TIDY);
  await go(r.page, `/dashboard/inbox?conv=${convId}`);
  await r.page.waitForTimeout(1500);
  return r;
}

test('ch18-issue 收件匣發券（LINE）', async ({ browser }) => {
  test.setTimeout(180_000);
  const r = await openInboxConv(browser, 'ch18-issue', DANIEL_LINE_CONV, [
    new RegExp(`/conversations/${DANIEL_LINE_CONV}(/handoff)?$`),
    new RegExp(`/coupon-issue/conversations/${DANIEL_LINE_CONV}`),
  ]);
  const { page } = r;
  await caption(page, '在收件匣打開顧客的 LINE 對話', 1500);
  const reopen = page.getByRole('button', { name: '重新開啟對話' });
  if (await reopen.isVisible().catch(() => false)) {
    await caption(page, '已結束的對話不能發券，先按「重新開啟對話」', 1000);
    await tap(page, reopen, 2000);
  }
  const takeover = page.getByRole('button', { name: '接管對話' }).first();
  if (await takeover.isVisible().catch(() => false)) {
    await caption(page, '機器人處理中的對話要先「接管對話」才能發券', 1000);
    await tap(page, takeover, 2000);
  }
  await caption(page, '按輸入框下方的「發券」', 1000);
  await tap(page, page.getByRole('button', { name: '發券', exact: true }), 1800);
  const dlg = page.getByRole('dialog').last();
  await caption(page, '收件匣只能發「客服補償」用途的券，選一張', 1600);
  await tap(page, dlg.getByRole('listitem').filter({ hasText: '示範：客服補償 NT$100 折價券' }).getByRole('button', { name: '選擇' }), 1600);
  await caption(page, '確認券名與顧客，發送後無法撤回', 2000);
  await caption(page, '按「確認發送」，顧客會在 LINE 收到券', 1000);
  await tap(page, dlg.getByRole('button', { name: '確認發送' }), 3500);
  await caption(page, '對話裡會出現這張券的卡片', 2600);
  await finish(r, 3);
});

test('ch18-issue-fb 收件匣發券（Facebook）', async ({ browser }) => {
  test.setTimeout(180_000);
  const r = await openInboxConv(browser, 'ch18-issue-fb', DANIEL_FB_CONV, [
    new RegExp(`/conversations/${DANIEL_FB_CONV}/handoff$`),
  ]);
  const { page } = r;
  await caption(page, 'Facebook 對話一樣可以發券', 1500);
  const takeover = page.getByRole('button', { name: '接管對話' }).first();
  if (await takeover.isVisible().catch(() => false)) {
    await caption(page, '先「接管對話」', 800);
    await tap(page, takeover, 2000);
  }
  await tap(page, page.getByRole('button', { name: '發券', exact: true }), 1800);
  const dlg = page.getByRole('dialog').last();
  await caption(page, 'Facebook 只能發給 24 小時內傳過訊息的顧客', 1200);
  await point(page, dlg.getByRole('alert').first(), 2000);
  await caption(page, '超過期限時會直接提醒，不能發送；請等顧客再傳訊息', 2600);
  await tap(page, dlg.getByRole('button', { name: '取消' }).first(), 1000);
  await finish(r, 2);
});

test('ch18-follow-gift-full 加好友禮設定與發放來源', async ({ browser }) => {
  test.setTimeout(150_000);
  const r = await rec(browser, 'ch18-follow-gift-full');
  const { page } = r;
  // demo 站沒有啟用加好友禮（真的啟用會發券給新加好友的真實用戶），攔 GET 回一條已啟用的示範設定
  const RULE_ID = 'c0ffee00-0000-4000-8000-0000000000e1';
  const rule = {
    id: RULE_ID, name: '加好友禮', trigger: { type: 'contact.followed' }, isActive: true, createdAt: '2026-11-01T02:00:00.000Z',
    conditions: { all: [{ fact: 'follow.isFirst', operator: 'equal', value: true }, { fact: 'conversation.channelType', operator: 'equal', value: 'LINE' }] },
    actions: [{ type: 'issue_coupon', params: { couponId: ID.welcome, failureText: '新朋友禮已經發完了，歡迎關注下一波活動' } }],
  };
  const ok = (data: unknown, meta?: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data, ...(meta ? { meta } : {}) }) });
  await page.route(/\/api\/v1\/automation\/rules\?.*trigger=contact\.followed/, (route) =>
    route.request().method() !== 'GET' ? route.fallback() : route.fulfill(ok([rule], { total: 1, page: 1, limit: 100, totalPages: 1 })));
  await page.route(new RegExp(`/api/v1/automation/rules/${RULE_ID}$`), (route) =>
    route.request().method() !== 'GET' ? route.fallback() : route.fulfill(ok(rule)));
  await go(page, '/dashboard/line/follow-gift');
  await caption(page, '「渠道 → 加好友禮」：已啟用，查看目前送出的券', 2200);
  await point(page, page.getByLabel('加好友時發送的優惠券'), 1600);
  await caption(page, '券發不出時回覆這段文字；每個 LINE 帳號只有一條加好友禮', 2400);
  await go(page, `/dashboard/marketing/coupons/${ID.autumn}`);
  await caption(page, '到這張券的詳情頁，看「序號明細」', 1600);
  const row = page.getByRole('row').filter({ hasText: '加好友禮' }).first();
  await row.waitFor();
  await caption(page, '發放來源顯示「加好友禮／加好友」，就是加好友時自動送出的券', 2800);
  await point(page, row, 2000);
  await finish(r, 2);
});

// ─── 截圖 ─────────────────────────────────────────────────────────────────────

test('ch18 截圖：門市', async ({ browser }) => {
  const page = await newShotPage(browser);
  await page.context().addInitScript(TIDY);
  await mockDemo(page.context());
  await go(page, '/dashboard/settings/stores');
  await page.getByTestId('store-card').first().waitFor();
  await snap(page, page.locator('main').first(), 'ch18-store-list');
  await page.getByRole('button', { name: '新增門市' }).click();
  await page.getByLabel('門市名稱').fill('內湖門市');
  await snap(page, page.getByRole('dialog'), 'ch18-store-new');
  await page.context().close();
});

test('ch18 截圖：領券連結', async ({ browser }) => {
  const page = await newShotPage(browser);
  await page.context().addInitScript(TIDY);
  await mockDemo(page.context());
  await go(page, `/dashboard/marketing/coupons/${ID.autumn}`);
  await page.getByRole('tab', { name: '領券連結' }).click();
  await page.getByRole('listitem', { name: '門市海報' }).waitFor();
  await snap(page, page.getByRole('tabpanel'), 'ch18-claim-list');
  await page.getByRole('button', { name: '建立領券連結' }).click();
  await page.getByLabel('連結名稱').fill('門市海報');
  await pick(page, page.getByLabel('領券的渠道'), /LINE OA/);
  await snap(page, page.getByRole('alertdialog'), 'ch18-claim-new');
  await page.context().close();
});

test('ch18 截圖：核銷台登入', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true,
  });
  await guardWrites(context);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/redeem`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '核銷台' }).waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS_DIR, 'ch18-console-login.png') });
  console.log('✓ ch18-console-login.png');
  await context.close();
});

// ─── 帳號已建立＋核銷台（使用者授權的兩項真實寫入）────────────────────────────
//
// 使用者只授權在 UAT 示範租戶寫入兩件事：
//   1. 建立門市「示範：信義門市」（已存在就沿用）。
//   2. 在這間門市建立一個核銷帳號（已存在就沿用；需要密碼時用「重設密碼」取得新密碼）。
// 密碼在本測試中隨機產生、只留在記憶體，登入核銷台用完即丟，不寫進任何檔案或 log。
// 核銷台的查券、確認核銷、今日紀錄全部用 page.route 在瀏覽器端回覆示範資料，不送到伺服器；
// 只有核銷台登入（POST /store-console/login，登入不是寫入）放行到伺服器。

const DEMO_STORE = '示範：信義門市';
const DEMO_USERNAMES = ['demo-xinyi', 'demo-xinyi-01', 'demo-xinyi-02'];
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** 12 字隨機密碼（同後台「產生隨機密碼」的字元集，不含 0、O、1、l、I） */
function randomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => chars[randomInt(chars.length)]).join('');
}

type RealStore = { id: string; name: string; accounts: { id: string; username: string }[] };

async function readStores(page: Page): Promise<RealStore[]> {
  const res = page.waitForResponse((r) => /\/api\/v1\/stores(\?|$)/.test(r.url()) && r.request().method() === 'GET');
  await go(page, '/dashboard/settings/stores');
  return ((await (await res).json()).data ?? []) as RealStore[];
}

const DEMO_STORE_COUPON = {
  instanceId: 'c0ffee00-0000-4000-8000-000000000501',
  code: 'AUTUMN-DEMO01',
  name: '示範：秋季折價券',
  couponType: 'DISCOUNT_AMOUNT', discountAmount: 50, discountPercent: null, minSpend: null, percentCap: null,
  giftName: null, giftQty: null, exchangeItem: null, exchangeValueCap: null,
  redeemMode: 'STAFF_SCAN', validityMode: 'AFTER_CLAIM',
  startAt: '2026-11-10T02:00:00.000Z', endAt: null, expiresAt: '2026-12-10T15:59:59.000Z',
  // 核銷台收到的顧客名本來就是後端遮蔽過的
  customerName: '示範顧客 A',
};

/** 核銷台的查券／核銷／今日紀錄全部在瀏覽器端回覆示範資料（必須在 guardWrites 之後註冊才會先處理） */
async function mockStoreConsole(context: BrowserContext) {
  let redeemedAt: string | null = null;
  const today = () => {
    const items = redeemedAt ? [{ ...DEMO_STORE_COUPON, redeemedAt }] : [];
    return {
      items,
      summary: { count: items.length, discountTotal: items.length * 50, giftCount: 0, exchangeCount: 0 },
      date: '2026-11-18T16:00:00.000Z',
    };
  };
  await context.route('**/api/v1/store-console/lookup**', (route) =>
    route.fulfill(json({ result: 'OK', coupon: DEMO_STORE_COUPON })));
  await context.route('**/api/v1/store-console/redeem', (route) => {
    // 不送到伺服器：直接回覆核銷成功的示範結果
    redeemedAt = '2026-11-19T06:42:00.000Z';
    return route.fulfill(json({ ok: true, redeemedAt, storeName: DEMO_STORE, coupon: DEMO_STORE_COUPON }));
  });
  await context.route('**/api/v1/store-console/today', (route) => route.fulfill(json(today())));
}

test('ch18 截圖：帳號已建立與核銷台', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await newShotPage(browser, {
    allowPost: [
      /\/api\/v1\/stores$/, // 1. 建立門市（只在不存在時才按）
      new RegExp(`/api/v1/stores/${UUID}/accounts$`), // 2. 建立核銷帳號
      new RegExp(`/api/v1/stores/accounts/${UUID}/reset-password$`), // 2'. 帳號已存在時重設密碼
    ],
  });

  // 1. 門市：不存在才建立
  let stores = await readStores(page);
  let store = stores.find((s) => s.name === DEMO_STORE);
  if (!store) {
    await page.getByRole('button', { name: '新增門市' }).click();
    await page.getByLabel('門市名稱').fill(DEMO_STORE);
    const created = page.waitForResponse((r) => /\/api\/v1\/stores$/.test(r.url()) && r.request().method() === 'POST');
    await page.getByRole('dialog').getByRole('button', { name: '新增門市' }).click();
    if (!(await created).ok()) throw new Error('建立門市失敗');
    stores = await readStores(page);
    store = stores.find((s) => s.name === DEMO_STORE);
    if (!store) throw new Error('建立後仍找不到門市');
    console.log(`已建立門市 ${DEMO_STORE}`);
  } else {
    console.log(`沿用既有門市 ${DEMO_STORE}`);
  }
  const card = page.getByTestId('store-card').filter({ hasText: DEMO_STORE });
  await card.waitFor();

  const password = randomPassword();
  let username: string;
  // 截圖時把密碼糊掉（只糊密碼那一列的值）
  const blurPassword = () => page.evaluate(() => {
    // 對話框是原生 <dialog>，沒有 role 屬性，所以直接找所有 dt
    document.querySelectorAll('dt').forEach((dt) => {
      if (dt.textContent?.trim() === '密碼') {
        const dd = dt.parentElement?.querySelector('dd') as HTMLElement | null;
        if (dd) dd.style.filter = 'blur(7px)';
      }
    });
  });

  if (store.accounts.length === 0) {
    // 2. 建立核銷帳號，順便拍「帳號已建立」
    let created = false;
    username = DEMO_USERNAMES[0];
    for (const name of DEMO_USERNAMES) {
      username = name;
      const dialogOpen = await page.getByRole('dialog').isVisible().catch(() => false);
      if (!dialogOpen) await card.getByRole('button', { name: '新增帳號' }).click();
      const dlg = page.getByRole('dialog');
      await dlg.getByLabel('帳號名稱').fill(name);
      await dlg.getByLabel('密碼', { exact: true }).fill(password);
      const res = page.waitForResponse((r) => /\/accounts$/.test(r.url()) && r.request().method() === 'POST');
      await dlg.getByRole('button', { name: '建立帳號' }).click();
      const status = (await res).status();
      if (status === 409) { console.log(`帳號名稱 ${name} 已被使用，換下一個`); continue; }
      if (status >= 400) throw new Error(`建立帳號失敗 ${status}`);
      created = true;
      break;
    }
    if (!created) throw new Error('候選帳號名稱都已被使用');
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('heading', { name: '帳號已建立' }).waitFor();
    await blurPassword();
    await snap(page, dlg, 'ch18-store-created');
    await dlg.getByRole('button', { name: '我已交給店長，關閉' }).click();
    console.log(`已建立核銷帳號 ${username}`);
  } else {
    // 帳號已存在：重設密碼取得新密碼
    username = store.accounts[0].username;
    await card.getByRole('button', { name: `${username} 帳號操作` }).click();
    await page.getByRole('menuitem', { name: '重設密碼' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('新密碼', { exact: true }).fill(password);
    await dlg.getByLabel('再輸入一次新密碼', { exact: true }).fill(password);
    const res = page.waitForResponse((r) => /reset-password$/.test(r.url()) && r.request().method() === 'POST');
    await dlg.getByRole('button', { name: '重設密碼', exact: true }).click();
    if (!(await res).ok()) throw new Error('重設密碼失敗');
    await dlg.getByRole('button', { name: '我已交給店長，關閉' }).click();
    console.log(`沿用核銷帳號 ${username}，已重設密碼`);

    // 重拍「帳號已建立」：建立帳號的 POST 在瀏覽器端回覆示範結果，不送到伺服器；畫面上的密碼是假的，照樣模糊
    await page.route(new RegExp(`/api/v1/stores/${UUID}/accounts$`), (route) => route.fulfill(json({
      id: 'c0ffee00-0000-4000-8000-0000000000b9', storeId: store!.id, username, canRedeem: true, isActive: true,
      lockedUntil: null, lastLoginAt: null, createdAt: new Date().toISOString(),
    })));
    await card.getByRole('button', { name: '新增帳號' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('帳號名稱').fill(username);
    await form.getByLabel('密碼', { exact: true }).fill(randomPassword());
    await form.getByRole('button', { name: '建立帳號' }).click();
    await form.getByRole('heading', { name: '帳號已建立' }).waitFor();
    await blurPassword();
    await snap(page, form, 'ch18-store-created');
    await form.getByRole('button', { name: '我已交給店長，關閉' }).click();
  }
  await page.context().close();

  // 3. 核銷台（手機尺寸）：只放行登入，其他寫入擋下或在瀏覽器端回覆示範資料
  const context = await browser.newContext({
    viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true,
  });
  await guardWrites(context, [/\/api\/v1\/store-console\/login$/]);
  await mockStoreConsole(context);
  const m = await context.newPage();
  const shotFull = async (name: string) => {
    await m.waitForTimeout(700);
    await m.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), fullPage: true });
    console.log(`✓ ${name}.png`);
  };
  await m.goto(`${BASE_URL}/redeem`, { waitUntil: 'networkidle' });
  await m.getByLabel('門市帳號').fill(username);
  await m.getByLabel('密碼', { exact: true }).fill(password);
  await m.getByRole('button', { name: '登入', exact: true }).click();
  await m.getByRole('tab', { name: '手動核銷' }).click();
  await m.getByLabel('輸入券上的序號').fill('AUTUMN-DEMO01');
  await shotFull('ch18-console-manual');

  await m.getByRole('button', { name: '查詢', exact: true }).click();
  await m.getByRole('button', { name: '確認核銷' }).waitFor();
  await shotFull('ch18-console-confirm');

  await m.getByRole('button', { name: '確認核銷' }).click();
  await m.getByText('核銷完成').first().waitFor();
  await shotFull('ch18-console-done');

  await m.getByRole('button', { name: '下一位' }).click();
  await m.getByRole('button', { name: /^紀錄/ }).click();
  await m.getByText('今日 1 筆').waitFor();
  await m.getByRole('button', { name: /示範：秋季折價券/ }).click();
  await m.getByText('核銷門市').waitFor();
  await shotFull('ch18-console-records');
  await context.close();
});
