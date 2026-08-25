/**
 * 試用政策參數（存 PlatformSetting KV，平台後台可改，非寫死）。
 * typed accessor 帶程式預設值——DB 無值時用預設，避免 seed 依賴。
 */
import type { PrismaClient } from '@prisma/client';
import { getPlatformSetting } from '../platform/platform-setting.service.js';

export interface TrialPolicy {
  enabled: boolean;
  durationDays: number;
  reminderDaysBefore: number[];
  verifyTokenTtlHours: number;
  dataRetentionDays: number;
  planSlug: string;
}

const DEFAULTS: TrialPolicy = {
  enabled: false, // 預設關閉；上線後由平台後台打開
  durationDays: 14,
  reminderDaysBefore: [7, 1],
  verifyTokenTtlHours: 24,
  dataRetentionDays: 30,
  planSlug: 'trial',
};

const KEY = (k: keyof TrialPolicy) => `trial.${k}`;

export async function getTrialPolicy(prisma: PrismaClient): Promise<TrialPolicy> {
  const [enabled, durationDays, reminderDaysBefore, verifyTokenTtlHours, dataRetentionDays, planSlug] =
    await Promise.all([
      getPlatformSetting(prisma, KEY('enabled')),
      getPlatformSetting(prisma, KEY('durationDays')),
      getPlatformSetting(prisma, KEY('reminderDaysBefore')),
      getPlatformSetting(prisma, KEY('verifyTokenTtlHours')),
      getPlatformSetting(prisma, KEY('dataRetentionDays')),
      getPlatformSetting(prisma, KEY('planSlug')),
    ]);

  return {
    enabled: typeof enabled === 'boolean' ? enabled : DEFAULTS.enabled,
    durationDays: typeof durationDays === 'number' ? durationDays : DEFAULTS.durationDays,
    reminderDaysBefore: Array.isArray(reminderDaysBefore)
      ? (reminderDaysBefore as number[])
      : DEFAULTS.reminderDaysBefore,
    verifyTokenTtlHours:
      typeof verifyTokenTtlHours === 'number' ? verifyTokenTtlHours : DEFAULTS.verifyTokenTtlHours,
    dataRetentionDays:
      typeof dataRetentionDays === 'number' ? dataRetentionDays : DEFAULTS.dataRetentionDays,
    planSlug: typeof planSlug === 'string' ? planSlug : DEFAULTS.planSlug,
  };
}
