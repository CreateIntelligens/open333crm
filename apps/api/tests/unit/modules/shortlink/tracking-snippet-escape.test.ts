/**
 * 追蹤碼注入點的輸出跳脫（縱深防禦）。GA4 與 Meta Pixel 的 ID 來自租戶設定，
 * 會被放進短連結轉址頁的 <script> 與 script src 屬性。即使輸入驗證擋在前面，
 * 注入點本身也要跳脫，否則繞過驗證存進 DB 的值會在訪客瀏覽器執行（儲存型 XSS）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  buildGa4Snippet,
  buildMetaPixelSnippet,
  buildTrackingSnippets,
} from '#src/modules/shortlink/strategies/tracking-snippet.js';

// 能脫出 <script> 或 JS 字串的 payload：</script> 關閉標籤、引號跳出字串
const GA_BREAKOUT = '</script><script>alert(1)</script>';
const PX_BREAKOUT = "');alert(1);//";

test('buildGa4Snippet：含 </script> 的 ID 不關閉標籤、不脫出單引號字串', () => {
  const html = buildGa4Snippet(GA_BREAKOUT);
  // </script> 會提早關閉 <script>；跳脫後不得有這個字面
  assert.equal(html.includes('</script><script>'), false, html);
  assert.equal(html.includes('<script>alert(1)'), false, html);
  // config 的引數改為跳脫過的字面，不再是「單引號包原值」的可脫出形式
  assert.equal(html.includes("gtag('config', '"), false, html);
});

test('buildMetaPixelSnippet：含引號的 ID 不脫出 fbq 的字串引數', () => {
  const html = buildMetaPixelSnippet(PX_BREAKOUT);
  // 原本是 fbq('init', '<id>')，單引號包值時 ' 會關閉字串並接上敘述句
  assert.equal(html.includes("fbq('init', '"), false, html);
});

test('buildTrackingSnippets：兩個 payload 合併輸出都不含可脫出的單引號字面', () => {
  const html = buildTrackingSnippets(GA_BREAKOUT, PX_BREAKOUT);
  assert.equal(html.includes('</script><script>'), false, html);
  assert.equal(html.includes("gtag('config', '"), false, html);
  assert.equal(html.includes("fbq('init', '"), false, html);
});

test('buildTrackingSnippets：合法 ID 仍照常輸出對應的追蹤碼', () => {
  const html = buildTrackingSnippets('G-ABC1234567', '1234567890123456');
  assert.ok(html.includes('G-ABC1234567'), html);
  assert.ok(html.includes('1234567890123456'), html);
  assert.ok(html.includes('googletagmanager.com/gtag/js'), html);
  assert.ok(html.includes('fbevents.js'), html);
});
