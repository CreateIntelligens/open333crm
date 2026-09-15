#!/usr/bin/env node
/**
 * check-workspace-esm.mjs
 *
 * CJS→ESM 轉出式 re-export 風險檢查（CM-175 防迴歸）。
 *
 * ## 背景
 *
 * `packages/core` 曾因 package.json 缺少 `"type": "module"` 被編成 CJS，而它 import 的
 * `@open333crm/database` 是純 ESM。在 UAT（Node 24）實測確認的精確行為是：
 *
 *   - `export * from '...'` 的符號 → CJS require 後**正常取得**（實測 135 個）
 *   - `export { x } from './y.js'` 的「轉出式 re-export」→ CJS require 後**符號遺失**
 *
 * `@open333crm/database` 的 `prisma` 正屬後者，因此 `database_1.prisma` 為 undefined，
 * 一存取 `.identityMap` 即 TypeError，導致新客第一則訊息全部靜默掉失。
 *
 * 此行為與 Node 版本相關（本機 Node 22 可正確取得、UAT Node 24 不行），所以本機不易重現。
 *
 * ## 為什麼需要獨立守門
 *
 * 這個退化**編譯不會報錯**：相對匯入的副檔名補齊後，拿掉 `"type": "module"` 仍可編譯成功，
 * 產物只是默默退回 CJS。TypeScript 與 typecheck 都攔不到。
 *
 * ## 檢查內容
 *
 * 只針對真正的風險組合告警，避免誤報：
 *   CJS 套件（package.json 無 type:module）import 了 ESM 套件「以轉出式 re-export 匯出的符號」。
 *
 * 用法：
 *   node scripts/check-workspace-esm.mjs          # 印報告，exit 0
 *   node scripts/check-workspace-esm.mjs --strict # 有違規 → exit 1（CI）
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const STRICT = process.argv.includes('--strict');

const WORKSPACE_DIRS = ['packages', 'apps'];

/**
 * 從 package.json 的 exports 推導出所有進入點對應的 src 檔案。
 * 套件可能有多個子路徑入口（例如 channel-plugins 有 6 個），只掃 index.ts 會漏。
 */
function entrySourceFiles(pkgDir, pkgJson) {
  const files = new Set();
  const addFromDist = (distPath) => {
    if (typeof distPath !== 'string') return;
    // ./dist/line/index.js → src/line/index.ts；./dist/telegram.js → src/telegram.ts
    const rel = distPath.replace(/^\.\//, '').replace(/^dist\//, '').replace(/\.js$/, '.ts');
    files.add(join(pkgDir, 'src', rel));
  };

  const exp = pkgJson.exports;
  if (exp && typeof exp === 'object') {
    for (const value of Object.values(exp)) {
      if (typeof value === 'string') addFromDist(value);
      else if (value && typeof value === 'object') {
        addFromDist(value.import ?? value.default ?? value.require);
      }
    }
  }
  if (typeof pkgJson.main === 'string') addFromDist(pkgJson.main);
  // 後備：至少掃 src/index.ts
  files.add(join(pkgDir, 'src', 'index.ts'));

  return [...files].filter((f) => existsSync(f));
}

/** 蒐集某套件所有進入點中以「轉出式 re-export」匯出的符號名。 */
function collectRiskySymbols(pkgDir, pkgJson) {
  const symbols = new Set();
  for (const entry of entrySourceFiles(pkgDir, pkgJson)) {
    let src;
    try {
      src = readFileSync(entry, 'utf8');
    } catch {
      continue;
    }
    // export { a, b as c } from './x.js'  ← 這種在 CJS require 下會遺失
    // 刻意不匹配 export * from（實測可正常取得）與 export type（不影響執行期）
    const re = /export\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g;
    let m;
    while ((m = re.exec(src))) {
      for (const part of m[1].split(',')) {
        const cleaned = part.trim().replace(/^type\s+/, '');
        if (!cleaned) continue;
        const name = cleaned.split(/\s+as\s+/).pop()?.trim();
        if (name) symbols.add(name);
      }
    }
  }
  return symbols;
}

function listPackages() {
  const pkgs = [];
  for (const dir of WORKSPACE_DIRS) {
    const base = join(ROOT, dir);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const pkgDir = join(base, name);
      if (!statSync(pkgDir).isDirectory()) continue;
      const pkgJson = join(pkgDir, 'package.json');
      if (!existsSync(pkgJson)) continue;
      let json;
      try {
        json = JSON.parse(readFileSync(pkgJson, 'utf8'));
      } catch {
        continue;
      }
      pkgs.push({
        rel: `${dir}/${name}`,
        dir: pkgDir,
        name: json.name,
        isEsm: json.type === 'module',
        json,
      });
    }
  }
  return pkgs;
}

function walkTs(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walkTs(p, out);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

const packages = listPackages();
const esmPackages = packages.filter((p) => p.isEsm && p.name);

// 建立「ESM 套件名 → 其轉出式 re-export 符號集合」
const riskyExports = new Map();
for (const pkg of esmPackages) {
  const symbols = collectRiskySymbols(pkg.dir, pkg.json);
  if (symbols.size > 0) riskyExports.set(pkg.name, symbols);
}

const violations = [];

for (const pkg of packages) {
  if (pkg.isEsm) continue; // ESM 套件 import ESM 套件沒問題

  for (const file of walkTs(join(pkg.dir, 'src'))) {
    let src;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const importRe = /import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = importRe.exec(src))) {
      const isTypeOnly = /import\s+type\s*\{/.test(m[0]);
      if (isTypeOnly) continue; // 型別匯入不影響執行期

      const from = m[2];
      const risky = riskyExports.get(from);
      if (!risky) continue;

      for (const raw of m[1].split(',')) {
        const cleaned = raw.trim().replace(/^type\s+/, '');
        const imported = cleaned.split(/\s+as\s+/)[0]?.trim();
        if (imported && risky.has(imported)) {
          violations.push(
            `${relative(ROOT, file)}\n    CJS 套件 ${pkg.name} 匯入 ${from} 的 "${imported}"（轉出式 re-export，執行期會是 undefined）`,
          );
        }
      }
    }
  }
}

if (violations.length === 0) {
  console.log('✅ ESM interop 檢查通過：無 CJS 套件匯入 ESM 套件的轉出式 re-export 符號。');
  process.exit(0);
}

console.error(`❌ 偵測到 CJS→ESM 轉出式 re-export 風險（${violations.length} 處）：\n`);
for (const v of violations) console.error('  ' + v + '\n');
console.error('修法擇一：');
console.error('  1. 為該 CJS 套件的 package.json 補上 "type": "module"（建議，與其餘套件一致）');
console.error('  2. 改由呼叫端注入該依賴，不在模組層級取用（如 CM-175 對 identity-stitcher 的做法）');
process.exit(STRICT ? 1 : 0);
