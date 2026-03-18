import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';

import { env } from './config/env.js';
import { licenseService } from './services/license.js';

const app = Fastify({ logger: true });

// ── Initialization ────────────────────────
await licenseService.initialize();

// ── Plugins ───────────────────────────────
await app.register(cors, { origin: env.CORS_ORIGIN });
await app.register(jwt, { secret: env.JWT_SECRET });
await app.register(websocket);
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

// ── Health check ──────────────────────────
app.get('/health', async () => ({ status: 'ok', version: '0.1.0' }));

// ── Webhook routes ────────────────────────
import webhookRoutes from './routes/webhooks.js';

app.register(webhookRoutes, { prefix: '/webhooks' });


// ── API routes ────────────────────────────
import kmRoutes from './routes/km.js';
import brainRoutes from './routes/brain.js';
import channelRoutes from './routes/channels.js';
import reportRoutes from './routes/reports.js';

app.register(kmRoutes, { prefix: '/api/v1/km' });
app.register(brainRoutes, { prefix: '/api/v1/brain' });
app.register(channelRoutes, { prefix: '/api/v1/channels' });
app.register(reportRoutes, { prefix: '/api/v1/reports' });


// ── Start ─────────────────────────────────
try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`API Server running on port ${env.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
