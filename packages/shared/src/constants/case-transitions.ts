import type { CaseStatus } from '../types/case.types';

export const VALID_CASE_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['PENDING', 'RESOLVED', 'ESCALATED', 'CLOSED'],
  PENDING: ['IN_PROGRESS', 'ESCALATED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  ESCALATED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['OPEN'],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return VALID_CASE_TRANSITIONS[from]?.includes(to) ?? false;
}
