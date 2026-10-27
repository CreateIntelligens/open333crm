#!/usr/bin/env node
/**
 * check-tenant-ctx.mjs
 *
 * 搬遷 ratchet（issue #337，主規格 tenant-transaction-context）：舊寫法的數量只減不增。
 * 新寫法是「flow 或背景工作以 inTenant() 開交易，service 只收 TenantCtx」。
 * 本腳本計算下列寫法在每個檔案的次數，與基準檔比較；任一檔案的次數變多就算增加。
 * service 檔直接 import Redis client 或 LLM 入口也算舊寫法：這些依賴不經過參數，型別擋不住
 * 「交易內不呼叫外部服務」「commit 之後才清快取」，要由 flow 注入（change migrate-role-agent-tenant-ctx）。
 *
 * 這兩種以 TypeScript 解析語法樹計數，不用文字比對（review-loop 第 2 輪：文字比對換一種合法寫法就擋不到）：
 * - import：靜態 import、re-export、`import x = require()`、動態 `import()`、`require()` 都算；
 *   `import type`、`{ type X }`、註解與字串裡的文字不算。
 * 以檔案為單位比較，避免一個檔案減少、另一個檔案增加互相抵銷。
 *
 * 其他寫法（TenantDb、request.tenantPrisma、service 內開交易）用文字比對計數，註解裡的字也會算到；
 * 基準檔用同樣的方式產生，所以不影響「只減不增」。
 *
 * 用法：
 *   node scripts/check-tenant-ctx.mjs                    # 印報告，exit 0
 *   node scripts/check-tenant-ctx.mjs --strict           # 有增加 → exit 1
 *   node scripts/check-tenant-ctx.mjs --update-baseline  # 以目前的次數重寫基準檔
 *   --scan-dir <dir>   改掃指定資料夾（測試用，預設 apps/api/src）；沒有值時 exit 2
 *   --baseline <file>  改用指定基準檔（測試用，預設 scripts/check-tenant-ctx.baseline.json）
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// typescript 只裝在 apps/api：以那裡的 package.json 為起點載入
const ts = createRequire(join(ROOT, 'apps/api/package.json'))('typescript');

function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  const value = process.argv[i + 1];
  // 沒有值，或下一個是另一個參數：不要把 undefined 或 --strict 當成路徑
  if (!value || value.startsWith('--')) {
    console.error(`${name} 需要一個路徑`);
    process.exit(2);
  }
  return resolve(value);
}

const SCAN_DIR = argValue('--scan-dir') ?? join(ROOT, 'apps/api/src');
const BASELINE = argValue('--baseline') ?? join(ROOT, 'scripts/check-tenant-ctx.baseline.json');
const STRICT = process.argv.includes('--strict');
const UPDATE = process.argv.includes('--update-baseline');

/** service 檔：*.service.ts，以及 services/ 底下的檔案 */
const isServiceFile = (rel) => rel.endsWith('.service.ts') || rel.startsWith('services/');
const anyFile = () => true;

