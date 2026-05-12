#!/usr/bin/env node
/**
 * Build a self-contained Chinese QA report from Playwright JSON results.
 *
 * Reads:
 *   test-results.json (Playwright JSON reporter output)
 *   test-results/<test-id>/<attachment>.png (screenshots from snap() helper)
 *
 * Writes:
 *   qa-report.html (single self-contained HTML, base64-embedded screenshots)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const JSON_PATH = join(ROOT, 'test-results.json');
const OUT_PATH = join(ROOT, 'qa-report.html');

if (!existsSync(JSON_PATH)) {
  console.error(`[!] Missing ${JSON_PATH}. Run: pnpm exec playwright test --reporter=json > test-results.json`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(JSON_PATH, 'utf8'));

// ============================================================
// Step descriptions per spec — written in ZH-TW for the report
// Maps "<spec_file>::<test title>" → human description + steps
// ============================================================
const TEST_DESCRIPTIONS = {
  'auth.spec.ts::Auth > login page renders': {
    purpose: '驗證登入頁面正確載入並顯示必要欄位',
    steps: [
      '訪問 /login',
      '檢查 Email 輸入框存在',
      '檢查密碼輸入框存在',
      '檢查「登入」按鈕存在',
    ],
  },
  'auth.spec.ts::Auth > login with wrong password shows error': {
    purpose: '驗證錯誤密碼登入會顯示錯誤訊息且停留在登入頁',
    steps: [
      '訪問 /login',
      '填入正確 Email + 錯誤密碼',
      '點選「登入」按鈕',
      '確認停留在 /login',
    ],
  },
  'auth.spec.ts::Auth > login with valid credentials lands on dashboard': {
    purpose: '驗證正確帳密可登入並跳轉至 dashboard',
    steps: [
      '使用 admin@demo.com / admin123 登入',
      '確認跳轉至 /dashboard',
      '確認 LayoutTopbar 的 brand chip 顯示',
    ],
  },
  'auth.spec.ts::Auth > session persists after reload': {
    purpose: '驗證登入後重新整理頁面 session 仍存在',
    steps: [
      '完成登入',
      '重新整理頁面',
      '確認仍在 dashboard 區，未跳回 login',
    ],
  },
  'inbox.spec.ts::Inbox > three-column layout loads': {
    purpose: '驗證收件匣三欄式 layout 與所有篩選元件正確渲染',
    steps: [
      '訪問 /dashboard/inbox',
      '檢查「收件匣」標題',
      '檢查 Segmented Control（進行中 / 已關閉）',
      '檢查搜尋框',
      '檢查 Tabs（全部 / 未讀 / 我的）',
    ],
  },
  'inbox.spec.ts::Inbox > switching to closed tab triggers re-fetch': {
    purpose: '驗證切換至「已關閉」分頁時，日期範圍下拉出現',
    steps: [
      '進入收件匣',
      '點選「已關閉」',
      '確認時間範圍下拉選單出現（最近 30 天等）',
    ],
  },
  'inbox.spec.ts::Inbox > select first conversation opens chat panel': {
    purpose: '驗證選擇對話會開啟聊天面板並改變 URL',
    steps: [
      '進入收件匣',
      '點擊第一筆對話',
      '確認 URL 帶 ?conv= 參數',
      '截圖聊天視窗',
    ],
  },
  'inbox.spec.ts::Inbox > AI suggest panel opens': {
    purpose: '驗證點擊 AI 燈泡按鈕能開啟 AI 建議回覆面板',
    steps: [
      '進入收件匣 → 選對話',
      '點擊 AI 燈泡按鈕',
      '等待建議載入並截圖',
    ],
  },
  'inbox.spec.ts::Inbox > open create case modal from sidebar': {
    purpose: '驗證右側欄「開立案件」按鈕能開啟建立案件 Modal',
    steps: [
      '進入收件匣 → 選對話',
      '點擊右側欄「開立案件」',
      '確認 Modal 標題「建立案件」顯示',
      '點擊關閉按鈕收起 Modal',
    ],
  },
  'cases.spec.ts::Cases > case list page renders': {
    purpose: '驗證工單列表頁正確載入',
    steps: [
      '訪問 /dashboard/cases',
      '檢查「工單」標題',
      '等待網路 idle',
    ],
  },
  'cases.spec.ts::Cases > dashboard stats cards visible': {
    purpose: '驗證 4 個工單統計卡片（開啟中、SLA 違規、即將到期、今日解決）顯示',
    steps: [
      '進入工單頁',
      '檢查 4 個統計卡片標題皆可見',
    ],
  },
  'cases.spec.ts::Cases > search filters table': {
    purpose: '驗證搜尋輸入後表格會被篩選',
    steps: [
      '進入工單頁',
      '在搜尋框輸入「測試」',
      '等待結果重新渲染',
    ],
  },
  'cases.spec.ts::Cases > switch to status tab': {
    purpose: '驗證可切換工單狀態 tab（如「開啟」）',
    steps: [
      '進入工單頁',
      '點擊「開啟 (N)」分頁',
    ],
  },
  'cases.spec.ts::Cases > open create case modal from toolbar': {
    purpose: '驗證頁面右上角「建立案件」按鈕能開啟 Modal',
    steps: [
      '進入工單頁',
      '點擊右上角「建立案件」',
      '確認 Modal 出現',
    ],
  },
  'contacts.spec.ts::Contacts > contact list page renders': {
    purpose: '驗證聯繫人列表頁載入',
    steps: ['訪問 /dashboard/contacts', '檢查「聯繫人」標題'],
  },
  'contacts.spec.ts::Contacts > search contact filters table': {
    purpose: '驗證聯繫人搜尋功能',
    steps: ['進入聯繫人頁', '搜尋框輸入「王」', '等待篩選結果'],
  },
  'contacts.spec.ts::Contacts > open contact detail page': {
    purpose: '驗證點擊聯繫人列可進入詳情頁',
    steps: ['進入聯繫人頁', '點擊第一筆聯繫人', '確認 URL 進入 /contacts/<id>'],
  },
  'automation.spec.ts::Automation > automation rules page renders': {
    purpose: '驗證自動化規則頁載入',
    steps: ['訪問 /dashboard/automation', '確認 URL 正確'],
  },
  'marketing.spec.ts::Marketing > marketing landing renders': {
    purpose: '驗證行銷主頁載入',
    steps: ['訪問 /dashboard/marketing'],
  },
  'marketing.spec.ts::Marketing > switch tabs without error': {
    purpose: '驗證行銷頁的多個 tab 可切換不報錯',
    steps: ['進入行銷頁', '依序點擊 範本 / 活動 / 客群 / 推播'],
  },
  'knowledge.spec.ts::Knowledge > knowledge page renders': {
    purpose: '驗證知識庫頁載入',
    steps: ['訪問 /dashboard/knowledge'],
  },
  'analytics.spec.ts::Analytics > analytics overview renders': {
    purpose: '驗證報表總覽頁圖表可載入',
    steps: ['訪問 /dashboard/analytics', '等待圖表渲染'],
  },
  'analytics.spec.ts::Analytics > my analytics page renders': {
    purpose: '驗證個人報表頁載入',
    steps: ['訪問 /dashboard/analytics/my'],
  },
  'notifications.spec.ts::Notifications > notifications page renders': {
    purpose: '驗證通知中心頁載入',
    steps: ['訪問 /dashboard/notifications'],
  },
  'portal.spec.ts::Portal > portal page renders': {
    purpose: '驗證粉絲活動頁載入',
    steps: ['訪問 /dashboard/portal'],
  },
  'shortlinks.spec.ts::Shortlinks > shortlinks page renders': {
    purpose: '驗證短連結列表頁載入',
    steps: ['訪問 /dashboard/shortlinks'],
  },
  'settings.spec.ts::Settings > settings page renders': {
    purpose: '驗證設定總覽頁載入',
    steps: ['訪問 /dashboard/settings'],
  },
  'settings.spec.ts::Settings > switch through main tabs': {
    purpose: '驗證設定頁的多個 tab 可依序切換不報錯',
    steps: ['進入設定頁', '依序切換 通用 / 渠道 / 客服 / 團隊 / 標籤 / SLA / API Keys / 營業時間'],
  },
  'dashboard.spec.ts::Dashboard overview > overview page renders': {
    purpose: '驗證 dashboard 總覽頁載入',
    steps: ['訪問 /dashboard'],
  },
};

// ============================================================
// Walk Playwright suites tree → flat list of (spec, title, result, attachments)
// ============================================================
function walkSuites(suites, results = []) {
  for (const suite of suites) {
    const specFile = suite.file ?? '';
    if (suite.specs) {
      for (const spec of suite.specs) {
        for (const t of spec.tests) {
          for (const run of t.results) {
            const attachments = (run.attachments || [])
              .filter((a) => a.contentType === 'image/png')
              .map((a) => ({
                name: a.name,
                path: a.path,
                body: a.body, // Playwright JSON reporter inlines base64 body
              }));
            results.push({
              specFile,
              suiteTitle: suite.title || '',
              specTitle: spec.title,
              fullTitle: `${suite.title} > ${spec.title}`,
              status: run.status,           // 'passed' | 'failed' | 'skipped' | 'timedOut'
              durationMs: run.duration,
              startTime: run.startTime,
              error: run.error?.message,
              attachments,
              annotations: t.annotations || [],
            });
          }
        }
      }
    }
    if (suite.suites) walkSuites(suite.suites, results);
  }
  return results;
}

const allResults = walkSuites(data.suites);

// Group by spec file
const grouped = {};
for (const r of allResults) {
  const file = basename(r.specFile);
  grouped[file] ??= [];
  grouped[file].push(r);
}

// Spec → human label
const SPEC_LABEL = {
  'auth.spec.ts': '登入與身分驗證 (Auth)',
  'inbox.spec.ts': '收件匣 (Inbox)',
  'cases.spec.ts': '工單管理 (Cases)',
  'contacts.spec.ts': '聯繫人 (Contacts)',
  'automation.spec.ts': '自動化規則 (Automation)',
  'marketing.spec.ts': '行銷 (Marketing)',
  'knowledge.spec.ts': '知識庫 (Knowledge)',
  'analytics.spec.ts': '報表 (Analytics)',
  'notifications.spec.ts': '通知 (Notifications)',
  'portal.spec.ts': '粉絲活動 (Portal)',
  'shortlinks.spec.ts': '短連結 (Shortlinks)',
  'settings.spec.ts': '系統設定 (Settings)',
  'dashboard.spec.ts': '總覽 (Dashboard)',
};

// ============================================================
// Stats
// ============================================================
const total = allResults.length;
const passed = allResults.filter((r) => r.status === 'passed').length;
const failed = allResults.filter((r) => r.status === 'failed').length;
const skipped = allResults.filter((r) => r.status === 'skipped').length;
const totalDurationMs = allResults.reduce((sum, r) => sum + r.durationMs, 0);
const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';

const startedAt = data.stats?.startTime ? new Date(data.stats.startTime) : new Date();
const reportTime = new Date();

function fmtMs(ms) {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} 秒`;
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(0);
  return `${m} 分 ${s} 秒`;
}

function fmtDate(d) {
  return d.toLocaleString('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

// ============================================================
// Embed PNG as base64 data URI
// ============================================================
function embedImage(att) {
  // Prefer inlined base64 body from JSON reporter
  if (att?.body) {
    return `data:image/png;base64,${att.body}`;
  }
  // Fallback to file path
  if (att?.path && existsSync(att.path)) {
    try {
      const buf = readFileSync(att.path);
      return `data:image/png;base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }
  return null;
}

const STATUS_LABEL = {
  passed: '✓ 通過',
  failed: '✗ 失敗',
  skipped: '— 跳過',
  timedOut: '✗ 逾時',
};

const STATUS_CLASS = {
  passed: 'pass',
  failed: 'fail',
  skipped: 'skip',
  timedOut: 'fail',
};

// ============================================================
// Render HTML
// ============================================================
function renderTestCard(r, idx) {
  const key = `${basename(r.specFile)}::${r.fullTitle}`;
  const meta = TEST_DESCRIPTIONS[key] || { purpose: '—', steps: [] };
  const screenshots = r.attachments
    .map((a) => ({ name: a.name, src: embedImage(a) }))
    .filter((a) => a.src);

  return `
    <div class="case ${STATUS_CLASS[r.status] || ''}" id="case-${idx}">
      <div class="case-head">
        <span class="case-status ${STATUS_CLASS[r.status] || ''}">${STATUS_LABEL[r.status] ?? r.status}</span>
        <span class="case-num">#${String(idx + 1).padStart(2, '0')}</span>
        <h4 class="case-title">${escapeHtml(r.specTitle)}</h4>
        <span class="case-duration">${fmtMs(r.durationMs)}</span>
      </div>

      <div class="case-body">
        <div class="case-meta">
          <p><strong>測試目的：</strong>${escapeHtml(meta.purpose)}</p>
          ${meta.steps.length > 0 ? `
            <p><strong>測試步驟：</strong></p>
            <ol class="steps">
              ${meta.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
            </ol>
          ` : ''}
          ${r.annotations.length > 0 ? `
            <p class="annotations"><strong>備註：</strong>${r.annotations.map((a) => escapeHtml(a.description || a.type)).join('；')}</p>
          ` : ''}
          ${r.error ? `<pre class="error">${escapeHtml(r.error)}</pre>` : ''}
        </div>

        ${screenshots.length > 0 ? `
          <div class="case-shots">
            ${screenshots.map((s) => `
              <figure>
                <img src="${s.src}" alt="${escapeHtml(s.name)}" loading="lazy" onclick="openLightbox(this.src, '${escapeHtml(s.name)}')" />
                <figcaption>${escapeHtml(s.name)}</figcaption>
              </figure>
            `).join('')}
          </div>
        ` : '<p class="no-shots">— 無截圖 —</p>'}
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const sectionsHtml = Object.keys(SPEC_LABEL)
  .filter((file) => grouped[file])
  .map((file, sectionIdx) => {
    const items = grouped[file];
    const passCount = items.filter((r) => r.status === 'passed').length;
    return `
      <section class="spec-section">
        <h3>
          <span class="spec-name">${escapeHtml(SPEC_LABEL[file])}</span>
          <span class="spec-stat">${passCount} / ${items.length} 通過</span>
          <span class="spec-file">${escapeHtml(file)}</span>
        </h3>
        ${items.map((r, idx) => renderTestCard(r, sectionIdx * 100 + idx)).join('')}
      </section>
    `;
  }).join('');

const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>open333CRM Web QA 測試報告</title>
  <style>
    :root {
      --ink: #314158;
      --ink-subtle: #62748E;
      --link: #2876C4;
      --pass: #229A4F;
      --fail: #EE3134;
      --skip: #A3A7B0;
      --line: #E2E8F0;
      --canvas: #F8FAFC;
      --card: #FFFFFF;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'PingFang TC', 'Microsoft JhengHei', sans-serif;
      background: var(--canvas);
      color: var(--ink);
      line-height: 1.6;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 24px 80px;
    }
    /* === HEADER === */
    .report-header {
      background: white;
      padding: 32px;
      border-radius: 12px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.05);
      margin-bottom: 24px;
      border-left: 6px solid var(--link);
    }
    .report-header h1 {
      font-size: 28px;
      font-weight: 700;
      color: var(--ink);
      margin-bottom: 8px;
    }
    .report-header .subtitle {
      color: var(--ink-subtle);
      font-size: 14px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid var(--line);
    }
    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .meta-item dt {
      font-size: 12px;
      color: var(--ink-subtle);
      font-weight: 500;
    }
    .meta-item dd {
      font-size: 14px;
      color: var(--ink);
      font-weight: 600;
    }
    /* === SUMMARY === */
    .summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: white;
      padding: 20px;
      border-radius: 12px;
      border-left: 4px solid var(--link);
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    }
    .stat-card.pass  { border-left-color: var(--pass); }
    .stat-card.fail  { border-left-color: var(--fail); }
    .stat-card.skip  { border-left-color: var(--skip); }
    .stat-card.rate  { border-left-color: var(--link); }
    .stat-card .label {
      font-size: 12px;
      color: var(--ink-subtle);
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-card .value {
      font-size: 32px;
      font-weight: 700;
      margin-top: 4px;
    }
    .stat-card.pass .value { color: var(--pass); }
    .stat-card.fail .value { color: var(--fail); }
    .stat-card.skip .value { color: var(--skip); }
    .stat-card.rate .value { color: var(--link); }
    /* === TOC === */
    .toc {
      background: white;
      padding: 20px 24px;
      border-radius: 12px;
      margin-bottom: 24px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    }
    .toc h2 {
      font-size: 16px;
      margin-bottom: 12px;
      color: var(--ink);
    }
    .toc ul {
      list-style: none;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 4px 16px;
    }
    .toc li {
      font-size: 14px;
      color: var(--ink-subtle);
    }
    .toc li::before {
      content: '› ';
      color: var(--link);
    }
    /* === SECTION === */
    .spec-section {
      margin-bottom: 32px;
    }
    .spec-section h3 {
      display: flex;
      align-items: baseline;
      gap: 12px;
      font-size: 18px;
      font-weight: 600;
      color: var(--ink);
      margin: 0 0 12px 0;
      padding: 12px 16px;
      background: white;
      border-radius: 12px;
      border-left: 4px solid var(--link);
      box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    }
    .spec-name { flex: 1; }
    .spec-stat {
      font-size: 13px;
      color: var(--pass);
      font-weight: 500;
    }
    .spec-file {
      font-size: 12px;
      color: var(--ink-subtle);
      font-family: 'SF Mono', Menlo, monospace;
      font-weight: 400;
    }
    /* === CASE === */
    .case {
      background: white;
      border: 1px solid var(--line);
      border-radius: 12px;
      margin-bottom: 12px;
      overflow: hidden;
    }
    .case.fail {
      border-color: rgba(238, 49, 52, 0.4);
      background: rgba(238, 49, 52, 0.02);
    }
    .case-head {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--line);
      background: var(--canvas);
    }
    .case-status {
      display: inline-flex;
      align-items: center;
      padding: 2px 10px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .case-status.pass { background: #EAF6EE; color: var(--pass); }
    .case-status.fail { background: #F7EDED; color: var(--fail); }
    .case-status.skip { background: #F0F2F7; color: var(--skip); }
    .case-num {
      font-family: 'SF Mono', Menlo, monospace;
      font-size: 12px;
      color: var(--ink-subtle);
      font-weight: 500;
    }
    .case-title {
      flex: 1;
      font-size: 14px;
      font-weight: 600;
      color: var(--ink);
    }
    .case-duration {
      font-size: 12px;
      color: var(--ink-subtle);
      font-family: 'SF Mono', Menlo, monospace;
    }
    .case-body {
      padding: 16px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }
    @media (max-width: 768px) {
      .case-body { grid-template-columns: 1fr; }
    }
    .case-meta {
      font-size: 14px;
    }
    .case-meta p { margin-bottom: 8px; color: var(--ink); }
    .case-meta strong { color: var(--ink); font-weight: 600; }
    .case-meta .steps {
      list-style-position: inside;
      margin-left: 8px;
    }
    .case-meta .steps li {
      font-size: 13px;
      color: var(--ink-subtle);
      margin-bottom: 4px;
    }
    .case-meta .annotations {
      color: var(--ink-subtle);
      font-style: italic;
      font-size: 13px;
    }
    .case-meta .error {
      background: #F7EDED;
      color: var(--fail);
      padding: 8px;
      border-radius: 8px;
      font-size: 12px;
      font-family: 'SF Mono', Menlo, monospace;
      white-space: pre-wrap;
      word-break: break-all;
      margin-top: 8px;
    }
    .case-shots {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .case-shots figure {
      margin: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      cursor: zoom-in;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .case-shots figure:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .case-shots img {
      display: block;
      width: 100%;
      height: auto;
      max-height: 240px;
      object-fit: contain;
      object-position: top;
      background: var(--canvas);
    }
    .case-shots figcaption {
      font-size: 11px;
      color: var(--ink-subtle);
      padding: 6px 10px;
      background: var(--canvas);
      border-top: 1px solid var(--line);
    }
    .no-shots {
      color: var(--ink-subtle);
      font-style: italic;
      font-size: 13px;
      align-self: center;
      text-align: center;
    }
    /* === LIGHTBOX === */
    .lightbox {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.85);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 32px;
      cursor: zoom-out;
    }
    .lightbox.show { display: flex; }
    .lightbox img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 4px;
    }
    .lightbox .caption {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      color: white;
      background: rgba(0,0,0,0.6);
      padding: 6px 16px;
      border-radius: 8px;
      font-size: 14px;
    }
    .lightbox .close {
      position: fixed;
      top: 16px;
      right: 24px;
      color: white;
      background: rgba(255,255,255,0.15);
      border: none;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 20px;
    }
    /* === FOOTER === */
    .footer {
      margin-top: 48px;
      padding: 24px;
      background: white;
      border-radius: 12px;
      font-size: 13px;
      color: var(--ink-subtle);
      line-height: 1.8;
    }
    .footer h2 {
      font-size: 16px;
      color: var(--ink);
      margin-bottom: 12px;
    }
    .footer code {
      background: var(--canvas);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'SF Mono', Menlo, monospace;
      font-size: 12px;
    }
    .footer ul { padding-left: 20px; margin-bottom: 12px; }
    .footer li { margin-bottom: 4px; }
    /* Print */
    @media print {
      body { background: white; }
      .case-shots figure { break-inside: avoid; }
      .case { break-inside: avoid; }
      .lightbox { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="report-header">
      <h1>open333CRM Web 端對端 QA 測試報告</h1>
      <p class="subtitle">基於 Playwright 自動化測試的完整功能驗證報告</p>
      <dl class="meta-grid">
        <div class="meta-item">
          <dt>產品名稱</dt>
          <dd>open333CRM 多通路客服管理系統</dd>
        </div>
        <div class="meta-item">
          <dt>測試範圍</dt>
          <dd>Web 應用程式（13 個模組）</dd>
        </div>
        <div class="meta-item">
          <dt>測試框架</dt>
          <dd>Playwright v1.59 + Chromium</dd>
        </div>
        <div class="meta-item">
          <dt>測試環境</dt>
          <dd>Chromium / Desktop / 1440×900</dd>
        </div>
        <div class="meta-item">
          <dt>測試帳號</dt>
          <dd>admin@demo.com (ADMIN)</dd>
        </div>
        <div class="meta-item">
          <dt>測試時間</dt>
          <dd>${fmtDate(startedAt)}</dd>
        </div>
        <div class="meta-item">
          <dt>報告產出</dt>
          <dd>${fmtDate(reportTime)}</dd>
        </div>
        <div class="meta-item">
          <dt>分支</dt>
          <dd><code style="font-family:'SF Mono',Menlo,monospace;font-size:13px">feat/figma-design-system</code></dd>
        </div>
      </dl>
    </header>

    <div class="summary">
      <div class="stat-card rate">
        <div class="label">通過率</div>
        <div class="value">${passRate}%</div>
      </div>
      <div class="stat-card pass">
        <div class="label">通過</div>
        <div class="value">${passed}</div>
      </div>
      <div class="stat-card fail">
        <div class="label">失敗</div>
        <div class="value">${failed}</div>
      </div>
      <div class="stat-card skip">
        <div class="label">總執行時間</div>
        <div class="value" style="font-size:24px">${fmtMs(totalDurationMs)}</div>
      </div>
    </div>

    <div class="toc">
      <h2>測試覆蓋範圍</h2>
      <ul>
        ${Object.keys(SPEC_LABEL)
          .filter((f) => grouped[f])
          .map((f) => `<li>${SPEC_LABEL[f]}（${grouped[f].length} 個案例）</li>`)
          .join('')}
      </ul>
    </div>

    ${sectionsHtml}

    <div class="footer">
      <h2>附錄</h2>
      <p><strong>如何重跑測試：</strong></p>
      <ul>
        <li>啟動 Docker：<code>docker compose up -d</code>（PostgreSQL / Redis / Ollama / MinIO）</li>
        <li>啟動 API：<code>pnpm --filter @open333crm/api dev</code></li>
        <li>確認 demo seed：<code>pnpm db:seed</code></li>
        <li>執行測試：<code>pnpm --filter @open333crm/web-e2e test</code>（會自動啟動 web dev server on :3020）</li>
        <li>產出本報告：<code>node apps/web-e2e/scripts/build-qa-report.mjs</code></li>
      </ul>
      <h2 style="margin-top:20px">測試限制與假設</h2>
      <ul>
        <li>測試使用單一 demo 帳號（<code>admin@demo.com</code>），不測試多帳號權限切換</li>
        <li>需要 docker 服務 + API + demo seed 資料正常運作</li>
        <li>使用 <code>workers: 1</code> 序列執行，避免 demo 資料 race condition</li>
        <li>截圖僅為 success snapshot，失敗時會額外產出 trace.zip 與 video.webm（在 <code>test-results/</code>）</li>
        <li>本報告為自動產生，每個案例的「測試目的」與「測試步驟」由開發者預先撰寫於 <code>build-qa-report.mjs</code></li>
      </ul>
      <h2 style="margin-top:20px">驗證範圍未涵蓋</h2>
      <ul>
        <li>實際發送 LINE / FB Webhook 訊息</li>
        <li>多租戶資料隔離</li>
        <li>WebSocket 即時通知</li>
        <li>大量資料的效能測試</li>
        <li>跨瀏覽器（Firefox / Safari）</li>
        <li>行動裝置 viewport</li>
      </ul>
    </div>
  </div>

  <div class="lightbox" id="lightbox" onclick="closeLightbox()">
    <button class="close" onclick="event.stopPropagation(); closeLightbox()">×</button>
    <div class="caption" id="lightbox-caption"></div>
    <img id="lightbox-img" src="" alt="" />
  </div>

  <script>
    function openLightbox(src, caption) {
      document.getElementById('lightbox-img').src = src;
      document.getElementById('lightbox-caption').textContent = caption || '';
      document.getElementById('lightbox').classList.add('show');
      document.body.style.overflow = 'hidden';
    }
    function closeLightbox() {
      document.getElementById('lightbox').classList.remove('show');
      document.body.style.overflow = '';
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeLightbox();
    });
  </script>
</body>
</html>
`;

writeFileSync(OUT_PATH, html);
const sizeKB = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`✓ 報告已產出：${OUT_PATH}`);
console.log(`  ${total} 個測試案例（${passed} 通過 / ${failed} 失敗 / ${skipped} 跳過）`);
console.log(`  HTML 大小：${sizeKB} KB（含 ${allResults.reduce((n, r) => n + r.attachments.length, 0)} 張內嵌截圖）`);
