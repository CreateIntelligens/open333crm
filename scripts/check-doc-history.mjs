#!/usr/bin/env node
/**
 * check-doc-history.mjs
 *
 * 功能文件、模組文件、feature skill 與 AGENTS.md 只描述現在的程式。歷史放在
 * docs/ref/system/AUDIT-REVIEWS.md、健檢報告與 commit 說明。本腳本擋下四種寫法：
 *
 *   issue    已關閉的 issue 或 PR 編號（#NNN）。還開著的 issue 列在
 *            scripts/check-doc-history.allow.json，可以引用
 *   change   OpenSpec change 名稱（change `xxx`）
 *   commit   commit hash（`4b384b7`）
 *   history  描述舊行為的句子（修正前、已修正、YYYY-MM-DD 之前是……）
 *
 * 描述既有資料狀態的日期可以寫，例如「2026-11-04 之前直接關閉的工單沒有 resolvedAt」。
 * 程式碼區塊不檢查。某一行確定要保留時，在行尾加 `<!-- doc-history: allow -->`。
 *
 *   node scripts/check-doc-history.mjs                 # 列出違規
 *   node scripts/check-doc-history.mjs --strict        # 有違規時 exit 1
 *   node scripts/check-doc-history.mjs --check-github  # 另外以 gh 確認允許清單裡的 issue 仍開著
 *   node scripts/check-doc-history.mjs <檔案...>       # 只檢查指定的檔案
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ALLOW_FILE = join(ROOT, 'scripts/check-doc-history.allow.json');

/** 檢查的範圍。健檢報告與 docs/ref/system/ 是歷史紀錄，不檢查。 */
function defaultFiles() {
  const files = ['AGENTS.md', 'docs/ref/features/feature-map.json'];
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = join(dir, name);
      if (statSync(join(ROOT, rel)).isDirectory()) {
        if (rel !== 'docs/ref/features/health') walk(rel);
      } else if (name.endsWith('.md')) files.push(rel);
    }
  };
  walk('docs/ref/features');
  walk('docs/ref/modules');
  for (const name of readdirSync(join(ROOT, '.claude/skills'))) {
    const rel = join('.claude/skills', name, 'SKILL.md');
    if (name.startsWith('feature-')) files.push(rel);
  }
  return files;
}

/** 日期之後接這些字時，句子描述的是既有資料，不是舊行為。 */
const DATA_STATE = '(建立|刪除|完成|核准|直接關閉|的評分|的資料|的工單|寫入|匿名化|停用)';

const RULES = [
  { rule: 'change', re: /change\s+`[a-z0-9][a-z0-9-]*`/ },
  // 至少一個字母與一個數字，才不會把 `200000` 這類數字當成 hash
  { rule: 'commit', re: /`(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}`/ },
  {
    rule: 'history',
    re: new RegExp(
      [
        '修正前',
        '修正後',
        '已修正',
        '（原 [A-Z]+-',
        '\\d{4}-\\d{2}-\\d{2} ?修正',
        `\\d{4}-\\d{2}-\\d{2}（[^）]*）?\\s*(之前|以前)(?!\\s*${DATA_STATE})`,
        `\\d{4}-\\d{2}-\\d{2}\\s*(之前|以前)(?!\\s*${DATA_STATE})`,
      ].join('|'),
    ),
  },
];

/**
 * @param {string} text 檔案內容
 * @param {{ openIssues: Set<number> }} opts
 * @returns {{ line: number, rule: string, text: string }[]}
 */
export function findViolations(text, { openIssues }) {
  const out = [];
  let inCode = false;
  text.split('\n').forEach((raw, i) => {
    if (/^\s*```/.test(raw)) {
      inCode = !inCode;
      return;
    }
    if (inCode || raw.includes('<!-- doc-history: allow -->')) return;
    // 行內程式碼裡的 #NNN 不是 issue 編號，例如 URL 的錨點
    const line = raw.replace(/`[^`]*`/g, (m) => (/^`[0-9a-f]{7,40}`$/.test(m) ? m : '``'));
    // 引號裡是名稱或畫面文字，例如狀態 "已修正"，不是在描述歷史
    const prose = line.replace(/"[^"]*"/g, '""');
    for (const m of line.matchAll(/(?<![\w/&#])#(\d{3,5})\b/g)) {
      if (!openIssues.has(Number(m[1]))) out.push({ line: i + 1, rule: 'issue', text: raw.trim() });
    }
    for (const { rule, re } of RULES) {
      if (re.test(rule === 'commit' ? line : rule === 'history' ? prose : raw)) out.push({ line: i + 1, rule, text: raw.trim() });
    }
  });
  return out;
}

function loadOpenIssues() {
  const { openIssues } = JSON.parse(readFileSync(ALLOW_FILE, 'utf8'));
  return new Set(openIssues);
}

/** 允許清單裡已經關閉的 issue。需要 gh CLI。 */
function closedAllowedIssues(openIssues) {
  return [...openIssues].filter((n) => {
    const state = execFileSync('gh', ['issue', 'view', String(n), '--json', 'state', '-q', '.state'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    return state !== 'OPEN';
  });
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const files = args.filter((a) => !a.startsWith('--'));
  const openIssues = loadOpenIssues();
  let count = 0;

  if (args.includes('--check-github')) {
    for (const n of closedAllowedIssues(openIssues)) {
      console.log(`scripts/check-doc-history.allow.json: #${n} 已經關閉，從允許清單移除，並更新引用它的文件`);
      count += 1;
    }
  }

  for (const file of files.length ? files.map((f) => relative(ROOT, resolve(f))) : defaultFiles()) {
    for (const v of findViolations(readFileSync(join(ROOT, file), 'utf8'), { openIssues })) {
      console.log(`${file}:${v.line}: [${v.rule}] ${v.text.slice(0, 160)}`);
      count += 1;
    }
  }

  if (count === 0) {
    console.log('沒有找到歷史寫法。');
    return;
  }
  console.log(`\n共 ${count} 處。文件只描述現在的程式；歷史放在 docs/ref/system/AUDIT-REVIEWS.md 與 commit 說明。`);
  if (strict) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
