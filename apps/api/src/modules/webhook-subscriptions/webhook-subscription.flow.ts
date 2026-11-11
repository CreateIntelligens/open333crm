/**
 * Webhook 訂閱管理的 flow（#337 階段 3，AGENTS.md 結構規則 2）。
 *
 * 每個操作只呼叫一個 service 函式，沒有推播、事件或稽核。
 * 測試送出（POST /:id/test）只在這裡讀訂閱；送出 HTTP 是外部呼叫，由 route 在交易之外呼叫 dispatchWebhook()。
 */
import { flowOf } from '../../lib/tenant-ctx.js';
import {
  createSubscription,
  deleteSubscription,
  getSubscription,
  listDeliveries,
  listSubscriptions,
  updateSubscription,
} from './webhook-subscription.service.js';

export const listSubscriptionsFlow = flowOf(listSubscriptions);
export const getSubscriptionFlow = flowOf(getSubscription);
export const createSubscriptionFlow = flowOf(createSubscription);
export const updateSubscriptionFlow = flowOf(updateSubscription);
export const deleteSubscriptionFlow = flowOf(deleteSubscription);
export const listDeliveriesFlow = flowOf(listDeliveries);
