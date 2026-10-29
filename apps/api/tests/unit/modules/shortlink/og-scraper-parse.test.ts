/**
 * 短連結 Open Graph 抓取的 HTML 解析（issue #394）。
 * 解析時間要跟 HTML 長度成線性；實體只解碼一次。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: async () => ({ address: '93.184.216.34', family: 4 }) }));

import { scrapeOg } from '#src/modules/shortlink/og-scraper.js';

const realFetch = globalThis.fetch;
let html = '';

beforeEach(() => {
  globalThis.fetch = (async () =>
    new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('Reads og:title, og:description and og:image in either attribute order', async () => {
  html = `<html><head>
    <meta property="og:title" content="春季優惠">
    <meta content='全館八折' property='og:description' />
    <META PROPERTY="og:image" CONTENT="/img/cover.png">
  </head></html>`;
  const og = await scrapeOg('https://shop.example.com/sale');
  assert.deepEqual(og, {
    ogTitle: '春季優惠',
    ogDescription: '全館八折',
    ogImage: 'https://shop.example.com/img/cover.png',
  });
});

test('Falls back to the description meta when og:description is missing', async () => {
  html = '<meta name="description" content="一般描述"><meta name="og:title" content="標題">';
  const og = await scrapeOg('https://shop.example.com/');
  assert.equal(og.ogDescription, '一般描述');
  assert.equal(og.ogTitle, '標題');
});

test('Keeps a > inside a quoted attribute value', async () => {
  html = `<meta property="og:title" content="5 > 3"><meta content='a > b' name='description'>`;
  const og = await scrapeOg('https://shop.example.com/');
  assert.equal(og.ogTitle, '5 > 3');
  assert.equal(og.ogDescription, 'a > b');
});

test('Ignores <metadata> elements and meta tags inside HTML comments', async () => {
  html = `<metadata property="og:title" content="wrong">
    <!-- <meta property="og:description" content="commented out"> -->
    <meta property="og:title" content="right">
    <meta property="og:description" content="real">`;
  const og = await scrapeOg('https://shop.example.com/');
  assert.equal(og.ogTitle, 'right');
  assert.equal(og.ogDescription, 'real');
});

test('Decodes HTML entities once', async () => {
  html = '<meta property="og:title" content="A &amp; B &amp;lt;tag&amp;gt; &quot;Q&quot; &#39;s&#x27;">';
  const og = await scrapeOg('https://shop.example.com/');
  assert.equal(og.ogTitle, 'A & B &lt;tag&gt; "Q" \'s\'');
});

test('Parses a crafted 100 KB page without stalling', async () => {
  // 舊的回溯式正規表示式在這個輸入上實測要 471 秒（2026-10-29）
  html = '<meta property="og:title" '.repeat(4_000).slice(0, 100 * 1024);
  const started = Date.now();
  const og = await scrapeOg('https://evil.example.com/');
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1000, `解析花了 ${elapsed}ms`);
  assert.equal(og.ogTitle, undefined);
});

test('Parses a 100 KB page of unclosed meta tags without stalling', async () => {
  html = '<meta'.repeat(20_000).slice(0, 100 * 1024);
  const started = Date.now();
  await scrapeOg('https://evil.example.com/');
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1000, `解析花了 ${elapsed}ms`);
});
