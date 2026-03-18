import { canTransition } from '@open333crm/shared';
import type { CaseStatus } from '@open333crm/shared';
import { AppError } from '../../shared/utils/response.js';

export function validateTransition(from: CaseStatus, to: CaseStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError(
      `Invalid case status transition from ${from} to ${to}`,
      'INVALID_TRANSITION',
      422,
      { from, to },
    );
  }
}