const PATTERNS = [
  { name: 'TenantDb', re: /\bTenantDb\b/g, applies: anyFile },
  { name: 'request.tenantPrisma', re: /\b(?:request|req)\.tenantPrisma\b/g, applies: anyFile },
  // service 不自己開交易：交易由入口開，service 只收 TenantCtx。
  // 呼叫可以帶泛型參數或空白（inTenant<T>(、$transaction (），都要算到
  { name: 'service 內的 withTenant(', re: /\bwithTenant\s*(?:<[^>()]*>\s*)?\(/g, applies: isServiceFile },
  { name: 'service 內的 $transaction(', re: /\$transaction\s*(?:<[^>()]*>\s*)?\(/g, applies: isServiceFile },
  { name: 'service 內的 inTenant(', re: /\binTenant\s*(?:<[^>()]*>\s*)?\(/g, applies: isServiceFile },
  // Redis：core 的 redis singleton 或 namespace，或 ioredis 的任何值 import
  {
    name: 'service 直接 import Redis client',
    count: (sf) =>
      moduleRefs(sf).filter(
        ({ from, names, whole }) =>
          from === 'ioredis' || (from === '@open333crm/core' && (whole || names.includes('redis'))),
      ).length,
    applies: isServiceFile,
  },
  // LLM：llm.service 或 providers/ 底下（型別檔 types.js 除外）的任何值 import
  {
    name: 'service 直接 import LLM 入口',
    count: (sf) => moduleRefs(sf).filter(({ from }) => /(?:^|\/)(?:llm\.service|providers\/(?!types\.js$)[^/]+)\.js$/.test(from)).length,
    applies: isServiceFile,
  },
];

/**
 * 檔案引用其他模組的值：每一筆是 { from, names, whole }。
 * names 是具名引用的原名（`as` 之前），whole 表示引用整個模組（預設、namespace、require、動態 import）。
 * 只引用型別的不算。
 */
function moduleRefs(sf) {
  const refs = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause && !clause.isTypeOnly) {
        const bindings = clause.namedBindings;
        const names =
          bindings && ts.isNamedImports(bindings)
            ? bindings.elements.filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text)
            : [];
        const whole = Boolean(clause.name) || Boolean(bindings && ts.isNamespaceImport(bindings));
        if (whole || names.length > 0) refs.push({ from: node.moduleSpecifier.text, names, whole });
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) {
        const clause = node.exportClause;
        const names =
          clause && ts.isNamedExports(clause)
            ? clause.elements.filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text)
            : [];
        const whole = !clause || ts.isNamespaceExport(clause);
        if (whole || names.length > 0) refs.push({ from: node.moduleSpecifier.text, names, whole });
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      refs.push({ from: node.moduleReference.expression.text, names: [], whole: true });
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) refs.push({ from: node.arguments[0].text, names: [], whole: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return refs;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** { 寫法: { 相對路徑: 次數 } }，只記次數大於 0 的檔案 */
function count() {
  const result = Object.fromEntries(PATTERNS.map((p) => [p.name, {}]));
  for (const file of walk(SCAN_DIR).sort()) {
    const rel = relative(SCAN_DIR, file).split(sep).join('/');
    const text = readFileSync(file, 'utf8');
    let sf = null;
    for (const p of PATTERNS) {
      if (!p.applies(rel)) continue;
      if (p.count) sf ??= ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
      const n = p.count ? p.count(sf) : (text.match(p.re)?.length ?? 0);
      if (n > 0) result[p.name][rel] = n;
    }
  }
  return result;
}

const current = count();

if (UPDATE) {
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`已更新基準檔：${relative(process.cwd(), BASELINE) || BASELINE}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`找不到基準檔 ${BASELINE}，請先執行 --update-baseline`);
  process.exit(STRICT ? 1 : 0);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const increased = [];
let decreased = false;

for (const p of PATTERNS) {
  const now = current[p.name];
  const before = baseline[p.name] ?? {};
  for (const file of new Set([...Object.keys(now), ...Object.keys(before)])) {
    const a = before[file] ?? 0;
    const b = now[file] ?? 0;
    if (b > a) increased.push(`  ${p.name}：${file} ${a} → ${b}`);
    else if (b < a) decreased = true;
  }
}

const total = (counts) => Object.values(counts).reduce((s, n) => s + n, 0);
console.log('舊寫法的次數（基準 → 目前）：');
for (const p of PATTERNS) {
  console.log(`  ${p.name}：${total(baseline[p.name] ?? {})} → ${total(current[p.name])}`);
}

if (increased.length > 0) {
  console.error(
    `\n舊寫法增加（${increased.length} 處）。新程式由 flow 以 inTenant() 開交易，service 收 TenantCtx（見 AGENTS.md 結構規則 2）：`,
  );
  for (const line of increased) console.error(line);
}
if (decreased) {
  console.log('\n舊寫法有減少，請執行 node scripts/check-tenant-ctx.mjs --update-baseline 更新基準檔。');
}

process.exit(STRICT && increased.length > 0 ? 1 : 0);
