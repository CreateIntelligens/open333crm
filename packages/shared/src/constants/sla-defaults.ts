import type { Priority } from '../types/case.types';

export interface SlaDefault {
  priority: Priority;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  warningBeforeMinutes: number;
}

export const SLA_DEFAULTS: SlaDefault[] = [
  { priority: 'LOW', firstResponseMinutes: 480, resolutionMinutes: 4320, warningBeforeMinutes: 60 },
  { priority: 'MEDIUM', firstResponseMinutes: 240, resolutionMinutes: 1440, warningBeforeMinutes: 30 },
  { priority: 'HIGH', firstResponseMinutes: 60, resolutionMinutes: 240, warningBeforeMinutes: 15 },
  { priority: 'URGENT', firstResponseMinutes: 15, resolutionMinutes: 60, warningBeforeMinutes: 5 },
];
