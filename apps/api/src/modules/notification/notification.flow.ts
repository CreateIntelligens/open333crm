/**
 * 站內通知路由的 flow：每個請求開一個綁定租戶的交易（AGENTS.md 結構規則 2）。
 * 這些操作沒有稽核、推播或事件，所以都寫成 flowOf()。
 */
import { flowOf } from '../../lib/tenant-ctx.js';
import { getUnreadCount, listNotifications, markAllAsRead, markAsRead } from './notification.service.js';

export const listNotificationsFlow = flowOf(listNotifications);
export const getUnreadCountFlow = flowOf(getUnreadCount);
export const markAsReadFlow = flowOf(markAsRead);
export const markAllAsReadFlow = flowOf(markAllAsRead);
