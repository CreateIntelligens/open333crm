/**
 * Office Hours Service
 *
 * Manages tenant office hours configuration and provides
 * helpers to check if current time is within office hours.
 */

import type { PrismaClient } from '@prisma/client';

export interface DaySchedule {
  start: string; // "HH:mm"
  end: string;   // "HH:mm"
}

export interface OfficeHoursConfig {
  enabled: boolean;
  schedule: {
    mon?: DaySchedule | null;
    tue?: DaySchedule | null;
    wed?: DaySchedule | null;
    thu?: DaySchedule | null;
    fri?: DaySchedule | null;
    sat?: DaySchedule | null;
    sun?: DaySchedule | null;
  };
  holidays: string[]; // ISO date strings "YYYY-MM-DD"
  outsideHoursMessage: string;
}

const DEFAULT_OFFICE_HOURS: OfficeHoursConfig = {
  enabled: false,
  schedule: {
    mon: { start: '09:00', end: '18:00' },
    tue: { start: '09:00', end: '18:00' },
    wed: { start: '09:00', end: '18:00' },
    thu: { start: '09:00', end: '18:00' },
    fri: { start: '09:00', end: '18:00' },
    sat: null,
    sun: null,
  },
  holidays: [],
  outsideHoursMessage: '您好！目前為非營業時間，我們將在營業時間內盡速回覆您。',
};

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Get office hours settings for a tenant (upsert if not exists).
 */
export async function getOfficeHours(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{ timezone: string; officeHours: OfficeHoursConfig }> {
  let settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
  });

  if (!settings) {
    settings = await prisma.tenantSettings.create({
      data: {
        tenantId,
        timezone: 'Asia/Taipei',
        officeHours: DEFAULT_OFFICE_HOURS as any,
      },
    });
  }

  const officeHours = (settings.officeHours as unknown as OfficeHoursConfig) || DEFAULT_OFFICE_HOURS;

  return {
    timezone: settings.timezone,
    officeHours,
  };
}

/**
 * Update office hours settings for a tenant.
 */
export async function updateOfficeHours(
  prisma: PrismaClient,
  tenantId: string,
  timezone: string,
  officeHours: OfficeHoursConfig,
): Promise<{ timezone: string; officeHours: OfficeHoursConfig }> {
  const settings = await prisma.tenantSettings.upsert({
    where: { tenantId },
    create: {
      tenantId,
      timezone,
      officeHours: officeHours as any,
    },
    update: {
      timezone,
      officeHours: officeHours as any,
    },
  });

  return {
    timezone: settings.timezone,
    officeHours: settings.officeHours as unknown as OfficeHoursConfig,
  };
}

/**
 * Check if the current time is within office hours for the given tenant.
 */
export async function isWithinOfficeHours(
  prisma: PrismaClient,
  tenantId: string,
): Promise<boolean> {
  const { timezone, officeHours } = await getOfficeHours(prisma, tenantId);

  if (!officeHours.enabled) return true; // If not enabled, always "open"

  // Get current time in tenant's timezone
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  const dayOfWeek = now.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'short' }).toLowerCase().slice(0, 3);
  const hour = parseInt(getPart('hour'), 10);
  const minute = parseInt(getPart('minute'), 10);
  const currentMinutes = hour * 60 + minute;

  // Check holidays
  const dateStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
  if (officeHours.holidays.includes(dateStr)) return false;

  // Check day schedule
  const dayKey = dayOfWeek as keyof typeof officeHours.schedule;
  const schedule = officeHours.schedule[dayKey];
  if (!schedule) return false; // Day is off

  const [startH, startM] = schedule.start.split(':').map(Number);
  const [endH, endM] = schedule.end.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Get the outside-hours auto-reply message for a tenant.
 * Returns null if office hours are not enabled or currently within hours.
 */
export async function getOutsideHoursMessage(
  prisma: PrismaClient,
  tenantId: string,
): Promise<string | null> {
  const { officeHours } = await getOfficeHours(prisma, tenantId);

  if (!officeHours.enabled) return null;

  const withinHours = await isWithinOfficeHours(prisma, tenantId);
  if (withinHours) return null;

  return officeHours.outsideHoursMessage || DEFAULT_OFFICE_HOURS.outsideHoursMessage;
}
