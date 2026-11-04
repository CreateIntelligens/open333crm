/**
 * Office Hours Service
 *
 * Manages tenant office hours configuration and provides
 * helpers to check if current time is within office hours.
 */

import { createOrFindExisting } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import {
  DEFAULT_OUTSIDE_HOURS_MESSAGE,
  defaultOfficeHoursSettings,
  readOfficeHoursSettings,
  type OfficeHoursConfig,
} from './office-hours-settings.js';

export type { OfficeHoursConfig } from './office-hours-settings.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Get office hours settings for a tenant. 租戶還沒有設定列時建立一列；
 * 同時有另一個請求建立時，改用對方建立的那一列（createOrFindExisting）。
 */
export async function getOfficeHours(
  ctx: TenantCtx,
): Promise<{ timezone: string; officeHours: OfficeHoursConfig }> {
  const find = () => ctx.tx.tenantSettings.findUnique({ where: { tenantId: ctx.tenantId } });
  let settings = await find();

  if (!settings) {
    const defaults = defaultOfficeHoursSettings();
    ({ row: settings } = await createOrFindExisting(
      () =>
        ctx.tx.tenantSettings.createManyAndReturn({
          data: [{ tenantId: ctx.tenantId, timezone: defaults.timezone, officeHours: defaults.officeHours as any }],
          skipDuplicates: true,
        }),
      find,
    ));
  }

  return readOfficeHoursSettings(settings);
}

/**
 * Update office hours settings for a tenant.
 */
export async function updateOfficeHours(
  ctx: TenantCtx,
  timezone: string,
  officeHours: OfficeHoursConfig,
): Promise<{ timezone: string; officeHours: OfficeHoursConfig }> {
  const settings = await ctx.tx.tenantSettings.upsert({
    where: { tenantId: ctx.tenantId },
    create: {
      tenantId: ctx.tenantId,
      timezone,
      officeHours: officeHours as any,
    },
    update: {
      timezone,
      officeHours: officeHours as any,
    },
  });

  return readOfficeHoursSettings(settings);
}

/**
 * Check if the current time is within office hours for the given tenant.
 */
export async function isWithinOfficeHours(ctx: TenantCtx): Promise<boolean> {
  const { timezone, officeHours } = await getOfficeHours(ctx);

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
export async function getOutsideHoursMessage(ctx: TenantCtx): Promise<string | null> {
  const { officeHours } = await getOfficeHours(ctx);

  if (!officeHours.enabled) return null;

  const withinHours = await isWithinOfficeHours(ctx);
  if (withinHours) return null;

  return officeHours.outsideHoursMessage || DEFAULT_OUTSIDE_HOURS_MESSAGE;
}
