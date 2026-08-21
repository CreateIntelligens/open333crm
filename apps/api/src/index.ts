import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';

// Load env BEFORE any module that captures process.env at import time
// (e.g. BullMQ Queue constructed with `connection: { url: process.env.REDIS_URL }`
// in notification.worker.ts / automation.worker.ts).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '..', '..', '..', '.env') });

import Fastify from 'fastify';
import multipart from '@fastify/multipart';

import { validatePermissionRegistry, validateRouteCodes } from '@open333crm/core';
import { usedPermissionCodes } from './guards/rbac.guard.js';
import { loadEnvConfig } from './config/env.js';
import prismaPlugin from './plugins/prisma.plugin.js';
import cookiePlugin from './plugins/cookie.plugin.js';
import authPlugin from './plugins/auth.plugin.js';
import corsPlugin from './plugins/cors.plugin.js';
import errorHandlerPlugin from './plugins/error-handler.plugin.js';
import socketPlugin from './plugins/socket.plugin.js';
import chatboxPlugin from './plugins/chatbox.plugin.js';
import authRoutes from './modules/auth/auth.routes.js';
import conversationRoutes from './modules/conversation/conversation.routes.js';
import contactRoutes from './modules/contact/contact.routes.js';
import caseRoutes from './modules/case/case.routes.js';
import tagRoutes from './modules/tag/tag.routes.js';
import agentRoutes from './modules/agent/agent.routes.js';
import roleRoutes from './modules/role/role.routes.js';
import simulatorRoutes from './channels/simulator/simulator.routes.js';
import automationRoutes from './modules/automation/automation.routes.js';
import channelRoutes from './modules/channel/channel.routes.js';
import webhookRoutes from './modules/webhook/webhook.routes.js';
import knowledgeRoutes from './modules/knowledge/knowledge.routes.js';
import marketingRoutes from './modules/marketing/marketing.routes.js';
import materialRoutes from './modules/marketing/material.routes.js';
import aiRoutes from './modules/ai/ai.routes.js';
import slaRoutes from './modules/sla/sla.routes.js';
import lineLoginRoutes from './modules/line-login/line-login.routes.js';
import lineProfileRoutes from './modules/line/line-profile.routes.js';
import richMenuRoutes from './modules/line/rich-menu.routes.js';
import quickReplyPresetRoutes from './modules/line/quick-reply-preset.routes.js';
import fbLoginRoutes from './modules/fb-login/fb-login.routes.js';
import notificationRoutes from './modules/notification/notification.routes.js';
import analyticsRoutes from './modules/analytics/analytics.routes.js';
import settingsRoutes from './modules/settings/settings.routes.js';
import storageRoutes from './modules/storage/storage.routes.js';
import { ensureBucket } from './modules/storage/storage.service.js';
import webhookSubscriptionRoutes from './modules/webhook-subscriptions/webhook-subscription.routes.js';
import { setupWebhookDispatcher } from './modules/webhook-subscriptions/webhook-dispatcher.js';
import portalRoutes from './modules/portal/portal.routes.js';
import portalPublicRoutes from './modules/portal/portal-public.routes.js';
import shortlinkRoutes from './modules/shortlink/shortlink.routes.js';
import shortlinkRedirectRoutes from './modules/shortlink/shortlink-redirect.routes.js';
import webchatRoutes from './modules/webchat/webchat.routes.js';
import chatboxRoutes from './modules/chatbox/chatbox.routes.js';
import cliRoutes from './modules/cli/cli.routes.js';
import mcpRoutes from './modules/mcp/mcp.routes.js';
import { registerVisitorNamespace } from './modules/webchat/webchat.socket.js';
import canvasRoutes, { identityRoutes } from './modules/canvas/canvas.routes.js';
import { setupCanvasScheduler } from './modules/canvas/canvas.scheduler.js';
import { setupCanvasWorker } from './modules/canvas/canvas.worker.js';
import { setupAutomationWorker } from './modules/automation/automation.worker.js';
import { setupNotificationWorker } from './modules/notification/notification.worker.js';
import { setupAnalyticsScheduler } from './modules/analytics/analytics.scheduler.js';
import { setupBroadcastScheduler } from './modules/marketing/broadcast.scheduler.js';
import { setupCsatScheduler } from './modules/csat/csat.scheduler.js';
import { setupInactivityCloseWorker } from './modules/conversation/inactivity-close.worker.js';
import { registerChannelPlugin, linePlugin, fbPlugin, webchatPlugin, threadsPlugin } from '@open333crm/channel-plugins';

