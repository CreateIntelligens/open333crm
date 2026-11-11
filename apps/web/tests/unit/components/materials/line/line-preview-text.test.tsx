// @vitest-environment jsdom
/**
 * 卡片訊息與圖文訊息的預覽文字（change line-carousel-imagemap-preview-text，spec material-system
 * 「卡片訊息與圖文訊息的預覽文字」）。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('#src/lib/api.js', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import { LineCarouselEditor } from '#src/components/materials/line/LineCarouselEditor.js';
import { LineImagemapEditor } from '#src/components/materials/line/LineImagemapEditor.js';
import type { CarouselBody } from '#src/components/materials/line/carousel-page-types.js';
import type { ImagemapBody } from '#src/components/materials/line/LineImagemapEditor.js';

afterEach(cleanup);

const carouselBody = (): CarouselBody => ({
  pageType: 'product',
  pages: [{ imageUrl: 'https://example.com/a.jpg', title: '商品' } as CarouselBody['pages'][number]],
  endPage: { label: '看更多' },
  altText: '舊預覽',
});

const imagemapBody = (): ImagemapBody => ({
  baseImageUrl: 'https://example.com/imagemap/x',
  layoutId: 'custom',
  width: 1040,
  height: 700,
  areas: [{ x: 0, y: 0, width: 1040, height: 700 }],
});

const previewInput = () => screen.getByLabelText('預覽文字') as HTMLInputElement;

test('在卡片訊息編輯器填預覽文字', () => {
  const onChange = vi.fn();
  const body = carouselBody();
  render(<LineCarouselEditor body={body} onChange={onChange} />);
  assert.equal(previewInput().value, '舊預覽');
  assert.equal(previewInput().maxLength, 400);
  fireEvent.change(previewInput(), { target: { value: '秋季新品上市' } });
  assert.deepEqual(onChange.mock.lastCall?.[0], { ...body, altText: '秋季新品上市' });
});

test('在圖文訊息編輯器填預覽文字', () => {
  const onChange = vi.fn();
  const body = imagemapBody();
  render(<LineImagemapEditor body={body} onChange={onChange} />);
  assert.equal(previewInput().maxLength, 400);
  fireEvent.change(previewInput(), { target: { value: '點圖看優惠' } });
  assert.deepEqual(onChange.mock.lastCall?.[0], { ...body, altText: '點圖看優惠' });
});

test('切換卡片訊息的頁面類型時保留預覽文字', () => {
  const onChange = vi.fn();
  render(<LineCarouselEditor body={carouselBody()} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /地點/ }));
  const next = onChange.mock.lastCall?.[0] as CarouselBody;
  assert.equal(next.pageType, 'location');
  assert.equal(next.altText, '舊預覽');
  assert.deepEqual(next.endPage, { label: '看更多' });
});
