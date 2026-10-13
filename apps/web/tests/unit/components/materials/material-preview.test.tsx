// @vitest-environment jsdom
/**
 * 素材預覽（2026-10-13 UAT 素材 E2E）：純文字預覽要顯示換行；FB 影片沒有封面圖，
 * 預覽不可把 mp4 網址當成圖片載入（會破圖）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MaterialPreview } from '#src/components/materials/MaterialPreview.js';

afterEach(cleanup);

test('純文字預覽保留換行（LINE 與 FB）', () => {
  for (const [channelType, contentType] of [['line', 'line_text'], ['fb', 'fb_text']]) {
    const { getByText, unmount } = render(
      <MaterialPreview channelType={channelType} contentType={contentType} body={{ text: '第一行\n第二行' }} />,
    );
    const bubble = getByText((_, el) => el?.textContent === '第一行\n第二行' && el.children.length === 0);
    assert.ok(bubble.className.includes('whitespace-pre-wrap'), `${contentType} 的文字氣泡應保留換行`);
    unmount();
  }
});

test('FB 影片預覽用 video 載入影片，不用 img', () => {
  const { container } = render(
    <MaterialPreview channelType="fb" contentType="fb_video" body={{ url: 'https://example.com/a.mp4' }} />,
  );
  assert.ok(container.querySelector('img[src="https://example.com/a.mp4"]') === null, 'mp4 不應當成圖片載入');
  assert.equal(container.querySelector('video')?.getAttribute('src'), 'https://example.com/a.mp4');
});

test('LINE 影片預覽仍顯示封面圖', () => {
  const { container } = render(
    <MaterialPreview
      channelType="line"
      contentType="line_video"
      body={{ videoUrl: 'https://example.com/a.mp4', previewImageUrl: 'https://example.com/cover.jpg' }}
    />,
  );
  assert.equal(container.querySelector('img')?.getAttribute('src'), 'https://example.com/cover.jpg');
});
