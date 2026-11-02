#!/usr/bin/env node
/**
 * feature-agent-guard.mjs
 *
 * 功能顧問子代理的 PreToolUse hook。在子代理的 frontmatter 掛上，只在該子代理執行期間生效。
 *
 *   node feature-agent-guard.mjs readonly   # feature-impact-reviewer：Bash 只准唯讀指令，不准寫檔
 *   node feature-agent-guard.mjs health     # feature-health-checker：擋 git 寫入、連線到遠端主機、改環境的指令；
 *                                           # Write／Edit 只准寫健檢報告、feature Skill 與暫存目錄
 *
 * 從 stdin 讀 hook 的 JSON（tool_name、tool_input）。擋下時 exit 2，理由寫在 stderr。
 * 這是字串比對，擋的是常見寫法，不是安全邊界。
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const mode = process.argv[2];
const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const tool = input.tool_name;
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

function block(reason) {
  process.stderr.write(`feature-agent-guard（${mode}）：${reason}\n`);
  process.exit(2);
}

/** 把指令拆成 `&&`、`||`、`;`、`|` 連接的各段，並去掉開頭的環境變數設定。 */
function segments(command) {
  return command
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ''))
    .filter(Boolean);
}

const READONLY_COMMANDS = [
  /^node scripts\/feature-impact\.mjs(\s|$)/,
  /^git (diff|log|show|status|ls-files|rev-parse|grep|blame|merge-base|rev-list)(\s|$)/,
  /^(grep|rg|cat|head|tail|wc|ls|pwd|echo|printf|sort|uniq|cut|tr|jq)(\s|$)/,
  /^sed -n(\s|$)/,
  /^find(\s|$)(?!.*\s-(exec|execdir|delete|ok)\b)/,
  /^cd(\s|$)/,
];

const HEALTH_BLOCKED = [
  [/\bgit\b[^\n]*\b(commit|push|reset|rebase|stash|checkout|switch|merge|cherry-pick|revert|tag|clean|am|apply)\b/, 'git 寫入操作（只記錄、不 commit、不 push）'],
  [/\bgit\b[^\n]*\bbranch\s+-[dDmM]\b/, '刪除或改名分支'],
  [/(^|[\s/])(ssh|scp|sftp|rsync)(\s|$)/, '連線到遠端主機（UAT 只透過網頁與 API 操作）'],
  [/\bprisma\b[^\n]*\b(migrate|db\s+push|db\s+execute)\b/, '改資料庫結構'],
  [/\b(db:seed|db:migrate)\b/, '重設或遷移資料庫'],
  [/\bpnpm\b[^\n]*\b(install|add|remove|i)\b/, '安裝或移除套件'],
  [/\bdocker\b[^\n]*\b(stop|rm|kill|down|restart|prune)\b/, '停止或刪除容器'],
  [/\b(flushdb|flushall)\b/i, '清空 Redis'],
  [/(^|\s)(kill|pkill|killall)(\s|$)/, '停止其他程序（共用的 API、workers、web）'],
  [/\brm\s+-[a-z]*r[a-z]*f?\b[^\n]*\s(apps|packages|openspec|\.git|docs)\b/, '刪除 repo 目錄'],
];

const HEALTH_WRITABLE = [/^docs\/ref\/features\/health\//, /^\.claude\/skills\/feature-[a-z0-9-]+\/SKILL\.md$/];

function checkReadonlyBash(command) {
  if (/(^|[^0-9&])>|>>/.test(command.replace(/2>&1|>\s*\/dev\/null/g, ''))) block('不准用重導向寫檔');
  for (const seg of segments(command)) {
    if (!READONLY_COMMANDS.some((re) => re.test(seg))) block(`只准唯讀指令，這段不在允許清單：${seg}`);
  }
}

function checkHealthBash(command) {
  for (const [re, why] of HEALTH_BLOCKED) if (re.test(command)) block(`不准${why}：${command}`);
}

function checkHealthWrite(filePath) {
  const abs = isAbsolute(filePath) ? filePath : resolve(projectDir, filePath);
  if (abs.startsWith('/private/tmp/') || abs.startsWith('/tmp/')) return;
  const rel = relative(projectDir, abs);
  if (HEALTH_WRITABLE.some((re) => re.test(rel))) return;
  block(`只准寫健檢報告、feature Skill 與暫存目錄，不准寫：${rel}`);
}

const command = input.tool_input?.command ?? '';
if (mode === 'readonly') {
  if (tool === 'Bash') checkReadonlyBash(command);
  else if (['Write', 'Edit', 'NotebookEdit'].includes(tool)) block('影響審查只讀不改');
} else if (mode === 'health') {
  if (tool === 'Bash') checkHealthBash(command);
  else if (['Write', 'Edit'].includes(tool)) checkHealthWrite(input.tool_input?.file_path ?? '');
} else {
  block(`未知的模式：${mode}`);
}
process.exit(0);
