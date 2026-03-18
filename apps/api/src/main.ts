import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';
import Fastify from 'fastify';

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '..', '..', '..', '.env');
dotenv.config({ path: envPath });

// Import config validation
import { loadEnvConfig } from './config/env.js';

// Import plugins
import prismaPlugin from './plugins/prisma.plugin.js';
import authPlugin from './plugins/auth.plugin.js';
import multipart from '@fastify/multipart';
import corsPlugin from './plugins/cors.plugin.js';
import errorHandlerPlugin from './plugins/error-handler.plugin.js';
import socketPlugin from './plugins/socket.plugin.js';

// Import route modules
import authRoutes from './modules/auth/auth.routes.js';
import conversationRoutes from './modules/conversation/conversation.routes.js';
import contactRoutes from './modules/contact/contact.routes.js';
import caseRoutes from './modules/case/case.routes.js';
import tagRoutes from './modules/tag/tag.routes.js';
import agentRoutes from './modules/agent/agent.routes.js';
import simulatorRoutes from './channels/simulator/simulator.routes.js';
import automationRoutes from './modules/automation/automation.routes.js';
import channelRoutes from './modules/channel/channel.routes.js';
import webhookRoutes from './modules/webhook/webhook.routes.js';
import knowledgeRoutes from './modules/knowledge/knowledge.routes.js';
import marketingRoutes from './modules/marketing/marketing.routes.js';
import aiRoutes from './modules/ai/ai.routes.js';
import slaRoutes from './modules/sla/sla.routes.js';
import lineLoginRoutes from './modules/line-login/line-login.routes.js';
import fbLoginRoutes from './modules/fb-login/fb-login.routes.js';

// Import automation worker
import { setupAutomationWorker } from './modules/automation/automation.worker.js';

// Import channel plugins
import { registerChannelPlugin } from './channels/registry.js';
import { linePlugin } from './channels/line/line.plugin.js';
import { fbPlugin } from './channels/fb/fb.plugin.js';
import { webchatPlugin } from './channels/webchat/webchat.plugin.js';

async function bootstrap() {
  // 1. Validate env config
  const config = loadEnvConfig();

  // 2. Create Fastify instance
  const app = Fastify({
    logger: {
      level: 'info',
      transport:
        process.env.NODE_ENV !== 'production'
          ? {
              target: 'pino-pretty',
              options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
  });

  // 3. Register plugins (order matters)
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB
  await app.register(corsPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(prismaPlugin);
  await app.register(authPlugin);
  await app.register(socketPlugin);

  // 4. Register channel plugins
  registerChannelPlugin(linePlugin);
  registerChannelPlugin(fbPlugin);
  registerChannelPlugin(webchatPlugin);

  // 5. Health check
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.0.1',
  }));

  // 6. Register route modules
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(conversationRoutes, { prefix: '/api/v1/conversations' });
  await app.register(contactRoutes, { prefix: '/api/v1/contacts' });
  await app.register(caseRoutes, { prefix: '/api/v1/cases' });
  await app.register(tagRoutes, { prefix: '/api/v1/tags' });
  await app.register(agentRoutes, { prefix: '/api/v1/agents' });
  await app.register(simulatorRoutes, { prefix: '/api/v1/simulator' });
  await app.register(automationRoutes, { prefix: '/api/v1/automation' });
  await app.register(channelRoutes, { prefix: '/api/v1/channels' });
  await app.register(webhookRoutes, { prefix: '/api/v1/webhooks' });
  await app.register(knowledgeRoutes, { prefix: '/api/v1/knowledge' });
  await app.register(marketingRoutes, { prefix: '/api/v1/marketing' });
  await app.register(aiRoutes, { prefix: '/api/v1/ai' });
  await app.register(slaRoutes, { prefix: '/api/v1/sla-policies' });
  await app.register(lineLoginRoutes, { prefix: '/api/v1/auth/line' });
  await app.register(fbLoginRoutes, { prefix: '/api/v1/auth/fb' });

  // 7. Setup automation event-bus worker
  setupAutomationWorker(app.prisma, app.io);

  // 8. Start server
  try {
    await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
    app.log.info(`open333CRM API running on port ${config.API_PORT}`);
    app.log.info(`WebSocket server attached`);
    app.log.info(`Registered channel plugins: LINE, FB, WEBCHAT`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      await app.close();
      process.exit(0);
    });
  }
}

bootstrap();
