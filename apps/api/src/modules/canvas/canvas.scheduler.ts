import { processResumeQueue } from '@open333crm/core';
import type { JobScheduler } from '../../lib/job-scheduler.js';

const POLL_INTERVAL_MS = 60_000;
// 這一期最久會跑多久。上一期還沒跑完時，下一期略過
const MAX_RUN_MS = 10 * 60_000;

export function setupCanvasScheduler(scheduler: JobScheduler) {
  scheduler.registerSchedule({
    id: 'canvas-resume',
    every: POLL_INTERVAL_MS,
    withoutOverlapping: { expiresInMs: MAX_RUN_MS },
    run: () => processResumeQueue(),
  });
}
