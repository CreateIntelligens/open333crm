/**
 * 佇列監控列出的佇列（change queue-monitoring，design 決策 1）。
 *
 * API 與 workers 兩個行程使用中的每個 BullMQ 佇列。新增佇列時加進這裡：
 * monitored-queues.test.ts 以兩個行程的 Worker 清單核對沒有遺漏。
 * scheduleWaitNode() 的 BullMQ 分支與 LINE 沒有用到的三個佇列不會在 Redis 留下 job，不列進來（AUDIT.md APP-07、PKG-06）。
 */
import {
  EVENT_AUTOMATION_QUEUE,
  EVENT_NOTIFICATION_QUEUE,
  EVENT_WEBHOOK_QUEUE,
  USAGE_ALERT_EMAIL_QUEUE,
  WEBHOOK_DELIVERY_QUEUE,
} from '@open333crm/core';
import { OPS_ALERT_QUEUE } from '../ops-alert/ops-alert.service.js';

/** API 行程消費的佇列 */
export const API_QUEUES: readonly string[] = [
  EVENT_NOTIFICATION_QUEUE,
  EVENT_AUTOMATION_QUEUE,
  EVENT_WEBHOOK_QUEUE,
  WEBHOOK_DELIVERY_QUEUE,
  USAGE_ALERT_EMAIL_QUEUE,
  'api-scheduler',
  OPS_ALERT_QUEUE,
];

/** workers 行程消費的佇列 */
export const WORKERS_QUEUES: readonly string[] = [
  'notification',
  'automation',
  'rich-menu-bind',
  'data-erasure',
  'data-export',
  'sla',
  'data-export-cleanup',
  'tag-expiry-cleanup',
  'agent-retention-cleanup',
];

export const MONITORED_QUEUES: readonly string[] = [...API_QUEUES, ...WORKERS_QUEUES];

/**
 * job 移到 failed set 時發出告警的佇列。ops-alert 自己的佇列不在內：
 * 告警送不出時只記 log，不再發出新的告警（ops-alert「送出告警至少一次」）。
 */
export const ALERTED_QUEUES: readonly string[] = MONITORED_QUEUES.filter((name) => name !== OPS_ALERT_QUEUE);
