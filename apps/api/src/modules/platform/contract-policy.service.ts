/**
 * 合約到期提醒參數（存 PlatformSetting KV）。
 * 寫入：平台後台「租戶管理」頁經 PUT /api/v1/platform/settings/contract.reminderDaysBefore，
 * 路由以 parseContractReminderDays() 驗證，不合法回 400（通用設定端點對其他鍵仍無型別，見 AUDIT TRIAL-02）。
 * 讀取：DB 沒有值或是舊的不合法值時用程式預設值，不依賴 seed。
 */
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import { getPlatformSetting } from './platform-setting.service.js';

export const CONTRACT_REMINDER_DAYS_KEY = 'contract.reminderDaysBefore';
export const DEFAULT_CONTRACT_REMINDER_DAYS = [30, 7, 1];
export const MAX_CONTRACT_REMINDER_DAY = 365;

/**
 * @description 驗證並正規化提醒檔位
 * @param value 任意 JSON 值
 * @returns 去重、由大到小排序的檔位；不是 1–365 整數組成的非空陣列時回 null
 */
function normalizeReminderDays(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ok = value.every((d) => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= MAX_CONTRACT_REMINDER_DAY);
  if (!ok) return null;
  return [...new Set(value as number[])].sort((a, b) => b - a);
}

/**
 * @description 寫入前驗證提醒檔位
 * @param value PUT 送來的 value
 * @returns 正規化後要存入的檔位
 * @throws AppError 400 VALIDATION_ERROR：值不合法（不改存預設值）
 */
export function parseContractReminderDays(value: unknown): number[] {
  const days = normalizeReminderDays(value);
  if (!days) {
    throw new AppError(
      `提醒天數必須是 1 到 ${MAX_CONTRACT_REMINDER_DAY} 的整數組成的陣列，至少一個`,
      'VALIDATION_ERROR',
      400,
      { key: CONTRACT_REMINDER_DAYS_KEY },
    );
  }
  return days;
}

/**
 * @description 讀取合約到期前的提醒檔位（天數）
 * @param prisma 平台層 executor（prismaAdmin）
 * @returns 去重、由大到小排序的檔位；設定缺漏或為舊的不合法值時回預設值
 */
export async function getContractReminderDays(prisma: PrismaClient): Promise<number[]> {
  const value = await getPlatformSetting(prisma, CONTRACT_REMINDER_DAYS_KEY);
  return normalizeReminderDays(value) ?? [...DEFAULT_CONTRACT_REMINDER_DAYS];
}
