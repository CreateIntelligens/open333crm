/**
 * LINE 媒體規格限制驗證。
 *   npx tsx src/__tests__/line-media-limits.test.ts
 *
 * 背景：2026-09-23 使用者回報兩個問題，根因相同——
 * 「我們的上傳／存檔比 LINE 的硬限制寬鬆，錯誤延到推送後才爆」。
 *
 * ① Rich Menu 圖片無法上傳
 *    實測 /files/upload 對 2500×1686 的 12MB PNG 回 201（耗時 27 秒）。
 *    通用上傳政策允許 25MB，但 LINE 對 Rich Menu 背景圖的限制是 1MB
 *    （官方文件 Requirements for rich menu image）。
 *    使用者看到「上傳成功」，直到按下發布才收到 400——白做工。
 *    （27 秒沒有任何進度回饋，也讓人以為當掉了。）
 *
 * ② LINE video message 用 YouTube 網址，推送後無法播放
 *    LINE 的 video message 要求 originalContentUrl 是可直接下載的 mp4
 *    （Protocol: HTTPS、Video format: mp4、Max file size: 200MB）。
 *    YouTube 連結是網頁不是影片檔，訊息會送出成功但客戶點開播不動。
 *    前端只有文字提示「影片需為 mp4 格式」，沒有任何擋控；後端零驗證。
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  validateLineVideoUrl,
  LINE_RICH_MENU_MAX_IMAGE_BYTES,
  LINE_VIDEO_PREVIEW_MAX_BYTES,
  LINE_MEDIA_URL_MAX_LENGTH,
  NON_DIRECT_VIDEO_HOSTS,
} from '@open333crm/shared';

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');
const webSrc = (rel: string) =>
  readFileSync(join(here, '../../../../apps/web/src', rel), 'utf8');

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

// ─── 常數對齊 LINE 官方文件 ───────────────────────────────────────────────

t('Rich Menu 圖片上限為 LINE 官方的 1MB', () => {
  assert.strictEqual(LINE_RICH_MENU_MAX_IMAGE_BYTES, 1024 * 1024);
});

t('影片預覽圖上限為 LINE 官方的 1MB', () => {
  assert.strictEqual(LINE_VIDEO_PREVIEW_MAX_BYTES, 1024 * 1024);
});

t('媒體網址長度上限為 LINE 官方的 2000 字', () => {
  assert.strictEqual(LINE_MEDIA_URL_MAX_LENGTH, 2000);
});

// ─── 影片網址：使用者實際回報的情境 ───────────────────────────────────────

t('擋下 YouTube 分享連結（使用者回報的原始情境）', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=abc',
    'https://m.youtube.com/watch?v=abc',
    'https://youtu.be/dQw4w9WgXcQ',
  ]) {
    const err = validateLineVideoUrl(url);
    assert.ok(err, `${url} 應被擋下`);
    assert.ok(err.includes('網頁'), '錯誤訊息應說明「那是網頁不是影片檔」');
    assert.ok(err.includes('mp4'), '錯誤訊息應指引改用 mp4 網址');
  }
});

t('擋下其他常見影片分享網站', () => {
  for (const url of [
    'https://vimeo.com/123456',
    'https://www.facebook.com/watch/?v=123',
    'https://www.tiktok.com/@user/video/123',
    'https://drive.google.com/file/d/xxx/view',
  ]) {
    assert.ok(validateLineVideoUrl(url), `${url} 應被擋下`);
  }
});

t('擋下非 HTTPS（LINE 要求 TLS 1.2 以上）', () => {
  const err = validateLineVideoUrl('http://example.com/video.mp4');
  assert.ok(err);
  assert.ok(err.includes('HTTPS'), '應明確說是 HTTPS 問題');
});

t('擋下非 mp4 的檔案與無副檔名的網址', () => {
  for (const url of [
    'https://example.com/video.mov',
    'https://example.com/video.webm',
    'https://example.com/video',
    'https://example.com/',
  ]) {
    assert.ok(validateLineVideoUrl(url), `${url} 應被擋下`);
  }
});

t('接受可直接下載的 mp4 網址', () => {
  for (const url of [
    'https://example.com/video.mp4',
    'https://cdn.example.com/a/b/c.MP4',
    'https://s3.example.com/v.mp4?X-Amz-Signature=abc123',
    'https://example.com:8443/v.mp4',
  ]) {
    assert.strictEqual(validateLineVideoUrl(url), null, `${url} 應被接受`);
  }
});

t('擋下空值與非網址', () => {
  assert.ok(validateLineVideoUrl(''));
  assert.ok(validateLineVideoUrl('   '));
  assert.ok(validateLineVideoUrl('not-a-url'));
  assert.ok(validateLineVideoUrl('example.com/v.mp4'), '缺 scheme 應被擋下');
});

t('擋下超過 2000 字的網址', () => {
  const long = 'https://example.com/' + 'a'.repeat(2100) + '.mp4';
  const err = validateLineVideoUrl(long);
  assert.ok(err);
  assert.ok(err.includes('2000'), '應說明長度上限');
});

t('網域比對不受 port 與 userinfo 影響（避免被繞過）', () => {
  assert.ok(validateLineVideoUrl('https://www.youtube.com:443/watch?v=a'), 'port 不該繞過');
  assert.ok(validateLineVideoUrl('https://user@youtu.be/abc'), 'userinfo 不該繞過');
});

t('黑名單涵蓋主要影片平台', () => {
  for (const host of ['youtube.com', 'youtu.be', 'vimeo.com', 'facebook.com', 'tiktok.com']) {
    assert.ok(
      (NON_DIRECT_VIDEO_HOSTS as readonly string[]).includes(host),
      `${host} 應在黑名單內`,
    );
  }
});

// ─── 回歸防護 ─────────────────────────────────────────────────────────────

t('後端存檔時驗證影片網址（前端擋控可被繞過）', () => {
  const code = apiSrc('modules/marketing/material.service.ts');
  assert.ok(code.includes('validateLineVideoUrl'), 'material.service 未驗證影片網址');
  assert.ok(
    code.includes("contentType === 'line_video'"),
    '未針對 line_video 做驗證',
  );
});

t('前端影片欄位即時提示網址問題', () => {
  // 驗證邏輯隨上傳功能一起搬進 CompactVideoField，
  // LineVideoEditor 改為單純組裝欄位。
  const code = webSrc('components/materials/CompactVideoField.tsx');
  assert.ok(code.includes('validateLineVideoUrl'), '影片欄位未套用網址驗證');
  assert.ok(code.includes('urlError'), '未顯示錯誤訊息');
});

t('前端圖片元件支援大小上限', () => {
  const code = webSrc('components/materials/CompactImageField.tsx');
  assert.ok(code.includes('maxBytes'), 'CompactImageField 未支援 maxBytes');
  assert.ok(
    code.includes('file.size > maxBytes'),
    '未在選檔當下檢查大小',
  );
});

t('Rich Menu 編輯器套用 1MB 限制與比例檢查', () => {
  const code = webSrc('components/line/rich-menu/RichMenuEditor.tsx');
  assert.ok(
    code.includes('LINE_RICH_MENU_MAX_IMAGE_BYTES'),
    'Rich Menu 未套用 1MB 上限——使用者會上傳成功後才在發布時被擋',
  );
  assert.ok(
    code.includes('requireAspectRatio'),
    'Rich Menu 未檢查圖片比例',
  );
});

t('影片預覽圖套用 1MB 限制', () => {
  const code = webSrc('components/materials/line/LineVideoEditor.tsx');
  assert.ok(
    code.includes('LINE_VIDEO_PREVIEW_MAX_BYTES'),
    '預覽圖未套用 1MB 上限',
  );
});

t('後端發布 Rich Menu 前仍會驗圖片大小（雙層防護）', () => {
  const code = apiSrc('modules/line/rich-menu.service.ts');
  assert.ok(code.includes('MAX_IMAGE_BYTES'), '發布前未驗圖片大小');
  assert.ok(code.includes('超過 LINE 限制 1MB'), '錯誤訊息未說明是 LINE 的限制');
});

// ─── 存檔按鈕擋控（2026-09-23 使用者要求）──────────────────────────────

t('素材編輯器有集中的 body 擋控函式', () => {
  const code = webSrc('components/materials/validate-body.ts');
  assert.ok(code.includes('validateMaterialBody'), '未定義 validateMaterialBody');
  assert.ok(code.includes('validateLineVideoUrl'), '未套用影片網址驗證');
  assert.ok(
    code.includes("if (!videoUrl.trim()) return null"),
    '空值應放行——否則剛進編輯器就把按鈕變灰',
  );
});

t('存檔鈕在內容有誤時禁用，且說明原因', () => {
  const code = webSrc('components/materials/MaterialEditor.tsx');
  assert.ok(code.includes('validateMaterialBody'), 'MaterialEditor 未套用擋控');
  assert.ok(code.includes('blockReason'), '未計算阻擋原因');
  assert.ok(
    code.includes('disabled={saving || !!blockReason}'),
    '存檔鈕未在有錯誤時禁用',
  );
  assert.ok(
    code.includes('無法儲存：'),
    '未在畫面上顯示原因（只靠 title 屬性，觸控裝置看不到）',
  );
});

// ─── 影片上傳入口（2026-09-23 使用者問「那影片要怎麼建立」）──────────────

t('影片欄位提供上傳入口，不是只能貼網址', () => {
  const code = webSrc('components/materials/CompactVideoField.tsx');
  assert.ok(code.includes("accept=\"video/mp4\""), '未提供 mp4 檔案選擇');
  assert.ok(code.includes("api.post('/files/upload'"), '未接上傳端點');
  assert.ok(code.includes('validateLineVideoUrl'), '貼網址時未即時驗證');
});

t('影片上傳上限取「LINE 限制」與「後端 multipart 上限」的較小值', () => {
  const code = webSrc('components/materials/CompactVideoField.tsx');
  assert.ok(code.includes('MAX_UPLOAD_BYTES'), '未定義後端上傳上限');
  assert.ok(
    code.includes('Math.min('),
    '未取兩者較小值——LINE 允許 200MB 但後端 multipart 只收 25MB，' +
      '直接用 200MB 會讓使用者傳到一半才失敗',
  );
});

t('影片編輯器改用 CompactVideoField（不再是純文字框）', () => {
  const code = webSrc('components/materials/line/LineVideoEditor.tsx');
  assert.ok(code.includes('CompactVideoField'), '影片編輯器未使用上傳元件');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
