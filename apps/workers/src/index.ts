import { Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
});

console.log('🚀 Workers starting...');

// ── Automation Worker ──────────────────────
const automationWorker = new Worker(
  'automation',
  async (job) => {
    console.log(`[automation] Processing job ${job.id}: ${job.name}`);
    // TODO: import and call AutomationEngine
  },
  { connection }
);

// ── Broadcast Worker ──────────────────────
const broadcastWorker = new Worker(
  'broadcast',
  async (job) => {
    console.log(`[broadcast] Processing job ${job.id}: ${job.name}`);
    // TODO: import and call BroadcastService
  },
  { connection }
);

// ── SLA Worker ────────────────────────────
const slaWorker = new Worker(
  'sla',
  async (job) => {
    console.log(`[sla] Processing job ${job.id}: ${job.name}`);
    // TODO: import and call SlaService
  },
  { connection }
);

// ── Notification Worker ───────────────────
const notificationWorker = new Worker(
  'notification',
  async (job) => {
    console.log(`[notification] Processing job ${job.id}: ${job.name}`);
    // TODO: import and call NotificationService
  },
  { connection }
);

// ── Graceful shutdown ─────────────────────
const shutdown = async () => {
  console.log('Shutting down workers...');
  await Promise.all([
    automationWorker.close(),
    broadcastWorker.close(),
    slaWorker.close(),
    notificationWorker.close(),
  ]);
  connection.disconnect();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('✅ Workers ready: automation, broadcast, sla, notification');
