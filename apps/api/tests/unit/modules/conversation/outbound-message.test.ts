/**
 * 送出訊息的 contentType / content 驗證。
 *   npx tsx src/__tests__/outbound-message.test.ts
 *
 * 背景（Wave 6 欄位級測試）：
 * `sendMessageSchema` 原本是
 *   { contentType: z.string().default('text'), content: z.record(z.unknown()) }
 * 幾乎等於沒驗。UAT 實測五種全部回 201 並以 OUTBOUND 落庫：
 *   {content:{}}、{content:{text:""}}、{content:{text:"   "}}、
 *   {content:{foo:"bar"}}、{contentType:"wut", content:{text:"x"}}
 *
 * 修復時另外發現一個更嚴重的既有缺陷（原報告未涵蓋）：
 * channel-plugins 的 toLineMessage() **沒有 image / video 分支**，
 * 會落到 `default:` 被當成 text 送出、內容取 `content.text ?? ''`。
 * 也就是說客服在收件匣送一張圖片，客戶在 LINE 收到的是一則空白文字訊息。
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  validateOutboundMessage,
  getMediaUrl,
  OUTBOUND_MESSAGE_TYPES,
  MESSAGE_TEXT_MAX_LENGTH,
} from '@open333crm/shared';

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');
const pkgSrc = (rel: string) =>
  readFileSync(join(here, '../../../../packages', rel), 'utf8');

let pass = 0;
let fail = 0;

function t(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${(err as Error).message}`);
    fail += 1;
  }
}

// ─── UAT 實測全部回 201 的五種輸入，現在都該被擋下 ────────────────────────

t('擋下空物件（UAT 實測原本 201）', () => {
  assert.ok(validateOutboundMessage('text', {}));
});

t('擋下空字串與純空白（會送出空泡泡）', () => {
  for (const text of ['', '   ', '\t', '　']) {
    assert.ok(
      validateOutboundMessage('text', { text }),
      `text=${JSON.stringify(text)} 應被擋下`,
    );
  }
});

t('擋下沒有 text 欄位的文字訊息', () => {
  const err = validateOutboundMessage('text', { foo: 'bar' });
  assert.ok(err);
  assert.ok(err.includes('text'), '訊息應指出缺少 text 欄位');
});

t('擋下非法 contentType（原本會落到 LINE 的 default 分支送空文字）', () => {
  const err = validateOutboundMessage('wut', { text: 'x' });
  assert.ok(err);
  assert.ok(err.includes('wut'), '訊息應指出是哪個類型不支援');
  assert.ok(err.includes('text'), '訊息應列出可用類型');
});

// ─── 正常情況不可被誤殺 ───────────────────────────────────────────────────

t('接受一般文字訊息', () => {
  assert.strictEqual(validateOutboundMessage('text', { text: '你好' }), null);
});

t('接受含換行與 emoji 的文字', () => {
  assert.strictEqual(validateOutboundMessage('text', { text: '第一行\n第二行 🙂' }), null);
});

t('文字長度邊界：5000 字可送、5001 字擋下', () => {
  assert.strictEqual(
    validateOutboundMessage('text', { text: 'a'.repeat(MESSAGE_TEXT_MAX_LENGTH) }),
    null,
  );
  assert.ok(validateOutboundMessage('text', { text: 'a'.repeat(MESSAGE_TEXT_MAX_LENGTH + 1) }));
});

// ─── 媒體訊息：欄位名在專案內不一致，兩種都要接 ──────────────────────────

t('媒體訊息接受前端送的 url 欄位', () => {
  // 前端 useMessages: content = contentType === 'text' ? { text } : { url }
  assert.strictEqual(validateOutboundMessage('image', { url: 'https://e.com/a.jpg' }), null);
});

t('媒體訊息也接受素材用的 mediaUrl 欄位', () => {
  assert.strictEqual(validateOutboundMessage('video', { mediaUrl: 'https://e.com/a.mp4' }), null);
});

t('擋下缺少網址的媒體訊息', () => {
  for (const content of [{}, { url: '' }, { url: '   ' }, { text: '[圖片]' }]) {
    assert.ok(
      validateOutboundMessage('image', content),
      `${JSON.stringify(content)} 應被擋下`,
    );
  }
});

t('擋下非 http(s) 的媒體網址', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'ftp://e.com/a.jpg']) {
    assert.ok(validateOutboundMessage('image', { url }), `${url} 應被擋下`);
  }
});

t('getMediaUrl 優先取 url，其次 mediaUrl，都沒有回 null', () => {
  assert.strictEqual(getMediaUrl({ url: 'https://a' }), 'https://a');
  assert.strictEqual(getMediaUrl({ mediaUrl: 'https://b' }), 'https://b');
  assert.strictEqual(getMediaUrl({ url: 'https://a', mediaUrl: 'https://b' }), 'https://a');
  assert.strictEqual(getMediaUrl({}), null);
  assert.strictEqual(getMediaUrl({ url: '   ' }), null, '純空白應視為沒有');
});

t('system 不在可送出類型內（那是後端自建的系統訊息）', () => {
  assert.ok(
    !(OUTBOUND_MESSAGE_TYPES as readonly string[]).includes('system'),
    'system 不該由 API 呼叫端指定',
  );
  assert.ok(validateOutboundMessage('system', { text: '假裝是系統訊息' }));
});

// ─── 回歸防護 ─────────────────────────────────────────────────────────────

t('送訊息端點已套用驗證', () => {
  const code = apiSrc('modules/conversation/conversation.routes.ts');
  assert.ok(code.includes('validateOutboundMessage'), 'sendMessageSchema 未套用驗證');
  assert.ok(code.includes('superRefine'), '未用 superRefine 接上');
});

t('LINE 外掛有 image / video 分支（否則送圖會變空白文字）', () => {
  const code = pkgSrc('channel-plugins/src/line/index.ts');
  assert.ok(/case 'image': \{/.test(code), 'toLineMessage 缺 image 分支');
  assert.ok(/case 'video': \{/.test(code), 'toLineMessage 缺 video 分支');
  assert.ok(code.includes('getMediaUrl'), '未用 getMediaUrl 相容兩種欄位名');
});

t('關鍵不變式：通過驗證的訊息在 LINE 都有對應分支', () => {
  // 若日後有人往 OUTBOUND_MESSAGE_TYPES 加新類型卻忘了加 LINE 分支，
  // 那個類型會靜默落到 default 被當成空文字送出——這裡擋下。
  const code = pkgSrc('channel-plugins/src/line/index.ts');
  for (const type of OUTBOUND_MESSAGE_TYPES) {
    if (type === 'text') continue; // text 本身就是 default 的行為
    if (type === 'file') continue; // LINE 無 file message type，走 text + 檔名連結（見下方專屬案例）
    assert.ok(
      new RegExp(`case '${type}':`).test(code),
      `OUTBOUND_MESSAGE_TYPES 有 '${type}' 但 toLineMessage 沒有對應分支，` +
        '會被當成空白文字送給客戶',
    );
  }
});

// ─── code review 發現（2026-09-23）──────────────────────────────────────

t('video 的 previewImageUrl 不可 fallback 成影片網址', () => {
  // LINE 要求 previewImageUrl 必須是 JPEG/PNG。拿 mp4 頂替會整則被退 400，
  // 客戶收不到訊息——比送出空白泡泡更糟（那至少送得出去）。
  const code = pkgSrc('channel-plugins/src/line/index.ts');
  const block = code.slice(code.indexOf("case 'video': {"), code.indexOf("case 'audio':"));
  assert.ok(
    !/previewImageUrl:\s*\(content\.previewUrl as string\)\s*\?\?\s*url/.test(block),
    'previewImageUrl fallback 成影片網址，LINE 會退 400',
  );
  assert.ok(
    /\[影片\]/.test(block),
    '沒有預覽圖時應改送文字+連結，而不是硬送會被退件的 video message',
  );
});

t('file 有對應分支（否則送出空白泡泡）', () => {
  const code = pkgSrc('channel-plugins/src/line/index.ts');
  assert.ok(
    /case 'file': \{/.test(code),
    "OUTBOUND_MESSAGE_TYPES 有 'file'，ChatWindow 也會送——但 LINE 沒分支就落 default 送空字串",
  );
  const block = code.slice(code.indexOf("case 'file': {"), code.indexOf("case 'audio':"));
  assert.ok(/fileName/.test(block), 'file 訊息應帶上檔名，只給連結使用者不知道是什麼');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
