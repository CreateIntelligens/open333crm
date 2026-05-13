import type { Priority } from '../types/case.types.js';
import type { SlaState } from './events.js';

export const SLA_ACTIVE_CASE_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'PENDING',
  'ESCALATED',
] as const;

export const SLA_PRIORITY_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export function minutesUntil(target: Date, now: Date = new Date()): number {
  return Math.ceil((target.getTime() - now.getTime()) / 60_000);
}

export function minutesOverdue(target: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - target.getTime()) / 60_000));
}

export function getSlaState(
  dueAt: Date | null | undefined,
  warningBeforeMinutes: number,
  now: Date = new Date(),
): SlaState {
  if (!dueAt) return 'normal';
  if (now >= dueAt) return 'breached';

  const warningAt = new Date(dueAt.getTime() - warningBeforeMinutes * 60_000);
  return now >= warningAt ? 'warning' : 'normal';
}

export function bumpSlaPriority(priority: Priority | string): Priority | string {
  const idx = SLA_PRIORITY_ORDER.indexOf(priority as Priority);
  if (idx < 0 || idx >= SLA_PRIORITY_ORDER.length - 1) return priority;
  return SLA_PRIORITY_ORDER[idx + 1];
}

export function getSlaDeadlineFromCreatedAt(
  createdAt: Date,
  targetMinutes: number,
): Date {
  return new Date(createdAt.getTime() + targetMinutes * 60_000);
}
