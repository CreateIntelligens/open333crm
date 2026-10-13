// @vitest-environment jsdom
/**
 * FB 素材編輯器（2026-10-13 UAT 素材 E2E）：
 * - 按鈕選單的新按鈕只能是網址按鈕，不能選回傳按鈕
 * - 商品輪播的卡片按鈕無法編輯（預設內容有按鈕，畫面上看不到也改不了）
 * - 大圖廣告的媒體類型是自由輸入框，可以填 abc
 * - FB 影片只能貼網址，沒有上傳鈕
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('#src/lib/api.js', () => ({ default: { post: vi.fn(), get: vi.fn() } }));

import { FbButtonEditor, FbGenericEditor, FbMediaEditor, FbVideoEditor } from '#src/components/materials/editors.js';

afterEach(cleanup);

const lastCall = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0];

test('Postback button：按鈕選單每顆按鈕可以選類型，改成回傳按鈕時清空網址、改填回傳值', () => {
  const onChange = vi.fn();
  render(
    <FbButtonEditor
      body={{ text: '選一個', buttons: [{ type: 'web_url', title: '官網', url: 'https://example.com' }] }}
      onChange={onChange}
    />,
  );
  fireEvent.change(screen.getByLabelText('第 1 顆按鈕的類型'), { target: { value: 'postback' } });
  assert.deepEqual(lastCall(onChange).buttons, [{ type: 'postback', title: '官網', payload: '' }]);
});

test('按鈕選單：回傳按鈕的輸入框寫入 payload', () => {
  const onChange = vi.fn();
  render(<FbButtonEditor body={{ text: 'x', buttons: [{ type: 'postback', title: '問', payload: '' }] }} onChange={onChange} />);
  fireEvent.change(screen.getByPlaceholderText('回傳資料'), { target: { value: 'ask' } });
  assert.deepEqual(lastCall(onChange).buttons, [{ type: 'postback', title: '問', payload: 'ask' }]);
});

test('Card buttons：商品輪播卡片的按鈕可以看到並修改', () => {
  const onChange = vi.fn();
  render(
    <FbGenericEditor
      body={{ elements: [{ title: '商品', buttons: [{ type: 'web_url', title: '看看', url: 'https://example.com/a' }] }] }}
      onChange={onChange}
    />,
  );
  const card = screen.getByText('卡片 1').closest('div.rounded-md') as HTMLElement;
  fireEvent.change(within(card).getByDisplayValue('看看'), { target: { value: '立即購買' } });
  assert.deepEqual(lastCall(onChange).elements[0].buttons, [{ type: 'web_url', title: '立即購買', url: 'https://example.com/a' }]);
});

test('商品輪播：每張卡片最多 3 顆按鈕', () => {
  const onChange = vi.fn();
  const three = [1, 2, 3].map((i) => ({ type: 'postback', title: `b${i}`, payload: `p${i}` }));
  render(<FbGenericEditor body={{ elements: [{ title: 'A', buttons: three }, { title: 'B' }] }} onChange={onChange} />);
  const cardA = screen.getByText('卡片 1').closest('div.rounded-md') as HTMLElement;
  const cardB = screen.getByText('卡片 2').closest('div.rounded-md') as HTMLElement;
  assert.ok(within(cardA).queryByRole('button', { name: /新增按鈕/ }) === null, '3 顆時不能再加');
  fireEvent.click(within(cardB).getByRole('button', { name: /新增按鈕/ }));
  assert.deepEqual(lastCall(onChange).elements[1].buttons, [{ type: 'web_url', title: '', url: '' }]);
});

test('Media type choice：大圖廣告媒體類型是下拉選單，只有圖片與影片', () => {
  const onChange = vi.fn();
  render(<FbMediaEditor body={{ media_type: 'image', url: 'https://example.com/a.jpg' }} onChange={onChange} />);
  const select = screen.getByLabelText('媒體類型') as HTMLSelectElement;
  assert.equal(select.tagName, 'SELECT');
  assert.deepEqual([...select.options].map((o) => o.value), ['image', 'video']);
  fireEvent.change(select, { target: { value: 'video' } });
  assert.equal(lastCall(onChange).media_type, 'video');
});

test('FB 影片：可以直接上傳', () => {
  render(<FbVideoEditor body={{ url: '' }} onChange={vi.fn()} />);
  assert.ok(screen.getByRole('button', { name: /上傳/ }));
});
