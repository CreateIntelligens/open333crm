#!/usr/bin/env node
/**
 * feature-impact.mjs
 *
 * 跨功能影響分析：給一組改動，列出會被影響的功能領域，以及每個領域要看的 Skill、規格、
 * 已知問題與要重跑的測試。資料來源是 `docs/ref/features/feature-map.json`。
 *
 * ## 判斷方式
 *
 * 1. 直接影響：改動的檔案符合某領域的 `paths`、`pages` 或 `tests`。
 * 2. 資料表與事件：改動內容（diff 的增刪行）提到某領域的 `tables` 或 `events`。
 *    `commonTables` 列的表（例如 Tenant）幾乎每個領域都用，不納入比對。
 * 3. 間接影響：直接受影響領域的 `usedBy`，以及別的領域 `dependsOn` 指向它。
 *
 * 用法：
 *   node scripts/feature-impact.mjs                      # 比對 origin/main...HEAD 加上未 commit 的改動
 *   node scripts/feature-impact.mjs --base main          # 指定比較基準
 *   node scripts/feature-impact.mjs --files a.ts b.tsx   # 只看指定檔案（不讀 diff 內容）
 *   node scripts/feature-impact.mjs --range A..B         # 只看兩個 commit 之間的改動，例如回頭檢查已合併的 PR
 *   node scripts/feature-impact.mjs --domain contacts    # 列出某領域被誰依賴、依賴誰
 *   node scripts/feature-impact.mjs --json               # 輸出 JSON
 *   node scripts/feature-impact.mjs --check              # 驗證功能地圖與 Skill 引用的路徑都存在，有錯 exit 1
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MAP_PATH = 'docs/ref/features/feature-map.json';
const args = process.argv.slice(2);

function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function argList(name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const out = [];
  for (const a of args.slice(i + 1)) {
    if (a.startsWith('--')) break;
    out.push(a);
  }
  return out;
}

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

/** 把 glob 轉成正規表示式：`**` 可跨目錄，`*` 與 `?` 不跨 `/`。沒有萬用字元時，也比對成目錄前綴。 */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  if (!/[*?]/.test(glob)) re += '(?:/.*)?';
  return new RegExp(`^${re}$`);
}

function loadMap() {
  const map = JSON.parse(readFileSync(join(ROOT, MAP_PATH), 'utf8'));
  for (const d of map.domains) {
    d._fileRes = [...(d.paths ?? []), ...(d.pages ?? []), ...(d.tests ?? []), ...(d.e2e ?? [])].map((g) => [
      g,
      globToRegExp(g),
    ]);
  }
  return map;
}

function rangeFiles(range) {
  return git('diff', '--name-only', range).split('\n').filter(Boolean);
}

function rangeLines(range) {
  return git('diff', '-U0', range)
    .split('\n')
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l))
    .join('\n');
}

function changedFiles(base) {
  const files = new Set();
  const add = (out) => out.split('\n').filter(Boolean).forEach((f) => files.add(f));
  add(git('diff', '--name-only', `${base}...HEAD`));
  add(git('diff', '--name-only', 'HEAD'));
  add(git('ls-files', '--others', '--exclude-standard'));
  return [...files];
}

function changedLines(base) {
  const diff = git('diff', '-U0', `${base}...HEAD`) + git('diff', '-U0', 'HEAD');
  return diff
    .split('\n')
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l))
    .join('\n');
}

function wordRe(token) {
  return new RegExp(`(?<![A-Za-z0-9_])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`);
}

