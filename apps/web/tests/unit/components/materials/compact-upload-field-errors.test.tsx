// @vitest-environment jsdom
/**
 * 素材圖片、影片欄位的上傳錯誤用 getApiErrorMessage 顯示（issue #470）：
 * 後端的中文訊息原樣顯示；後端沒回訊息時（例如代理伺服器回 413）依狀態顯示說明，不再只寫「上傳失敗」。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const apiPost = vi.fn();
vi.mock('#src/lib/api.js', () => ({ default: { post: (...args: unknown[]) => apiPost(...args), get: vi.fn() } }));
const uploadDirect = vi.fn();
vi.mock('#src/lib/direct-upload.js', () => ({ uploadDirect: (...args: unknown[]) => uploadDirect(...args) }));

import { CompactImageField } from '#src/components/materials/CompactImageField.js';
import { CompactVideoField } from '#src/components/materials/CompactVideoField.js';

const REJECTED_MESSAGE = '無法辨識檔案內容，請確認檔案沒有損壞，且是允許的格式（JPG、PNG、WEBP）';

function axiosError(status: number, data: unknown) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });
}

function pick(container: HTMLElement, accept: string, file: File) {
  const input = container.querySelector(`input[type="file"][accept="${accept}"]`) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

const image = () => new File(['x'], 'cover.png', { type: 'image/png' });
const video = () => new File(['x'], 'clip.mp4', { type: 'video/mp4' });

beforeEach(() => {
  apiPost.mockReset();
  uploadDirect.mockReset();
});
afterEach(cleanup);

test('圖片欄位：顯示後端的中文拒絕原因', async () => {
  apiPost.mockRejectedValue(axiosError(400, { success: false, error: { code: 'INVALID_FILE_TYPE', message: REJECTED_MESSAGE } }));
  const { container } = render(<CompactImageField value="" onChange={vi.fn()} />);
  pick(container, 'image/jpeg,image/png,image/webp', image());
  await screen.findByText(REJECTED_MESSAGE);
});

test('圖片欄位：後端沒回訊息的 413 顯示檔案過大', async () => {
  apiPost.mockRejectedValue(axiosError(413, '<html>413 Request Entity Too Large</html>'));
  const { container } = render(<CompactImageField value="" onChange={vi.fn()} />);
  pick(container, 'image/jpeg,image/png,image/webp', image());
  await screen.findByText('檔案過大，請換小一點的檔案');
});

test('影片欄位：顯示後端的中文拒絕原因', async () => {
  apiPost.mockRejectedValue(axiosError(400, { success: false, error: { code: 'INVALID_FILE_TYPE', message: REJECTED_MESSAGE } }));
  const { container } = render(<CompactVideoField value="" onChange={vi.fn()} />);
  pick(container, 'video/mp4', video());
  await screen.findByText(REJECTED_MESSAGE);
});

test('影片欄位：後端沒回訊息的 413 顯示檔案過大', async () => {
  apiPost.mockRejectedValue(axiosError(413, '<html>413 Request Entity Too Large</html>'));
  const { container } = render(<CompactVideoField value="" onChange={vi.fn()} />);
  pick(container, 'video/mp4', video());
  await screen.findByText('檔案過大，請換小一點的檔案');
});

test('影片欄位直傳失敗：保留直傳回報的中文說明', async () => {
  uploadDirect.mockRejectedValue(new Error('上傳失敗（HTTP 403）'));
  const { container } = render(<CompactVideoField value="" onChange={vi.fn()} uploadPurpose="line-video" maxBytes={200 * 1024 * 1024} />);
  pick(container, 'video/mp4', video());
  await screen.findByText('上傳失敗（HTTP 403）');
  assert.equal(apiPost.mock.calls.length, 0);
});
