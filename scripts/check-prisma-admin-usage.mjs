#!/usr/bin/env node
/**
 * check-prisma-admin-usage.mjs
 *
 * RLS 白名單檢查：`prismaAdmin`（BYPASSRLS 連線）只該用於白名單情境
 * （平台/認證/scheduler/OAuth 回調/公開 webhook）。非白名單檔案用 prismaAdmin
 * = 該走 RLS 卻 bypass = 隔離形同虛設。本腳本掃 apps/api/src，非白名單檔案
 * 使用 fastify.prismaAdmin / request.server.prismaAdmin / app.prismaAdmin 即報錯。
 *
 * 用法：
 *   node scripts/check-prisma-admin-usage.mjs          # 印報告，exit 0
 *   node scripts/check-prisma-admin-usage.mjs --strict # 非白名單用 prismaAdmin → exit 1（CI）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIR = join(ROOT, 'apps/api/src');
const STRICT = process.argv.includes('--strict');

// 白名單：合法可用 prismaAdmin（BYPASSRLS）的檔案（相對 apps/api/src）。
// 對應 RLS 設計：平台跨租戶、認證入口、scheduler/worker 掃全租戶、OAuth 回調、公開 webhook。
const WHITELIST = [
  /plugins\/prisma\.plugin/,        // 定義 prismaAdmin 本身
  /plugins\/auth\.plugin/,          // CLI/partner 認證入口
  /plugins\/socket\.plugin/,        // authenticated socket room authorization with explicit tenant/resource scope
  /guards\/rbac\.guard/,            // 授權查詢（角色/方案天花板）
  /modules\/platform\//,            // 平台層跨租戶
  /modules\/auth\//,                // 登入 email 全域解析、passkey
  /modules\/trial\//,               // trial 防濫用跨租戶
  /modules\/cli\//,                 // CLI 分析（自身 scope 機制）
  /modules\/line-login\//,          // OAuth 回調
  /modules\/fb-login\//,            // OAuth 回調
  /modules\/line\/line-profile/,    // LINE profile（認證相關）
  /modules\/webhook\//,             // 公開入站 webhook（無 JWT，channel 反查）
  /\.scheduler\./,                  // scheduler 掃全租戶
  /\.worker\./,                     // worker 以 payload.tenantId 自 scope
  /index\.ts$/,                     // bootstrap 接線 scheduler/worker
  /__tests__\//,                    // 測試
];

function isWhitelisted(rel) {
  return WHITELIST.some((re) => re.test(rel));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const ADMIN_RE = /(?:fastify|request\.server|app|this)\.prismaAdmin\b/;

const violations = [];
for (const file of walk(SCAN_DIR)) {
  const rel = relative(SCAN_DIR, file);
  if (isWhitelisted(rel)) continue;
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    // 略過註解行
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (ADMIN_RE.test(line)) {
      violations.push(`${rel}:${i + 1}  ${trimmed.slice(0, 80)}`);
    }
  });
}

if (violations.length === 0) {
  console.log('✅ prismaAdmin 白名單檢查通過：非白名單檔案皆未使用 prismaAdmin。');
  process.exit(0);
}

console.error(`❌ 非白名單檔案使用 prismaAdmin（${violations.length} 處）——該走 RLS 卻 bypass：`);
for (const v of violations) console.error('  ' + v);
console.error('\n若確為合法白名單，請加進 scripts/check-prisma-admin-usage.mjs 的 WHITELIST 並註明理由。');
process.exit(STRICT ? 1 : 0);