function analyze(map, files, diffText) {
  const byId = new Map(map.domains.map((d) => [d.id, d]));
  const common = new Set(map.commonTables ?? []);
  /** id → { domain, level: 'direct' | 'data' | 'indirect', reasons: string[] } */
  const hits = new Map();
  const hit = (id, level, reason) => {
    const rank = { direct: 0, data: 1, indirect: 2 };
    const h = hits.get(id) ?? { domain: byId.get(id), level, reasons: [] };
    if (rank[level] < rank[h.level]) h.level = level;
    if (!h.reasons.includes(reason)) h.reasons.push(reason);
    hits.set(id, h);
  };

  for (const d of map.domains) {
    for (const f of files) {
      const m = d._fileRes.find(([, re]) => re.test(f));
      if (m) hit(d.id, 'direct', `改到 ${f}（符合 ${m[0]}）`);
    }
  }

  if (diffText) {
    for (const d of map.domains) {
      for (const t of d.tables ?? []) {
        if (!common.has(t) && wordRe(t).test(diffText)) hit(d.id, 'data', `改動內容提到資料表 ${t}`);
      }
      for (const e of d.events ?? []) {
        if (wordRe(e).test(diffText)) hit(d.id, 'data', `改動內容提到事件或佇列 ${e}`);
      }
    }
  }

  // 被依賴、但還沒建好地圖與 Skill 的領域，另外列出
  const pending = new Set();
  for (const id of [...hits.keys()]) {
    const d = byId.get(id);
    for (const u of d.usedBy ?? []) {
      if (byId.has(u.domain)) hit(u.domain, 'indirect', `${d.title} 被它使用：${u.why}`);
      else pending.add(`${u.domain}（${u.why}）`);
    }
    for (const other of map.domains) {
      for (const dep of other.dependsOn ?? []) {
        if (dep.domain === id) hit(other.id, 'indirect', `它依賴 ${d.title}：${dep.why}`);
      }
    }
  }
  const results = [...hits.values()].filter((h) => h.domain);
  results.pending = [...pending];
  return results;
}

function printReport(results) {
  if (results.length === 0) {
    console.log('沒有對應到任何功能領域。若改動是功能程式，請把路徑補進 ' + MAP_PATH + '。');
    return;
  }
  const label = { direct: '直接影響', data: '資料表或事件相關', indirect: '間接影響' };
  for (const level of ['direct', 'data', 'indirect']) {
    const group = results.filter((r) => r.level === level);
    if (group.length === 0) continue;
    console.log(`\n## ${label[level]}（${group.length}）`);
    for (const { domain: d, reasons } of group) {
      console.log(`\n### ${d.title}（${d.id}）`);
      console.log(`- Skill：feature-${d.id}`);
      for (const r of reasons.slice(0, 6)) console.log(`- 原因：${r}`);
      if (reasons.length > 6) console.log(`- 另有 ${reasons.length - 6} 個原因`);
      if (level === 'indirect') continue;
      if (d.specs?.length) console.log(`- 規格（改既有需求用 MODIFIED）：${d.specs.map((s) => `openspec/specs/${s}`).join('、')}`);
      if (d.audit?.length) console.log(`- 已知問題：${d.audit.join('、')}（docs/ref/system/AUDIT.md）`);
      if (d.tests?.length) console.log(`- 測試：${d.tests.join('、')}`);
      if (d.e2e?.length) console.log(`- E2E：${d.e2e.join('、')}`);
      if (d.health) console.log(`- 健檢報告與手動回歸流程：${d.health}`);
    }
  }
  if (results.pending?.length) {
    console.log('\n## 尚未建立 Skill 的相關領域（請手動確認）');
    for (const p of results.pending) console.log(`- ${p}`);
  }
  console.log('\n間接影響的領域：讀它的 Skill「跨功能牽連」與「回歸清單」，確認這次改動沒有破壞它。');
}

function printDomain(map, id) {
  const d = map.domains.find((x) => x.id === id);
  if (!d) {
    console.error(`找不到領域 ${id}。可用：${map.domains.map((x) => x.id).join(', ')}`);
    process.exit(2);
  }
  console.log(`# ${d.title}（${d.id}）\n\n## 依賴`);
  for (const x of d.dependsOn ?? []) console.log(`- ${x.domain}：${x.why}`);
  console.log('\n## 被依賴');
  for (const x of d.usedBy ?? []) console.log(`- ${x.domain}：${x.why}`);
  for (const other of map.domains) {
    for (const dep of other.dependsOn ?? []) if (dep.domain === id) console.log(`- ${other.id}：${dep.why}`);
  }
}

