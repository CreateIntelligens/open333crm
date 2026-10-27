/**
 * 契約的 dispatched 旗標要和 API 實際轉送進 automation queue 的事件一致（AUDIT AUTO-05）。
 * 旗標是手寫在契約裡的；之後有人替 case.closed 補上轉送卻忘了改旗標，
 * 編輯器會繼續警告「目前不會觸發」。這個測試讓兩邊不一致時失敗。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { AUTOMATION_EVENT_DEFINITIONS } from '@open333crm/automation';
import { EVENT_AUTOMATION_QUEUE, subscriberQueuesOf } from '@open333crm/core';
import { createEventRouter } from '#src/events/subscriber-workers.js';

vi.mock('#src/events/subscriber-workers.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('#src/events/subscriber-workers.js')>();
  return { ...original, createEventRouter: vi.fn(original.createEventRouter) };
});

test('契約標為會送出的事件，就是送進自動化佇列、且自動化訂閱者會處理的事件（SLA 與關鍵字規則由 workers 自己查規則）', async () => {
  const { setupAutomationWorker } = await import('#src/modules/automation/automation.worker.js');
  setupAutomationWorker({} as never, {} as never, {} as never);
  const router = vi.mocked(createEventRouter).mock.results[0].value as ReturnType<typeof createEventRouter>;
  const handled = new Set(router.names());
  // 送進自動化佇列（core 的訂閱清單）而且有處理程式，才算會送出
  const subscribed = new Set(
    [...handled].filter((name) => subscriberQueuesOf(name).includes(EVENT_AUTOMATION_QUEUE)),
  );

  for (const event of AUTOMATION_EVENT_DEFINITIONS) {
    // keyword.matched 規則由 workers 處理 message.received 時比對（change outbox-event-delivery），不經自動化佇列
    // contact.followed 由自動化訂閱者處理 message.received（contentType 'follow'）時另外排入（add-coupon-system design D28）
    const delivered =
      event.name.startsWith('sla.') ||
      event.name === 'keyword.matched' ||
      (event.name === 'contact.followed' && subscribed.has('message.received')) ||
      subscribed.has(event.name);
    assert.equal(
      event.dispatched !== false,
      delivered,
      delivered
        ? `${event.name} 已轉送進 queue，契約不應標為 dispatched: false`
        : `${event.name} 沒有轉送進 queue，契約要標 dispatched: false`,
    );
  }
});
