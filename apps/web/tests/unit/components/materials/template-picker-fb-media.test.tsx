// @vitest-environment jsdom
/**
 * 建立素材的版型清單不提供 FB「大圖／影片廣告」（2026-10-27 UAT 實測）：
 * Facebook 的媒體範本只接受 Facebook 託管的素材，用一般網址發送一定回「(#100) 網址參數包含非 Facebook 網址」。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { TemplatePickerGrid } from '#src/components/materials/TemplatePickerGrid.js';

afterEach(cleanup);

test('FB 版型清單沒有大圖／影片廣告', () => {
  render(<TemplatePickerGrid onPick={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /FB Messenger/ }));
  assert.ok(screen.getByText('商品輪播'));
  assert.ok(screen.queryByText('大圖／影片廣告') === null);
});
