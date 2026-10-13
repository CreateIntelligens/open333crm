// @vitest-environment jsdom
/**
 * 素材名稱、分類、描述的字數上限與後端 Zod 一致（material.routes.ts：200／100／500）。
 * 2026-10-13 UAT：名稱打 201 字可以送出，後端只回「輸入內容有誤，請檢查後重新送出」，看不出是哪一欄。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('#src/lib/api.js', () => ({ default: { post: vi.fn(), get: vi.fn(async () => ({ data: { data: [] } })) } }));

import { MaterialEditor } from '#src/components/materials/MaterialEditor.js';

afterEach(cleanup);

test('名稱、分類、描述的輸入框有字數上限', () => {
  render(
    <MaterialEditor
      draft={{ name: 'x', channelType: 'line', contentType: 'line_text', body: { text: 'hi' }, variables: [] } as never}
      saving={false}
      onChange={vi.fn()}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  assert.equal(screen.getByPlaceholderText('如：母親節新品推播').getAttribute('maxlength'), '200');
  assert.equal(screen.getByPlaceholderText('行銷類 / 服務類 …').getAttribute('maxlength'), '100');
  assert.equal(screen.getByPlaceholderText('簡短描述用途').getAttribute('maxlength'), '500');
});