export async function bootstrap() {
  const config = loadEnvConfig();

  // RBAC: 啟動即驗證權限 registry 完整性（重複/懸空/成環/feature 缺失），有錯即拒絕啟動
  const registryErrors = validatePermissionRegistry();
  if (registryErrors.length) {
    throw new Error(`權限 registry 驗證失敗：\n  - ${registryErrors.join('\n  - ')}`);
  }

  const app = Fastify({
    // 30MB top-level body limit. Must be ≥ multipart fileSize so the
    // request isn't rejected before @fastify/multipart can stream-parse it.
    bodyLimit: 30 * 1024 * 1024,
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

  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(corsPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(prismaPlugin);
  await app.register(cookiePlugin);
  await app.register(authPlugin);
  await app.register(socketPlugin);
  await app.register(chatboxPlugin);

  registerChannelPlugin(linePlugin);
  registerChannelPlugin(fbPlugin);
  registerChannelPlugin(webchatPlugin);
  registerChannelPlugin(threadsPlugin);

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.0.1',
  }));

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(conversationRoutes, { prefix: '/api/v1/conversations' });
  await app.register(contactRoutes, { prefix: '/api/v1/contacts' });
  await app.register(caseRoutes, { prefix: '/api/v1/cases' });
  await app.register(tagRoutes, { prefix: '/api/v1/tags' });
  await app.register(agentRoutes, { prefix: '/api/v1/agents' });
  await app.register(roleRoutes, { prefix: '/api/v1/roles' });
  await app.register(simulatorRoutes, { prefix: '/api/v1/simulator' });
  await app.register(automationRoutes, { prefix: '/api/v1/automation' });
  await app.register(channelRoutes, { prefix: '/api/v1/channels' });
  await app.register(webhookRoutes, { prefix: '/api/v1/webhooks' });
  await app.register(knowledgeRoutes, { prefix: '/api/v1/knowledge' });
  await app.register(marketingRoutes, { prefix: '/api/v1/marketing' });
  await app.register(materialRoutes, { prefix: '/api/v1/marketing' });
  await app.register(aiRoutes, { prefix: '/api/v1/ai' });
  await app.register(slaRoutes, { prefix: '/api/v1/sla-policies' });
  await app.register(lineLoginRoutes, { prefix: '/api/v1/auth/line' });
  await app.register(lineProfileRoutes, { prefix: '/api/v1' });
  await app.register(richMenuRoutes, { prefix: '/api/v1/line/rich-menus' });
  await app.register(quickReplyPresetRoutes, { prefix: '/api/v1/line/quick-reply-presets' });
  await app.register(fbLoginRoutes, { prefix: '/api/v1/auth/fb' });
  await app.register(notificationRoutes, { prefix: '/api/v1/notifications' });
  await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });
  await app.register(settingsRoutes, { prefix: '/api/v1/settings' });
  await app.register(storageRoutes, { prefix: '/api/v1/files' });
  await app.register(webhookSubscriptionRoutes, { prefix: '/api/v1/webhook-subscriptions' });
  await app.register(portalRoutes, { prefix: '/api/v1/portal' });
  await app.register(portalPublicRoutes, { prefix: '/api/v1/fan' });
  await app.register(shortlinkRoutes, { prefix: '/api/v1/shortlinks' });
  await app.register(shortlinkRedirectRoutes, { prefix: '/s' });
  await app.register(canvasRoutes, { prefix: '/api/v1/canvas' });
  await app.register(identityRoutes, { prefix: '/api/v1/identity' });
  await app.register(webchatRoutes, { prefix: '/api/v1/webchat' });
  await app.register(chatboxRoutes, { prefix: '/api/v1/chatbox' });
  await app.register(cliRoutes, { prefix: '/api/v1/cli' });
  await app.register(mcpRoutes);

  registerVisitorNamespace(app.io, app.prisma, app.chatboxSessionVerifier);

  setupAutomationWorker(app.prisma, app.io);
  setupNotificationWorker(app.prisma);
  setupAnalyticsScheduler(app.prisma);
  setupBroadcastScheduler(app.prisma, app.io);
  setupCsatScheduler(app.prisma, app.io);
  setupInactivityCloseWorker(app.prisma, app.io);
  setupCanvasWorker(app.prisma, app.io);
  setupCanvasScheduler(app.prisma);
  ensureBucket().catch((err) => app.log.warn({ err }, 'MinIO bucket init skipped'));
  setupWebhookDispatcher(app.prisma);

  // RBAC: 路由都註冊完後，驗證所有 requirePermission(code) 的 code 都存在於 registry
  const routeErrors = validateRouteCodes(usedPermissionCodes);
  if (routeErrors.length) {
    throw new Error(`路由權限碼驗證失敗：\n  - ${routeErrors.join('\n  - ')}`);
  }

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      await app.close();
      process.exit(0);
    });
  }

  try {
    await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
    app.log.info(`open333CRM API running on port ${config.API_PORT}`);
    app.log.info('WebSocket server attached');
    app.log.info('Registered channel plugins: LINE, FB, WEBCHAT');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  return app;
}

void bootstrap();
