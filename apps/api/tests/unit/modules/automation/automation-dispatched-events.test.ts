/**
 * 契約的 dispatched 旗標要和 API 實際轉送進 automation queue 的事件一致（AUDIT AUTO-05）。
 * 旗標是手寫在契約裡的；之後有人替 case.closed 補上轉送卻忘了改旗標，
 * 編輯器會繼續警告「目前不會觸發」。這個測試讓兩邊不一致時失敗。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { AUTOMATION_EVENT_DEFINITIONS } from '@open333crm/automation';
import { eventBus } from '#src/events/event-bus.js';
import { setupAutomationWorker } from '#src/modules/automation/automation.worker.js';

test('契約標為會送出的事件，就是 automation worker 訂閱的事件（SLA 事件由 workers 自己查規則）', () => {
  const subscribed = new Set<string>();
  const spy = vi.spyOn(eventBus, 'subscribe').mockImplementation((name) => {
    subscribed.add(String(name));
  });
  try {
    setupAutomationWorker({} as never, {} as never);
  } finally {
    spy.mockRestore();
  }

  for (const event of AUTOMATION_EVENT_DEFINITIONS) {
    const delivered = event.name.startsWith('sla.') || subscribed.has(event.name);
    assert.equal(
      event.dispatched !== false,
      delivered,
      delivered
        ? `${event.name} 已轉送進 queue，契約不應標為 dispatched: false`
        : `${event.name} 沒有轉送進 queue，契約要標 dispatched: false`,
    );
  }
});
