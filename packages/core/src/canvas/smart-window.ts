/**
 * Smart Window scheduling utility (Task 3.3)
 * Defers a scheduled time to outside of "quiet hours" (default 22:00–08:00).
 */

// ── Default configuration ──────────────────────────────────────────────────

interface SmartWindowConfig {
  quietStartHour?: number;   // 0–23, default 22
  quietEndHour?: number;     // 0–23, default 8
  nextActiveHour?: number;   // hour to resume at, default 9
}

// ── checkSmartWindow ───────────────────────────────────────────────────────

/**
 * Adjust a Date so that it falls within the active window.
 * If scheduledAt is within quiet hours (default 22:00–08:00 local time),
 * push it to the next active start (default 09:00).
 *
 * @param scheduledAt - The currently planned execution time
 * @param timezone    - IANA timezone string (e.g. 'Asia/Taipei')
 * @param config      - Optional override for quiet hour bounds
 * @returns Adjusted Date that falls within the active window
 */
export function checkSmartWindow(
  scheduledAt: Date,
  timezone = 'Asia/Taipei',
  config: SmartWindowConfig = {},
): Date {
  const { quietStartHour = 22, quietEndHour = 8, nextActiveHour = 9 } = config;

  // Get local hour in the given timezone
  const localHour = getLocalHour(scheduledAt, timezone);

  if (isQuietHour(localHour, quietStartHour, quietEndHour)) {
    return toNextActiveTime(scheduledAt, timezone, quietEndHour, nextActiveHour);
  }

  return scheduledAt;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Returns the hour-of-day (0–23) in the given IANA timezone. */
function getLocalHour(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hourPart = parts.find((p) => p.type === 'hour');
  return hourPart ? Number(hourPart.value) % 24 : date.getUTCHours();
}

/** True if localHour is within the quiet window (may wrap midnight). */
function isQuietHour(localHour: number, quietStart: number, quietEnd: number): boolean {
  if (quietStart > quietEnd) {
    // Wraps midnight: e.g. 22–08
    return localHour >= quietStart || localHour < quietEnd;
  }
  // Same-day window: e.g. 01–06
  return localHour >= quietStart && localHour < quietEnd;
}

/**
 * Returns a new Date set to the next occurrence of nextActiveHour in the given timezone.
 * If the quiet window ends today (quietEndHour already passed for today), still advances to tomorrow.
 */
function toNextActiveTime(
  from: Date,
  timezone: string,
  quietEndHour: number,
  nextActiveHour: number,
): Date {
  const localHour = getLocalHour(from, timezone);
  const adjusted = new Date(from);

  // Compute ms offset to midnight local in the given TZ
  const offsetMs = getTimezoneOffsetMs(from, timezone);
  const localMs = from.getTime() + offsetMs;

  // Start of local "today" in UTC
  const startOfDayMs = localMs - (localMs % 86_400_000);

  let targetMs = startOfDayMs + nextActiveHour * 3_600_000 - offsetMs;

  // If that moment is in the past or still in quiet hours, move to tomorrow
  if (targetMs <= from.getTime() || localHour >= quietEndHour) {
    targetMs += 86_400_000;
  }

  adjusted.setTime(targetMs);
  return adjusted;
}

/** Returns the UTC offset in ms for a given timezone at the given date (handles DST). */
function getTimezoneOffsetMs(date: Date, timezone: string): number {
  // Use Intl to get the offset by comparing local midnight to UTC midnight
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  // Build local date from parts
  const localDate = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`,
  );

  // Offset = localTime - UTCTime
  return localDate.getTime() - date.getTime();
}
