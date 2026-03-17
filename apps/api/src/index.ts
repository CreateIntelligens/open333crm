import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import authRoutes from './routes/authRoutes.js';
import migrationExampleUserRoutes from './routes/migrationExampleUserRoutes.js';
import { connectPostgres, disconnectPostgres } from './lib/prisma.js';

const app = Fastify({ logger: true });

// ── Plugins ───────────────────────────────
app.register(cors, { origin: env.CORS_ORIGIN });
app.register(jwt, { secret: env.JWT_SECRET });
app.register(websocket);
app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

// ── Health check ──────────────────────────
app.get('/health', async () => ({ status: 'ok', version: '0.3.0' }));

// ── Webhook routes ────────────────────────
// TODO: register channel webhook routes
// app.register(lineWebhookRoutes, { prefix: '/webhooks/line' });
// app.register(fbWebhookRoutes,   { prefix: '/webhooks/fb' });
// app.register(webchatRoutes,     { prefix: '/webhooks/webchat' });

// ── API routes ────────────────────────────
// TODO: register API route modules
app.register(authRoutes, { prefix: '/api/v1/auth' });
app.register(migrationExampleUserRoutes, { prefix: '/api/v1/migration-example-users' });
// app.register(contactRoutes,     { prefix: '/api/v1/contacts' });
// app.register(conversationRoutes,{ prefix: '/api/v1/conversations' });
// app.register(caseRoutes,        { prefix: '/api/v1/cases' });

app.addHook('onClose', async () => {
  await disconnectPostgres();
});

const start = async () => {
  await connectPostgres();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`API Server running on port ${env.PORT}`);
};

start().catch((error) => {
  app.log.error(error, 'Failed to start API server');
  process.exit(1);
});
