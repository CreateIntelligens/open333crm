/**
 * 手冊第 02 章「工單」操作影片與截圖。
 * ⚠️ UAT 即正式環境：只開表單、打示範文字、按取消；所有寫入請求都被 guardWrites 擋下。
 * 詳情頁的下拉選了就會存檔，所以影片只框出、不改值。
 */
import { test, Page, BrowserContext, Locator } from '@playwright/test';
import * as path from 'path';
import {
  startRecording, stopRecording, poster, go, caption, point, tap, typeIn, newShotPage,
} from './manual-video-helpers';
import { shot, shotPage, sanitize, SHOTS_DIR } from './manual-helpers';

/**
 * 遮蔽真實姓名（新版 UI 的列表是 role=table 的 div 格線，不是 <table>）：
 * 列表「聯繫人」欄、詳情頁聯繫人連結、頭像縮寫、以及從 API 回應收集到的聯絡人姓名；隱藏右下浮動工具
 */
const PII_SCRIPT = `(() => {
  const css = \`
    div.inline-flex.rounded-full.overflow-hidden{filter:blur(6px)!important}
  \`;
  const FIXED = ['劉柏毅', 'Daniel', '楊丹尼', 'Yang Daniel'];
  const isVisitor = t => /Chatbox Visitor/.test(t);
  function run(){
    if (!document.getElementById('pii-style') && document.head) {
      const s = document.createElement('style'); s.id = 'pii-style'; s.textContent = css; document.head.appendChild(s);
    }
    // 列表「聯繫人」欄：非匿名訪客就模糊
    const heads = [...document.querySelectorAll('[role="columnheader"]')];
    const ci = heads.findIndex(h => (h.textContent || '').trim() === '聯繫人');
    if (ci >= 0) document.querySelectorAll('[role="table"] [role="row"]').forEach(r => {
      const cells = r.querySelectorAll(':scope > [role="cell"]'); const td = cells[ci]; if (!td) return;
      if (!isVisitor(td.textContent || '')) td.style.filter = 'blur(6px)';
    });
    // 詳情頁聯繫人連結
    document.querySelectorAll('a[href^="/dashboard/contacts/"]').forEach(a => {
      if (!isVisitor(a.textContent || '')) a.style.filter = 'blur(6px)';
    });
    // 已知姓名（固定清單＋API 回應收集的聯絡人姓名）
    const names = FIXED.concat(window.__piiNames || []).filter(n => n && n.length >= 2 && !isVisitor(n));
    document.querySelectorAll('h1,h2,h3,h4,p,span,a,div,button,td,dd').forEach(e => {
      if (e.children.length) return;
      const t = (e.textContent || '').trim();
      if (t && names.some(n => t.includes(n))) e.style.filter = 'blur(6px)';
    });
    document.querySelectorAll('input').forEach(i => {
      const v = (i.value || '').trim();
      if (v && names.some(n => v.includes(n))) i.style.filter = 'blur(5px)';
    });
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

/** 從 API 回應收集聯絡人姓名（contact / contacts 底下的 name、displayName），交給 PII_SCRIPT 模糊 */
function collectContactNames(page: Page) {
  page.on('response', async (r) => {
    if (!r.url().includes('/api/v1/') || r.request().method() !== 'GET') return;
    let j: unknown;
    try { j = await r.json(); } catch { return; }
    const out = new Set<string>();
    const walk = (v: any, inContact: boolean) => {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) { v.forEach((x) => walk(x, inContact)); return; }
      if (inContact) for (const k of ['name', 'displayName']) if (typeof v[k] === 'string') out.add(v[k].trim());
      for (const [k, x] of Object.entries(v)) walk(x, inContact || k === 'contact' || k === 'contacts');
    };
    walk(j, r.url().includes('/contacts'));
    if (!out.size) return;
    await page.evaluate((ns) => {
      const w = window as any; w.__piiNames = Array.from(new Set([...(w.__piiNames || []), ...ns]));
    }, [...out]).catch(() => {});
  });
}

async function protect(context: BrowserContext, page: Page) {
  await context.addInitScript(PII_SCRIPT);
  collectContactNames(page);
  await page.addScriptTag({ content: PII_SCRIPT }).catch(() => {});
}

const ROWS = (page: Page) => page.locator('[role="table"] [role="row"][tabindex="0"]');

/** 「標記解決」「升級」只在處理中的工單出現，所以優先挑處理中的工單；其次有負責人的，最後第一筆 */
const pickRow = async (page: Page) => {
  await ROWS(page).first().waitFor();
  const inProgress = ROWS(page).filter({ hasText: '處理中' }).first();
  if (await inProgress.count()) return inProgress;
  const assigned = ROWS(page).filter({ hasNotText: '未指派' }).first();
  return (await assigned.count()) ? assigned : ROWS(page).first();
};

const timelineCard = (page: Page) => page.getByRole('heading', { name: '時間軸與備註' }).locator('..');

async function openCase(page: Page) {
  await go(page, '/dashboard/cases');
  await (await pickRow(page)).click();
  await page.getByText('時間軸與備註').waitFor();
  await page.waitForTimeout(1500);
}

test('ch02-list 工單列表與篩選', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch02-list');
  const { page } = rec;
  await protect(rec.context, page);
  await go(page, '/dashboard/cases');
  await caption(page, '上方四張卡片是目前的工作量', 1700);
  await point(page, page.getByText('SLA 違規').first().locator('xpath=ancestor::div[contains(@class,"grid")][1]'), 2000);
  await caption(page, '搜尋框可以找標題或描述', 1700);
  await typeIn(page, page.getByPlaceholder(/搜尋工單標題或描述/), '自動建單');
  await page.waitForTimeout(1000);
  await page.getByPlaceholder(/搜尋工單標題或描述/).fill('');
  await caption(page, '下拉選單依負責人、優先級、分類、SLA 篩選', 1700);
  const pri = page.getByLabel('優先級', { exact: true });
  await point(page, pri, 600);
  await pri.selectOption({ label: '緊急' });
  await page.waitForTimeout(1500);
  await pri.selectOption({ index: 0 });
  await caption(page, '下方分頁依狀態切換', 1700);
  await tap(page, page.getByRole('tab', { name: /^開啟/ }), 1000);
  await tap(page, page.getByRole('tab', { name: /^全部/ }), 800);
  await caption(page, 'SLA 欄是剩下的處理時間，紅色代表已逾時', 1700);
  await point(page, page.getByRole('columnheader', { name: 'SLA', exact: true }), 2200);
  await caption(page, '點任一列進入工單詳情', 1800);
  await stopRecording(rec);
  poster('ch02-list', 2);
});

test('ch02-detail 工單詳情', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch02-detail');
  const { page } = rec;
  await protect(rec.context, page);
  await go(page, '/dashboard/cases');
  await caption(page, '點一張工單打開詳情', 1700);
  await tap(page, await pickRow(page), 2000);
  await page.getByText('時間軸與備註').waitFor();
  await caption(page, '右邊「案件屬性」可以直接改狀態、優先級、分類', 1700);
  await point(page, page.locator('h4').filter({ hasText: /^狀態$/ }).locator('..'), 1400);
  await point(page, page.locator('h4').filter({ hasText: /^優先級$/ }).locator('..'), 1200);
  await point(page, page.locator('h4').filter({ hasText: /^分類$/ }).locator('..'), 1200);
  await caption(page, '也能改負責人，選了就自動儲存', 1700);
  await point(page, page.locator('h4').filter({ hasText: /^負責人$/ }).locator('..'), 1800);
  await caption(page, '左邊上方是 SLA 時限', 1700);
  await point(page, page.locator('h4', { hasText: 'SLA' }).locator('..'), 2000);
  const link = page.getByRole('link', { name: /開啟對話/ });
  if (await link.count()) {
    await caption(page, '「開啟對話」回到原本的收件匣對話', 1700);
    await point(page, link, 1800);
  }
  await caption(page, '右上角是常用的狀態按鈕', 1700);
  await point(page, page.getByRole('button', { name: '標記解決' }), 1000);
  await point(page, page.getByRole('button', { name: '關閉案件' }), 1000);
  await point(page, page.getByRole('button', { name: '升級' }), 1200);
  await caption(page, '「標記解決」「升級」只在處理中的工單出現，新工單請先改成處理中', 2600);
  await stopRecording(rec);
  poster('ch02-detail', 2);
});

test('ch02-notes 時間軸與內部備註', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch02-notes');
  const { page } = rec;
  await protect(rec.context, page);
  await openCase(page);
  await caption(page, '「時間軸與備註」是這張工單的所有紀錄', 1700);
  await point(page, timelineCard(page), 1800);
  await caption(page, '同事之間的交接，寫在備註', 1700);
  await typeIn(page, page.getByPlaceholder('撰寫備註...'), '範例：已電話聯繫客戶，明天回覆');
  await caption(page, '「內部備註」預設勾選，只有後台看得到', 1700);
  await point(page, page.getByLabel('內部備註'), 1800);
  await caption(page, '按「新增備註」就會加進時間軸', 1700);
  await point(page, page.getByRole('button', { name: '新增備註' }), 1800);
  await page.getByPlaceholder('撰寫備註...').fill('');
  await caption(page, '示範到這裡，不送出', 1500);
  await stopRecording(rec);
  poster('ch02-notes', 2);
});

test('ch02-create 新增工單', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch02-create');
  const { page } = rec;
  await protect(rec.context, page);
  await go(page, '/dashboard/cases');
  await caption(page, '按右上角「建立工單」', 1700);
  await tap(page, page.getByRole('button', { name: '建立工單' }), 1200);
  const dlg = page.getByRole('dialog');
  await caption(page, '先搜尋並選擇聯絡人（至少 2 個字）', 1700);
  await typeIn(page, page.getByPlaceholder('搜尋聯絡人姓名...'), 'Chatbox');
  await page.waitForTimeout(1500);
  const cand = dlg.locator('div.absolute.z-50 button, div.absolute.z-50 [role=option], div.absolute.z-50 div.cursor-pointer').first();
  if (await cand.count()) await tap(page, cand, 800);
  await caption(page, '工單掛在聯絡人所在的渠道；有好幾個渠道時要選一個', 2200);
  const ch = dlg.getByText(/^渠道/).first();
  if (await ch.count()) await point(page, ch, 1400);
  await caption(page, '填案件標題', 1700);
  await typeIn(page, page.getByPlaceholder('案件標題...'), '範例：週年慶訂單查詢');
  await caption(page, '選分類，優先級預設是「中」', 1700);
  const cat = dlg.locator('select').filter({ hasText: '訂單問題' }).first();
  await point(page, cat, 600);
  await cat.selectOption({ label: '訂單問題' });
  await page.waitForTimeout(800);
  await caption(page, '負責人、SLA 可以先不選', 1700);
  await point(page, dlg.locator('select').last(), 1400);
  await caption(page, '按「建立案件」完成，這裡示範先取消', 1700);
  await point(page, dlg.getByRole('button', { name: '建立案件' }), 1400);
  await tap(page, dlg.getByRole('button', { name: '取消' }), 800);
  await stopRecording(rec);
  poster('ch02-create', 2);
});

test('ch02 截圖', async ({ browser }) => {
  const page = await newShotPage(browser);
  await protect(page.context(), page);
  await go(page, '/dashboard/cases');
  await page.waitForTimeout(1000);
  await shotPage(page, 'ch02-list');
  await openCase(page);
  await shotPage(page, 'ch02-detail');
  await shot(page, timelineCard(page), 'ch02-timeline');
  await page.getByRole('button', { name: '升級' }).click();
  await page.waitForTimeout(800);
  await shot(page, page.getByRole('dialog'), 'ch02-escalate');
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
});

/**
 * 「建立工單」是整頁表單（PageDialog），表單本體只有 620px 寬，右半邊是空白。
 * 只拍表單欄（同 ch08 的 shotForm）；表單比視窗高時先把視窗拉高，一次拍完整張表單。
 */
async function shotForm(p: Page, d: Locator, name: string) {
  const form = d.locator('div.max-w-\\[620px\\]').first();
  if (!(await form.count())) { console.log(`✗ ${name}：找不到表單`); return; }
  const h = await form.evaluate((el) => el.getBoundingClientRect().bottom + 40);
  const vp = p.viewportSize()!;
  if (h > vp.height) await p.setViewportSize({ width: vp.width, height: Math.ceil(h) });
  await d.evaluate((el) => { el.scrollTop = 0; });
  await p.waitForTimeout(500);
  await sanitize(p);
  const box = await form.boundingBox();
  if (!box) { console.log(`✗ ${name}：找不到表單`); return; }
  await p.screenshot({
    path: path.join(SHOTS_DIR, `${name}.png`),
    clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 8), width: box.width + 32, height: box.height + 16 },
  });
  console.log(`✓ ${name}.png`);
  await p.setViewportSize(vp);
}

test('ch02 建立工單表單', async ({ browser }) => {
  const page = await newShotPage(browser);
  await protect(page.context(), page);
  await go(page, '/dashboard/cases');
  await page.getByRole('button', { name: '建立工單' }).click();
  await page.waitForTimeout(1200);
  const d = page.getByRole('dialog');
  await shotForm(page, d, 'ch02-create-dialog');
  await d.getByRole('button', { name: '取消' }).click();
  await page.waitForTimeout(1200); // PageDialog 關閉時會延後 history.back()
});

/**
 * 滿意度示範資料：UAT 示範租戶沒有帶客服代評的工單，攔截工單詳情的 GET 回應補上示範分數與時間軸事件。
 * 只改 GET 的回應，其他方法一律 fallback（寫入請求仍由 guardWrites 擋下）。
 */
const CASE_DETAIL_URL = /\/api\/v1\/cases\/[0-9a-f-]{36}(\?.*)?$/;

function demoCsatCase(data: Record<string, any>) {
  const base = new Date();
  base.setDate(base.getDate() - 1);
  base.setHours(10, 0, 0, 0);
  const at = (min: number) => new Date(base.getTime() + min * 60000).toISOString();
  const agent = { id: '00000000-0000-0000-0000-0000000000a1', name: '示範客服' };
  const ev = (id: number, eventType: string, min: number, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    id: `00000000-0000-0000-0000-00000000c0${String(id).padStart(2, '0')}`,
    caseId: data.id, eventType, type: eventType, payload, createdAt: at(min), actorType: 'system', actor: null, ...extra,
  });
  return {
    ...data,
    title: '範例：訂單配送詢問',
    status: 'CLOSED',
    contact: data.contact ? { ...data.contact, displayName: '示範顧客 A', name: '示範顧客 A', email: null, phone: null } : data.contact,
    csatScore: 2,
    csatComment: null,
    csatSentAt: at(150),
    csatRespondedAt: at(185),
    csatRatedBy: 'agent',
    notes: [],
    events: [
      ev(1, 'created', 0, { title: '範例：訂單配送詢問' }),
      ev(2, 'assigned', 5, { assigneeName: '示範客服' }, { actorType: 'agent', actor: agent }),
      ev(3, 'status_changed', 6, { from: 'OPEN', to: 'IN_PROGRESS' }, { actorType: 'agent', actor: agent }),
      ev(4, 'status_changed', 120, { from: 'IN_PROGRESS', to: 'RESOLVED' }, { actorType: 'agent', actor: agent }),
      ev(5, 'csat_rated', 185, { score: 2, source: 'agent' }, { actorType: 'agent', actor: agent }),
      ev(6, 'csat_low_score_notify_failed', 185.5, { score: 2 }),
      ev(7, 'status_changed', 186, { from: 'RESOLVED', to: 'CLOSED', reason: 'csat_rated' }),
    ],
  };
}

test('ch02 滿意度截圖', async ({ browser }) => {
  const page = await newShotPage(browser);
  await protect(page.context(), page);
  await page.route(CASE_DETAIL_URL, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const body = await res.json().catch(() => null);
    if (!body?.data) return route.fulfill({ response: res });
    return route.fulfill({ response: res, json: { ...body, data: demoCsatCase(body.data) } });
  });
  await openCase(page);
  await shot(page, page.getByTestId('case-csat'), 'ch02-csat-agent');
  await shot(page, timelineCard(page), 'ch02-timeline-csat');
});
