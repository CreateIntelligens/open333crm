// @vitest-environment jsdom
/**
 * 短連結表單擋純空白的目標網址（change fix-w6-field-validation，spec shortlink-routing
 * 「Short Link Form Rejects Blank Target URL」）。原本只檢查非空，純空白會讓「建立」可按。
 * 表單已從對話框改為獨立頁面（Claude Design 改版），規則不變。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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
