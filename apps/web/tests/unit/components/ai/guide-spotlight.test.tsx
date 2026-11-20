// @vitest-environment jsdom
/**
 * 導覽的說明卡（change add-dashboard-guide-assistant，規格 dashboard-guide-assistant「導覽逐步顯示說明卡」）。
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GuideStep } from '@open333crm/shared';
import { GuideSpotlight } from '#src/components/ai/GuideSpotlight.js';

const CLICK_STEP: GuideStep = { target: 'keyword-reply.open', action: 'click', note: '點「建立關鍵字回覆」' };
const LAST_STEP: GuideStep = { target: 'keyword-reply.keyword', action: 'highlight', note: '輸入關鍵字' };

function addTarget(tag: 'button' | 'input'): HTMLElement {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  return el;
}

function renderStep(step: GuideStep, index: number, total: number) {
  const target = addTarget(step.action === 'click' ? 'button' : 'input');
  const onNext = vi.fn();
  const onClose = vi.fn();
  render(<GuideSpotlight target={target} step={step} progress={{ index, total }} onNext={onNext} onClose={onClose} />);
  return { target, onNext, onClose };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('導覽逐步顯示說明卡', () => {
  test('點擊步驟等員工操作', async () => {
    const { target, onNext } = renderStep(CLICK_STEP, 1, 2);
    const clicked = vi.fn();
    target.addEventListener('click', clicked);
    assert.ok(await screen.findByText('第 1 / 2 步'));
    assert.ok(screen.getByText('點「建立關鍵字回覆」'));
    assert.ok(screen.getByRole('button', { name: '下一步' }));
    assert.equal(clicked.mock.calls.length, 0, '不自動點擊');
    assert.equal(onNext.mock.calls.length, 0);
  });

  test('員工點擊元素後進行下一步', async () => {
    const { target, onNext, onClose } = renderStep(CLICK_STEP, 1, 2);
    await screen.findByText('第 1 / 2 步');
    fireEvent.pointerDown(target);
    fireEvent.click(target);
    assert.equal(onNext.mock.calls.length, 1);
    assert.equal(onClose.mock.calls.length, 0, '點擊被標示的元素不結束導覽');
  });

  test('按下一步時代員工點擊', async () => {
    const { target, onNext } = renderStep(CLICK_STEP, 1, 2);
    const clicked = vi.fn();
    target.addEventListener('click', clicked);
    fireEvent.click(await screen.findByRole('button', { name: '下一步' }));
    assert.equal(clicked.mock.calls.length, 1, '點擊元素一次');
    assert.equal(onNext.mock.calls.length, 1, '只進行一步');
  });

  test('最後一步顯示完成', async () => {
    const { onNext } = renderStep(LAST_STEP, 2, 2);
    assert.ok(await screen.findByText('第 2 / 2 步'));
    assert.ok(screen.queryByRole('button', { name: '下一步' }) === null);
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    assert.equal(onNext.mock.calls.length, 1);
  });

  test('員工中途結束導覽', async () => {
    const { onClose, onNext } = renderStep(CLICK_STEP, 1, 2);
    await screen.findByText('第 1 / 2 步');
    // 回傳 false 代表預設行為被取消：原生 <dialog> 不會跟著關閉
    assert.equal(fireEvent.keyDown(document, { key: 'Escape' }), false, 'Esc 不關閉底下的對話框');
    assert.equal(onClose.mock.calls.length, 1);
    assert.equal(onNext.mock.calls.length, 0);
  });

  test('點擊說明卡與元素以外的地方時結束導覽', async () => {
    const other = addTarget('button');
    const { onClose } = renderStep(LAST_STEP, 2, 2);
    await screen.findByText('第 2 / 2 步');
    fireEvent.pointerDown(other);
    assert.equal(onClose.mock.calls.length, 1);
  });

  test('元素在 modal 對話框裡', async () => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', ''); // jsdom 沒有 showModal()
    document.body.appendChild(dialog);
    const field = document.createElement('input');
    dialog.appendChild(field);
    render(
      <GuideSpotlight target={field} step={LAST_STEP} progress={{ index: 2, total: 2 }} onNext={vi.fn()} onClose={vi.fn()} />,
    );
    const card = await screen.findByRole('dialog', { name: '操作提示' });
    assert.ok(card.closest('dialog') === dialog, '說明卡放在對話框內');
  });
});
