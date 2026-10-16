/**
 * 後台介面的文字不放 emoji（✓、⚠、🎉 等），使用者覺得「很 AI」；層次靠色彩、排版與 badge。
 *
 * 文字散在各元件裡，畫面測試無法逐一涵蓋，所以這裡掃描 src 下的原始碼字串。
 * 註解不算。會送給顧客的內容（例如 LINE 快速回覆按鈕、轉接客服按鈕的預設文字）
 * 與引用顧客實際看到的按鈕文字，以字串片段列在 ALLOWED；同一行的其他內容照常檢查。
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const SRC = fileURLToPath(new URL('../../../src', import.meta.url));
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/**
 * 允許保留的字串片段（只有這些字串本身可以含 emoji，同一行的其他內容照常檢查）。
 * 檔案相對路徑 → 片段與原因。
 */
const ALLOWED: Record<string, { fragments: string[]; reason: string }> = {
  'app/dashboard/line/quick-replies/page.tsx': {
    fragments: ["'😍 非常滿意'", "'🙂 還可以'", "'😕 不滿意'"],
    reason: '快速回覆預設組範例是送給顧客的 LINE 按鈕文字',
  },
  'components/settings/BotConfigForm.tsx': {
    fragments: ["'💬 轉接客服'", '"💬 轉接客服"'],
    reason: '轉接客服按鈕的預設文字會送給顧客',
  },
  'app/dashboard/knowledge/page.tsx': {
    fragments: ['「👎 沒幫到我」'],
    reason: '引用顧客在 LINE 實際看到的按鈕文字',
  },
  'app/design-preview/page.tsx': {
    fragments: ['✨ AI 建議', '✨ 判斷依據'],
    reason: '內部設計預覽頁，不是給使用者的介面',
  },
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

test('後台介面的文字不含 emoji', () => {
  const hits: string[] = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file);
    const fragments = ALLOWED[rel]?.fragments ?? [];
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      const rest = fragments.reduce((acc, f) => acc.split(f).join(''), line);
      if (!EMOJI.test(rest)) return;
      hits.push(`${rel}:${i + 1}: ${t.slice(0, 80)}`);
    });
  }
  assert.deepEqual(hits, []);
});
