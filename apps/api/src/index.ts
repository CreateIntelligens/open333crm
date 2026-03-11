import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';

import { env } from './config/env.js';

const app = Fastify({ logger: true });

// ── Plugins ───────────────────────────────
await app.register(cors, { origin: env.CORS_ORIGIN });
await app.register(jwt, { secret: env.JWT_SECRET });
await app.register(websocket);
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

// ── Health check ──────────────────────────
app.get('/health', async () => ({ status: 'ok', version: '0.1.0' }));

// ── Webhook routes ────────────────────────
// TODO: register channel webhook routes
// app.register(lineWebhookRoutes, { prefix: '/webhooks/line' });
// app.register(fbWebhookRoutes,   { prefix: '/webhooks/fb' });
// app.register(webchatRoutes,     { prefix: '/webhooks/webchat' });

// ── API routes ────────────────────────────
// TODO: register API route modules
// app.register(authRoutes,        { prefix: '/api/v1/auth' });
// app.register(contactRoutes,     { prefix: '/api/v1/contacts' });
// app.register(conversationRoutes,{ prefix: '/api/v1/conversations' });
// app.register(caseRoutes,        { prefix: '/api/v1/cases' });

// ── Start ─────────────────────────────────
try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`API Server running on port ${env.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
