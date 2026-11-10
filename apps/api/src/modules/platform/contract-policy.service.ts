/**
 * 合約到期提醒參數（存 PlatformSetting KV，可用 PUT /api/v1/platform/settings/:key 修改）。
 * 比照 trial-policy.service：DB 沒有值或值不合法時用程式預設值，不依賴 seed。
 */
import type { PrismaClient } from '@prisma/client';
import { getPlatformSetting } from './platform-setting.service.js';

export const CONTRACT_REMINDER_DAYS_KEY = 'contract.reminderDaysBefore';
export const DEFAULT_CONTRACT_REMINDER_DAYS = [30, 7, 1];

/**
 * @description 讀取合約到期前的提醒檔位（天數，正整數陣列）
 * @param prisma 平台層 executor（prismaAdmin）
 * @returns 去重、由大到小排序的檔位；設定缺漏或含非正整數時回預設值
 */
export async function getContractReminderDays(prisma: PrismaClient): Promise<number[]> {
  const value = await getPlatformSetting(prisma, CONTRACT_REMINDER_DAYS_KEY);
  const valid =
    Array.isArray(value) && value.length > 0 && value.every((d) => Number.isInteger(d) && (d as number) > 0);
  const days = valid ? (value as number[]) : DEFAULT_CONTRACT_REMINDER_DAYS;
  return [...new Set(days)].sort((a, b) => b - a);
}
