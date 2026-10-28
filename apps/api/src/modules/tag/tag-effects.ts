/**
 * 聯絡人貼標的事件（#337 階段 3，AGENTS.md 結構規則 2）。
 *
 * 貼聯絡人標籤的入口有好幾個：客服手動貼標、素材點擊貼標、會員綁定、發券。
 * contact.tagged 的內容在這裡組一次，各入口的 flow 都呼叫這個函式。
 * 事件與貼標一起寫進 outbox，commit 之後才送出；rollback 時不送出。
 */
import type { TenantScope } from '../../lib/tenant-ctx.js';
import { publishEvent, type EventPublisher } from '../../events/outbox-publisher.js';
import type { ContactTagged } from './tagging.service.js';

export function publishContactTagged(scope: TenantScope, events: EventPublisher, tagged: ContactTagged): Promise<void> {
  return publishEvent(scope, events, 'contact.tagged', {
    contactId: tagged.contactId,
    tagId: tagged.tagId,
    tagName: tagged.tagName,
    source: tagged.source,
  });
}
