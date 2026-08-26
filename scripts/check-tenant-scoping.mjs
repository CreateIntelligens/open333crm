#!/usr/bin/env node
/**
 * check-tenant-scoping.mjs
 *
 * 靜態檢查：對「租戶表」的 Prisma query 是否漏帶 tenantId → 潛在跨租戶洩漏。
 *
 * 多租戶隔離靠「每個 query 的 where 帶 tenantId」（非 DB RLS）。漏帶 = 跨租戶洩漏（critical）。
 * 本腳本掃 apps/api/src 下所有 .ts，對租戶表的 query 檢查其 call 範圍內是否關聯到 tenantId。
 *
 * 分級：
 *   LEAK_SUSPECT — 租戶表 query，call 範圍內完全找不到 tenantId 關聯（疑似漏帶）
 *   NEEDS_REVIEW — where 用外部變數且追不到定義，無法靜態判斷
 * 白名單情境（合法跨租戶 / 靠 unique 約束）直接跳過。
 *
 * 用法：
 *   node scripts/check-tenant-scoping.mjs          # dry-run，只印報告，exit 0
 *   node scripts/check-tenant-scoping.mjs --strict # LEAK_SUSPECT > 0 時 exit 1（給 CI）
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIR = join(ROOT, 'apps/api/src');
const STRICT = process.argv.includes('--strict');

// ── 租戶表（有 tenantId 欄位，Prisma client camelCase 屬性名）──
const TENANT_MODELS = new Set([
  'agent', 'role', 'team', 'channel', 'contact', 'tag', 'conversation', 'chatboxSession',
  'case', 'slaPolicy', 'automationRule', 'automationExecution', 'automationActionResult',
  'automationLog', 'kmArticle', 'messageTemplate', 'material', 'notification', 'dailyStat',
  'tenantSettings', 'segment', 'campaign', 'broadcast', 'richMenu', 'webhookSubscription',
  'portalActivity', 'portalSubmission', 'pointTransaction', 'shortLink', 'interactionFlow',
  'flowExecution', 'identityMap', 'mergeSuggestion', 'partnerApiKey', 'cliSession',
  'passkeyCredential', 'quickReplyPreset', 'kbArticleFeedback', 'aiUsage', 'trialSignup',
  'planChangeRequest', 'tenantAuditLog', 'dataExportRequest', 'dataErasureRequest',
]);

// query 方法（會回傳/影響多列、需 tenantId 限定的）
const SCOPED_METHODS = new Set([
  'findMany', 'findFirst', 'update', 'updateMany', 'delete', 'deleteMany',
  'count', 'aggregate', 'groupBy', 'findFirstOrThrow',
]);
// findUnique / findUniqueOrThrow：靠 unique 約束，另分類（多為 by id）
const UNIQUE_METHODS = new Set(['findUnique', 'findUniqueOrThrow']);

// ── 白名單：合法跨租戶 / 隔離入口的檔案（相對 apps/api/src）──
const WHITELIST_FILES = [
  /modules\/platform\//,          // 平台層跨租戶（usage 統計等）是設計
  /modules\/auth\/auth\.service/, // email 全域查 agent 是隔離入口
  /modules\/auth\/partner-api-key/, // API key 認證：by keyPrefix 全域查候選（認證入口）
  /plugins\/auth\.plugin/,        // 認證解析
  /\.scheduler\./,                // scheduler 掃全租戶是設計
  /platform-tenant\.service/,     // provisionTenant 建租戶時還沒 tenantId
  /chatbox\.service/,             // by publicKey 解析 webchat channel（訪客入口，publicKey 全域 unique）
  /modules\/trial\//,             // trial 申請/gmail 去重：跨租戶查候選是防濫用設計
  /inbound-router/,               // 目前為 mock（真實 query 在註解內）
  /__tests__\//,                  // 測試
];

function isWhitelisted(relPath) {
  return WHITELIST_FILES.some((re) => re.test(relPath));
}

// ── 遞迴收集 .ts ──
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

// 從 openParenIdx（'(' 的位置）做括號配對，回傳 [start, end]（含括號內容）
function matchParen(src, openParenIdx) {
  let depth = 0;
  for (let i = openParenIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return [openParenIdx, i];
    }
  }
  return [openParenIdx, src.length];
}

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

// 在函式範圍內往上找變數定義是否含 tenantId
// 簡化：抓 callStart 之前同檔最近的 `const <var> = {...}` 或 `<var>.tenantId` / `where.tenantId`
function varLikelyHasTenantId(src, varName, callStart) {
  const before = src.slice(0, callStart);
  // const where = { ... tenantId ... }（抓最近一個定義）
  const defRe = new RegExp(`(?:const|let|var)\\s+${varName}\\s*(?::[^=]+)?=\\s*\\{`, 'g');
  let lastDef = -1, m;
  while ((m = defRe.exec(before)) !== null) lastDef = m.index;
  if (lastDef >= 0) {
    // 抓該物件字面範圍（花括號配對）
    const braceStart = before.indexOf('{', lastDef);
    let depth = 0, end = braceStart;
    for (let i = braceStart; i < before.length; i++) {
      if (before[i] === '{') depth++;
      else if (before[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const objText = before.slice(braceStart, end + 1);
    if (/tenantId/.test(objText)) return true;
  }
  // where.tenantId = ... / varName.tenantId = ...（動態塞）
  if (new RegExp(`${varName}\\.tenantId\\s*=`).test(before)) return true;
  if (new RegExp(`${varName}\\.AND|${varName}\\.OR`).test(before) && /tenantId/.test(before)) return true;
  return false;
}

const results = { LEAK_SUSPECT: [], NEEDS_REVIEW: [], UNIQUE_BY_KEY: [], skipped: 0 };

// 匹配 prisma.<model>.<method>( / tx.<model>.<method>( / fastify.prisma.<model>.<method>(
const CALL_RE = /(?:prisma|tx|fastify\.prisma)\.([a-zA-Z]+)\.([a-zA-Z]+)\s*\(/g;

for (const file of walk(SCAN_DIR)) {
  const rel = relative(SCAN_DIR, file);
  const rawSrc = readFileSync(file, 'utf8');
  // 移除註解避免誤抓「註解裡的假 query」（如 // return prisma.x.findFirst(...)）。
  // 保留行數：block 註解換成等量空白，單行註解換成空白（行號不變，lineOf 才準）。
  const src = rawSrc
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  const whitelisted = isWhitelisted(rel);

  let m;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(src)) !== null) {
    const model = m[1];
    const method = m[2];
    if (!TENANT_MODELS.has(model)) continue;
    const isUnique = UNIQUE_METHODS.has(method);
    if (!isUnique && !SCOPED_METHODS.has(method)) continue;

    if (whitelisted) { results.skipped++; continue; }

    const openParen = src.indexOf('(', m.index + m[0].length - 1);
    const [s, e] = matchParen(src, openParen);
    const callText = src.slice(s, e + 1);
    const line = lineOf(src, m.index);
    const loc = `${rel}:${line}`;
    const snippet = `prisma.${model}.${method}(...)`;

    // call 範圍內直接有 tenantId → 安全
    if (/tenantId/.test(callText)) continue;

    // where 是外部變數（含 shorthand `where,` / `where }` / `where:varName`）→ 追定義
    const whereVarMatch =
      callText.match(/where:\s*([a-zA-Z_][a-zA-Z0-9_]*)\b/) ||       // where: varName
      (/\bwhere\s*[,}]/.test(callText) ? [null, 'where'] : null);     // shorthand where,
    if (whereVarMatch && whereVarMatch[1] !== 'undefined') {
      const varName = whereVarMatch[1];
      if (varLikelyHasTenantId(src, varName, s)) continue; // 追到含 tenantId
      results.NEEDS_REVIEW.push({ loc, snippet, note: `where 用變數 ${varName}，靜態追不到 tenantId` });
      continue;
    }

    // findUnique by 全域 unique key（id/email/token）→ 另分類（靠 unique 約束）
    if (isUnique) {
      results.UNIQUE_BY_KEY.push({ loc, snippet, note: 'findUnique，靠 unique 約束（多為 by id）' });
      continue;
    }

    // by 主鍵 { id } / { id: x } / { id, ... } → 常見合法模式（上游已驗 tenantId 擁有權再 by id）。
    // 含 shorthand `{ id }`、`{ id,`、`{ id:`。降級 NEEDS_REVIEW。
    if (/where:\s*\{\s*id\s*[:,}]/.test(callText)) {
      results.NEEDS_REVIEW.push({ loc, snippet, note: 'by 主鍵 id（需確認上游已驗 tenantId 擁有權）' });
      continue;
    }

    // by 已驗證的外鍵（contactId/conversationId/caseId/roleId 等）→ 間接隔離。
    // 含 shorthand `{ contactId }`、`{ contactId,`、`{ contactId:`。降 NEEDS_REVIEW。
    if (/where:\s*\{\s*\w*(Id|_id)\s*[:,}]/.test(callText)) {
      results.NEEDS_REVIEW.push({ loc, snippet, note: 'by 外鍵（間接隔離，需確認父物件已驗 tenantId）' });
      continue;
    }

    // 租戶表 scoped query 完全沒 tenantId、也非上述情況 → 疑似漏帶。
    // updateMany/deleteMany 特別危險（會影響多列），即使被降級也標高風險。
    const dangerous = method === 'updateMany' || method === 'deleteMany';
    results.LEAK_SUSPECT.push({ loc, snippet, dangerous });
  }
}

// ── 報告 ──
const C = { red: '\x1b[31m', yellow: '\x1b[33m', gray: '\x1b[90m', green: '\x1b[32m', bold: '\x1b[1m', reset: '\x1b[0m' };
console.log(`\n${C.bold}== 租戶隔離靜態檢查（漏帶 tenantId）==${C.reset}`);
console.log(`${C.gray}掃描 ${SCAN_DIR}｜白名單跳過 ${results.skipped} 筆${C.reset}\n`);

console.log(`${C.red}${C.bold}LEAK_SUSPECT（疑似漏帶 tenantId → 跨租戶洩漏）：${results.LEAK_SUSPECT.length}${C.reset}`);
for (const r of results.LEAK_SUSPECT) console.log(`  ${C.red}✗${C.reset} ${r.loc}  ${C.gray}${r.snippet}${C.reset}`);

console.log(`\n${C.yellow}NEEDS_REVIEW（where 變數追不到，需人工確認）：${results.NEEDS_REVIEW.length}${C.reset}`);
for (const r of results.NEEDS_REVIEW) console.log(`  ${C.yellow}?${C.reset} ${r.loc}  ${C.gray}${r.snippet} — ${r.note}${C.reset}`);

console.log(`\n${C.gray}UNIQUE_BY_KEY（findUnique 靠 unique 約束，較低風險）：${results.UNIQUE_BY_KEY.length}${C.reset}`);
for (const r of results.UNIQUE_BY_KEY) console.log(`  ${C.gray}· ${r.loc}  ${r.snippet}${C.reset}`);

console.log('');
if (STRICT && results.LEAK_SUSPECT.length > 0) {
  console.log(`${C.red}${C.bold}✗ --strict：發現 ${results.LEAK_SUSPECT.length} 筆疑似漏帶，CI 失敗${C.reset}\n`);
  process.exit(1);
}
console.log(`${C.green}✓ 檢查完成（dry-run，exit 0）${C.reset}\n`);
