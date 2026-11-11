/**
 * 標籤的 flow（#337 階段 3，AGENTS.md 結構規則 2）：標籤管理頁，以及聯絡人、工單、對話的貼標路由。
 *
 * 貼聯絡人標籤時，contact.tagged 與貼標一起寫進 outbox（tag-effects.ts）。
 * 工單與對話的貼標不發事件，與搬遷前相同。
 */
import type { PrismaClient } from '@prisma/client';
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import { createOutboxPublisher, type EventPublisher } from '../../events/outbox-publisher.js';
import {
  addTagToTarget,
  createTenantTag,
  deleteTenantTag,
  listTenantTags,
  removeTagFromTarget,
  updateTenantTag,
} from './tagging.service.js';
import { publishContactTagged } from './tag-effects.js';

export interface TagFlowDeps {
  prisma: PrismaClient;
  /** 單元測試注入假的實作；沒有給時用 outbox */
  events?: EventPublisher;
}

export const listTagsFlow = flowOf(listTenantTags);
export const createTagFlow = flowOf(createTenantTag);
export const updateTagFlow = flowOf(updateTenantTag);
/** 標籤與它的所有貼標在同一個交易內刪除 */
export const deleteTagFlow = flowOf(deleteTenantTag);
export const removeTagFromTargetFlow = flowOf(removeTagFromTarget);

export function addTagToTargetFlow(deps: TagFlowDeps, tenantId: string, input: Parameters<typeof addTagToTarget>[1]) {
  return inTenant(deps.prisma, tenantId, async (scope) => {
    const assignment = await addTagToTarget(scope, input);
    if (input.targetType === 'CONTACT') {
      await publishContactTagged(scope, deps.events ?? createOutboxPublisher(deps.prisma), {
        contactId: input.targetId,
        tagId: input.tagId,
        tagName: assignment.tag.name,
        source: input.addedBy ?? 'agent',
      });
    }
    return assignment;
  });
}
