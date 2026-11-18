/**
 * Rich Menu 狀態的顯示文字與 Badge 樣式（列表頁、編輯頁共用）
 * 發布中停留超過 5 分鐘視為「發布中斷」，判斷規則在 lib/rich-menu-status。
 */
import type { BadgeProps } from '@/components/ui/badge';
import { isRichMenuPublishInterrupted } from '@/lib/rich-menu-status';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

const STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: '草稿', variant: 'secondary' },
  publishing: { label: '發布中', variant: 'info' },
  published: { label: '已發布', variant: 'success' },
  error: { label: '發布失敗', variant: 'danger' },
};

export function richMenuStatusInfo(menu: { status: string; updatedAt: string }): { label: string; variant: BadgeVariant } {
  if (isRichMenuPublishInterrupted(menu)) return { label: '發布中斷', variant: 'warning' };
  return STATUS[menu.status] ?? { label: menu.status, variant: 'secondary' };
}
