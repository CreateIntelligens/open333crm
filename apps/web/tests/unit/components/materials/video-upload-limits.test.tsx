// @vitest-environment jsdom
/**
 * 影片上傳依渠道套用上限（change line-video-direct-upload，spec material-system
 * 「Video Upload Limits Follow Each Channel」）：LINE 200MB 走直傳，FB 25MB 走一般上傳。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiPost = vi.fn();
vi.mock('#src/lib/api.js', () => ({ default: { post: (...args: unknown[]) => apiPost(...args), get: vi.fn() } }));
const uploadDirect = vi.fn();
vi.mock('#src/lib/direct-upload.js', () => ({ uploadDirect: (...args: unknown[]) => uploadDirect(...args) }));

import { LineVideoEditor } from '#src/components/materials/line/LineVideoEditor.js';
import { FbVideoEditor } from '#src/components/materials/editors.js';

const MB = 1024 * 1024;

beforeEach(() => {
  apiPost.mockReset();
  uploadDirect.mockReset();
});
afterEach(cleanup);

function pickVideo(container: HTMLElement, size: number) {
  const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
  Object.defineProperty(file, 'size', { value: size });
  const input = container.querySelector('input[type="file"][accept="video/mp4"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

test('LINE video over 25 MB：以 line-video 直傳，完成後填入影片網址', async () => {
  uploadDirect.mockResolvedValue('https://storage.example/t/media/clip.mp4');
  const onChange = vi.fn();
  const { container } = render(<LineVideoEditor body={{ videoUrl: '', previewImageUrl: '' }} onChange={onChange} />);
  const file = pickVideo(container, 150 * MB);
  await waitFor(() => assert.equal(uploadDirect.mock.calls.length, 1));
  assert.equal(uploadDirect.mock.calls[0][0], file);
  assert.equal(uploadDirect.mock.calls[0][1], 'line-video');
  await waitFor(() => assert.equal(onChange.mock.calls.at(-1)?.[0].videoUrl, 'https://storage.example/t/media/clip.mp4'));
  assert.equal(apiPost.mock.calls.length, 0, '不走 multipart 上傳');
});

test('LINE video over 200 MB：顯示上限 200 MB，不申請直傳', async () => {
  const { container } = render(<LineVideoEditor body={{ videoUrl: '', previewImageUrl: '' }} onChange={vi.fn()} />);
  pickVideo(container, 201 * MB);
  await screen.findByText(/超過上限 200\.0 MB/);
  assert.equal(uploadDirect.mock.calls.length, 0);
  assert.equal(apiPost.mock.calls.length, 0);
});

test('FB video over 25 MB：顯示上限 25 MB，不上傳', async () => {
  const { container } = render(<FbVideoEditor body={{ url: '' }} onChange={vi.fn()} />);
  pickVideo(container, 30 * MB);
  await screen.findByText(/超過上限 25\.0 MB/);
  assert.equal(uploadDirect.mock.calls.length, 0);
  assert.equal(apiPost.mock.calls.length, 0);
});

test('FB 影片 25 MB 以內走一般上傳', async () => {
  apiPost.mockResolvedValue({ data: { data: { url: 'https://storage.example/fb.mp4' } } });
  const onChange = vi.fn();
  const { container } = render(<FbVideoEditor body={{ url: '' }} onChange={onChange} />);
  pickVideo(container, 10 * MB);
  await waitFor(() => assert.equal(onChange.mock.calls.at(-1)?.[0].url, 'https://storage.example/fb.mp4'));
  assert.equal(apiPost.mock.calls[0][0], '/files/upload');
  assert.equal(uploadDirect.mock.calls.length, 0);
});