function check(map) {
  const errors = [];
  const tracked = git('ls-files').split('\n').filter(Boolean);
  const schema = readFileSync(join(ROOT, 'packages/database/prisma/schema.prisma'), 'utf8');
  const audit = readFileSync(join(ROOT, 'docs/ref/system/AUDIT.md'), 'utf8');
  // plannedDomains：尚未建好 Skill 的領域，可以被依賴關係引用
  const ids = new Set([...map.domains.map((d) => d.id), ...(map.plannedDomains ?? [])]);
  const exists = (p) => tracked.some((f) => globToRegExp(p).test(f)) || existsSync(join(ROOT, p));

  for (const d of map.domains) {
    const where = `[${d.id}]`;
    for (const field of ['paths', 'pages', 'tests', 'e2e', 'manual']) {
      for (const g of d[field] ?? []) if (!exists(g)) errors.push(`${where} ${field} 沒有符合的檔案：${g}`);
    }
    for (const f of [d.doc, d.health].filter(Boolean)) if (!existsSync(join(ROOT, f))) errors.push(`${where} 檔案不存在：${f}`);
    for (const s of d.specs ?? []) {
      if (!existsSync(join(ROOT, 'openspec/specs', s, 'spec.md'))) errors.push(`${where} 規格不存在：openspec/specs/${s}`);
    }
    for (const a of d.audit ?? []) if (!audit.includes(a)) errors.push(`${where} AUDIT.md 沒有 ${a}`);
    for (const t of d.tables ?? []) {
      if (!new RegExp(`^model ${t} \\{`, 'm').test(schema)) errors.push(`${where} schema.prisma 沒有 model ${t}`);
    }
    for (const x of [...(d.dependsOn ?? []), ...(d.usedBy ?? [])]) {
      if (!ids.has(x.domain)) errors.push(`${where} 指向不存在的領域：${x.domain}`);
    }
    const skill = `.claude/skills/feature-${d.id}/SKILL.md`;
    if (!existsSync(join(ROOT, skill))) {
      errors.push(`${where} 缺少 Skill：${skill}`);
      continue;
    }
    // Skill 內以反引號標示、看起來像 repo 路徑的字串，都必須存在
    const text = readFileSync(join(ROOT, skill), 'utf8');
    for (const [, p] of text.matchAll(/`((?:apps|packages|docs|openspec|scripts|\.claude)\/[^`\s:]+?)(?::\d+)?`/g)) {
      if (!exists(p)) errors.push(`${where} ${skill} 引用的路徑不存在：${p}`);
    }
  }

  if (errors.length) {
    console.error(errors.map((e) => `錯誤：${e}`).join('\n'));
    console.error(`\n${errors.length} 個問題。`);
    process.exit(1);
  }
  console.log(`功能地圖檢查通過：${map.domains.length} 個領域。`);
}

const map = loadMap();
if (args.includes('--check')) check(map);
else if (argValue('--domain')) printDomain(map, argValue('--domain'));
else {
  const listed = argList('--files');
  const range = argValue('--range');
  const base = argValue('--base') ?? 'origin/main';
  const files = listed ?? (range ? rangeFiles(range) : changedFiles(base));
  const results = analyze(map, files, listed ? '' : range ? rangeLines(range) : changedLines(base));
  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        results.map(({ domain: d, level, reasons }) => ({ id: d.id, title: d.title, level, reasons })),
        null,
        2,
      ),
    );
  } else {
    console.log(`# 跨功能影響分析\n\n比對 ${files.length} 個檔案${listed ? '' : range ? `（${range}）` : `（基準 ${base}）`}。`);
    printReport(results);
  }
}
