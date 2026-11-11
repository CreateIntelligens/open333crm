// @vitest-environment jsdom
/**
 * 短連結表單擋純空白的目標網址（change fix-w6-field-validation，spec shortlink-routing
 * 「Short Link Form Rejects Blank Target URL」）。原本只檢查非空，純空白會讓「建立」可按。
 * 表單已從對話框改為獨立頁面（Claude Design 改版），規則不變。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({
  api: { post: vi.fn(), patch: vi.fn(), get: vi.fn(() => Promise.resolve({ data: { data: [] } })) },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/hooks/useChannels.js', () => ({ useChannels: () => ({ channels: [], isLoading: false }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import { LinkForm } from '#src/components/shortlink/LinkForm.js';

beforeEach(() => {
  api.post.mockReset();
});

test('Whitespace-only target URL：目標網址只有空白時「建立」不可按，也不送出請求', () => {
  render(<LinkForm />);
  const input = screen.getByLabelText(/目標 URL/);
  fireEvent.change(input, { target: { value: '   ' } });
  const create = screen.getByRole('button', { name: '建立' });
  assert.equal((create as HTMLButtonElement).disabled, true);
  fireEvent.click(create);
  assert.equal(api.post.mock.calls.length, 0);
  assert.ok(screen.getByText('尚未完成：目標 URL'));

  fireEvent.change(input, { target: { value: 'https://example.com/ok' } });
  assert.equal((screen.getByRole('button', { name: '建立' }) as HTMLButtonElement).disabled, false);
});

// 以下兩個測試來自 main（M02、M14），原本測已刪除的 LinkFormDialog；本分支改成獨立頁面 LinkForm，測試目的不變。
test('編輯時清空標題與 UTM：送出空字串讓後端清除（M02）', async () => {
  api.patch.mockReset();
  api.patch.mockResolvedValue({ data: { data: {} } });
  const editData = {
    id: 'l-1',
    slug: 'abc',
    targetUrl: 'https://example.com',
    title: '舊標題',
    utmSource: 'line',
    ogImage: 'https://example.com/og.png',
    isActive: true,
    totalClicks: 0,
    uniqueClicks: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
  };
  render(<LinkForm editData={editData} />);
  fireEvent.change(screen.getByDisplayValue('舊標題'), { target: { value: '' } });
  fireEvent.change(screen.getByDisplayValue('line'), { target: { value: '' } });
  fireEvent.change(screen.getByDisplayValue('https://example.com/og.png'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(api.patch.mock.calls.length, 1);
  const payload = api.patch.mock.calls[0][1];
  assert.equal(payload.title, '');
  assert.equal(payload.utmSource, '');
  assert.equal(payload.ogImage, '');
});

test('編輯素材短連結時顯示會影響已發出訊息的警告（M14）', () => {
  const base = { slug: 'auto1', targetUrl: 'https://shop.example.com', isActive: true, totalClicks: 0, uniqueClicks: 0, createdAt: '2026-11-01T00:00:00.000Z' };
  render(<LinkForm editData={{ ...base, id: 'l-auto', materialId: 'mat-1' }} />);
  assert.ok(screen.getByRole('note').textContent?.includes('已經發給客人'));

  cleanup();
  render(<LinkForm editData={{ ...base, id: 'l-manual', materialId: null }} />);
  assert.ok(screen.queryByRole('note') === null, '對照組：手動建立的連結不顯示警告');
});
