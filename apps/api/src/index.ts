import { fileURLToPath } from 'node:url';
import { TRUSTED_PROXIES } from './lib/trust-proxy.js';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';

// Load env BEFORE any module that captures process.env at import time
// (e.g. BullMQ Queue constructed with `connection: { url: process.env.REDIS_URL }`).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '..', '..', '..', '.env') });

import Fastify from 'fastify';
import multipart from '@fastify/multipart';

import {
  EVENT_AUTOMATION_QUEUE,
  EVENT_NOTIFICATION_QUEUE,
  EVENT_WEBHOOK_QUEUE,
  USAGE_ALERT_EMAIL_QUEUE,
  WEBHOOK_DELIVERY_QUEUE,
  closeOutboxQueues,
  validatePermissionRegistry,
  validateRouteCodes,
} from '@open333crm/core';
import { usedPermissionCodes } from './guards/rbac.guard.js';
import { loadEnvConfig } from './config/env.js';
import { installZodChineseLocale } from './config/zod-locale.js';
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
import tenantAuditRoutes from './modules/tenant-audit/tenant-audit.routes.js';
import dataExportRoutes from './modules/data-export/data-export.routes.js';
import dataErasureRoutes from './modules/data-erasure/data-erasure.routes.js';
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
import lineProfileRoutes from './modules/line/line-profile.routes.js';
import richMenuRoutes from './modules/line/rich-menu.routes.js';
import quickReplyPresetRoutes from './modules/line/quick-reply-preset.routes.js';
import metaConnectRoutes from './modules/meta-connect/meta-connect.routes.js';
import notificationRoutes from './modules/notification/notification.routes.js';
import analyticsRoutes from './modules/analytics/analytics.routes.js';
import settingsRoutes from './modules/settings/settings.routes.js';
import webtalkRoutes from './modules/webtalk/webtalk.routes.js';
import storageRoutes from './modules/storage/storage.routes.js';
import lineImagemapRoutes from './modules/storage/line-imagemap.routes.js';
import { ensureBucket } from './modules/storage/storage.service.js';
import webhookSubscriptionRoutes from './modules/webhook-subscriptions/webhook-subscription.routes.js';
import { processWebhookDelivery, setupWebhookDispatcher, webhookRetryDelay } from './modules/webhook-subscriptions/webhook-dispatcher.js';
import { startA2ABridgeWorker } from './modules/settings/a2a-bridge.worker.js';
import portalRoutes from './modules/portal/portal.routes.js';
import memberBindingRoutes from './modules/member-binding/member-binding.routes.js';
import memberBindingFanRoutes from './modules/member-binding/member-binding-fan.routes.js';
import couponFanRoutes from './modules/coupon/coupon-fan.routes.js';
import portalPublicRoutes from './modules/portal/portal-public.routes.js';
import emailRegistrationRoutes from './modules/identity-binding/email-registration.routes.js';
import phoneRegistrationRoutes from './modules/identity-binding/phone-registration.routes.js';
import couponRoutes from './modules/coupon/coupon.routes.js';
import couponInstanceRoutes from './modules/coupon/coupon-instance.routes.js';
import couponInboxRoutes from './modules/coupon/coupon-inbox.routes.js';
import couponClaimLinkRoutes from './modules/coupon/coupon-claim-link.routes.js';
import couponClaimPublicRoutes from './modules/coupon/coupon-claim-public.routes.js';
import { setupCouponScheduler } from './modules/coupon/coupon.scheduler.js';
import storeRoutes from './modules/store/store.routes.js';
import storeConsoleRoutes from './modules/store/store-console.routes.js';
import shortlinkRoutes from './modules/shortlink/shortlink.routes.js';
import shortlinkRedirectRoutes from './modules/shortlink/shortlink-redirect.routes.js';
import webchatRoutes from './modules/webchat/webchat.routes.js';
import platformRoutes from './modules/platform/platform.routes.js';
import queueMonitoringRoutes from './modules/queue-monitoring/queue-monitoring.routes.js';
import { ALERTED_QUEUES, createMonitoredQueues } from './modules/queue-monitoring/monitored-queues.js';
import { startFailedAlerts } from './modules/queue-monitoring/failed-alerts.js';
import { QueueEvents } from 'bullmq';
import trialRoutes from './modules/trial/trial.routes.js';
import planChangeRoutes from './modules/platform/plan-change.routes.js';
import chatboxRoutes from './modules/chatbox/chatbox.routes.js';
import cliRoutes from './modules/cli/cli.routes.js';
import mcpRoutes from './modules/mcp/mcp.routes.js';
import { registerVisitorNamespace } from './modules/webchat/webchat.socket.js';
import canvasRoutes, { identityRoutes } from './modules/canvas/canvas.routes.js';
import { createBullJobScheduler } from './lib/job-scheduler.js';
import { setupCanvasScheduler } from './modules/canvas/canvas.scheduler.js';
import { setupTrialScheduler } from './modules/trial/trial.scheduler.js';
import { setupCanvasWorker } from './modules/canvas/canvas.worker.js';
import { setupAutomationWorker } from './modules/automation/automation.worker.js';
import { setupNotificationWorker } from './modules/notification/notification.worker.js';
import { setupOutboxSchedulers } from './modules/outbox/outbox.scheduler.js';
import { bullWorkerFactory, startQueueWorkers, subscriberProcessor, type JobProcessor } from './events/subscriber-workers.js';
import { processUsageAlertEmail } from './modules/notification/usage-alert-email.worker.js';
import { closeOpsAlertQueue, OPS_ALERT_QUEUE, sendOpsAlert } from './modules/ops-alert/ops-alert.service.js';
import { createOpsAlertProcessor } from './modules/ops-alert/ops-alert.worker.js';
import { setupAnalyticsScheduler } from './modules/analytics/analytics.scheduler.js';
import { setupBroadcastScheduler } from './modules/marketing/broadcast.scheduler.js';
import { getBindingStore } from './modules/identity-binding/binding-code.js';
import { setupCsatScheduler } from './modules/csat/csat.scheduler.js';
import { setupMetaTokenHealthScheduler } from './modules/channel/meta-token-health.js';
import { redactSensitiveQuery } from './lib/log-redact.js';
import { setupInactivityCloseWorker } from './modules/conversation/inactivity-close.worker.js';
import { registerChannelPlugin, linePlugin, fbPlugin, webchatPlugin, threadsPlugin } from '@open333crm/channel-plugins';
import { preloadUploadContentDetector } from './modules/upload/upload-content-detector.js';

export async function bootstrap() {
  const config = loadEnvConfig();

  // Zod 驗證訊息中文化。須在任何 schema 被使用前設定（errorMap 是全域單例）
  installZodChineseLocale();

  await preloadUploadContentDetector();

  // RBAC: 啟動即驗證權限 registry 完整性（重複/懸空/成環/feature 缺失），有錯即拒絕啟動
  const registryErrors = validatePermissionRegistry();
  if (registryErrors.length) {
    throw new Error(`權限 registry 驗證失敗：\n  - ${registryErrors.join('\n  - ')}`);
  }

  const app = Fastify({
    // API is exposed through the local reverse proxy; use the forwarded client
    // address for per-IP public WebChat limits.
    trustProxy: TRUSTED_PROXIES,
    // 30MB top-level body limit. Must be ≥ multipart fileSize so the
    // request isn't rejected before @fastify/multipart can stream-parse it.
    bodyLimit: 30 * 1024 * 1024,
    logger: {
      level: 'info',
      // 請求 log 會記下完整網址：OAuth 導回的一次性授權碼與 state（Facebook 連結粉專）不可寫進 log
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: redactSensitiveQuery(req.url),
            host: req.host,
            remoteAddress: req.ip,
            remotePort: req.socket?.remotePort,
          };
        },
      },
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
  await app.register(tenantAuditRoutes, { prefix: '/api/v1/tenant/audit-logs' });
  await app.register(dataExportRoutes, { prefix: '/api/v1/tenant/data-export' });
  await app.register(dataErasureRoutes, { prefix: '/api/v1/tenant/data-erasure' });
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
  await app.register(lineProfileRoutes, { prefix: '/api/v1' });
  await app.register(richMenuRoutes, { prefix: '/api/v1/line/rich-menus' });
  await app.register(quickReplyPresetRoutes, { prefix: '/api/v1/line/quick-reply-presets' });
  await app.register(metaConnectRoutes, { prefix: '/api/v1/meta-connect' });
  await app.register(notificationRoutes, { prefix: '/api/v1/notifications' });
  await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });
  await app.register(settingsRoutes, { prefix: '/api/v1/settings' });
  await app.register(webtalkRoutes, { prefix: '/api/v1/webtalk' });
  await app.register(storageRoutes, { prefix: '/api/v1/files' });
  await app.register(webhookSubscriptionRoutes, { prefix: '/api/v1/webhook-subscriptions' });
  await app.register(portalRoutes, { prefix: '/api/v1/portal' });
  await app.register(couponFanRoutes, { prefix: '/api/v1/fan/coupons' });
  await app.register(memberBindingRoutes, { prefix: '/api/v1/member-binding' });
  await app.register(memberBindingFanRoutes, { prefix: '/api/v1/fan/member-binding' });
  await app.register(portalPublicRoutes, { prefix: '/api/v1/fan' });
  await app.register(emailRegistrationRoutes, { prefix: '/api/v1/public/email-registration' });
  await app.register(phoneRegistrationRoutes, { prefix: '/api/v1/public/phone-registration' });
  await app.register(couponRoutes, { prefix: '/api/v1/coupons' });
  await app.register(couponInstanceRoutes, { prefix: '/api/v1/coupons' });
  await app.register(couponInboxRoutes, { prefix: '/api/v1/coupon-issue' });
  await app.register(couponClaimLinkRoutes, { prefix: '/api/v1/coupons' });
  // 公開領券頁（不需登入，design D30）
  await app.register(couponClaimPublicRoutes, { prefix: '/api/v1/coupon-claim' });
  await app.register(storeRoutes, { prefix: '/api/v1/stores' });
  await app.register(storeConsoleRoutes, { prefix: '/api/v1/store-console' });
  await app.register(shortlinkRoutes, { prefix: '/api/v1/shortlinks' });
  await app.register(shortlinkRedirectRoutes, { prefix: '/s' });
  await app.register(lineImagemapRoutes, { prefix: '/line-imagemap' });
  await app.register(canvasRoutes, { prefix: '/api/v1/canvas' });
  await app.register(identityRoutes, { prefix: '/api/v1/identity' });
  await app.register(webchatRoutes, { prefix: '/api/v1/webchat' });
  await app.register(chatboxRoutes, { prefix: '/api/v1/chatbox' });
  await app.register(cliRoutes, { prefix: '/api/v1/cli' });
  await app.register(platformRoutes, { prefix: '/api/v1/platform' });
  // 佇列監控（change queue-monitoring）：監控用的 Queue 物件與 Worker 分開，關機時一起關閉
  const monitoredQueues = createMonitoredQueues(config.REDIS_URL);
  app.addHook('onClose', () => Promise.all(monitoredQueues.map((queue) => queue.close())).then(() => undefined));
  await app.register(queueMonitoringRoutes, {
    prefix: '/api/v1/platform/queues',
    allowedCidrs: config.QUEUE_DASHBOARD_ALLOWED_CIDRS,
    queues: monitoredQueues,
  });
  await app.register(trialRoutes, { prefix: '/api/v1/trial' });
  await app.register(planChangeRoutes, { prefix: '/api/v1/plan-change' });
  await app.register(mcpRoutes);

  // 背景任務（scheduler/worker/visitor namespace）皆跨租戶或以 tenantId 自行 scope，
  // 屬 RLS 白名單基礎設施，用 prismaAdmin（BYPASSRLS）連線，避免 FORCE 後 fail-closed。
  registerVisitorNamespace(app.io, app.prismaAdmin, app.chatboxSessionVerifier);

  // 訂閱者從各自的佇列取得事件（change outbox-event-delivery）；job 失敗時只重試該訂閱者的 job
  const subscriberWorkers = startQueueWorkers(
    {
      [EVENT_NOTIFICATION_QUEUE]: subscriberProcessor(setupNotificationWorker(app.prismaAdmin)),
      [EVENT_AUTOMATION_QUEUE]: subscriberProcessor(setupAutomationWorker(app.prismaAdmin, app.io, app.prisma)),
      [EVENT_WEBHOOK_QUEUE]: subscriberProcessor(setupWebhookDispatcher(app.prismaAdmin)),
      [USAGE_ALERT_EMAIL_QUEUE]: processUsageAlertEmail as JobProcessor,
      [WEBHOOK_DELIVERY_QUEUE]: processWebhookDelivery(app.prismaAdmin) as JobProcessor,
      [OPS_ALERT_QUEUE]: createOpsAlertProcessor(config.OPS_ALERT_SLACK_WEBHOOK_URL) as JobProcessor,
    },
    bullWorkerFactory(config.REDIS_URL, {
      [WEBHOOK_DELIVERY_QUEUE]: { settings: { backoffStrategy: webhookRetryDelay } },
    }),
  );
  app.addHook('onClose', () => subscriberWorkers.close());
  // 任何佇列的 job 移到 failed set 時發出告警（change queue-monitoring，design 決策 8）
  const monitoredQueueByName = new Map(monitoredQueues.map((queue) => [queue.name, queue]));
  const failedAlerts = startFailedAlerts({
    queueNames: ALERTED_QUEUES,
    createQueueEvents: (name) => new QueueEvents(name, { connection: { url: config.REDIS_URL } }),
    getJob: async (queueName, jobId) => monitoredQueueByName.get(queueName)?.getJob(jobId),
    sendAlert: (alert) => sendOpsAlert(alert),
    dashboardUrl: `${config.WEB_BASE_URL}/api/v1/platform/queues`,
  });
  app.addHook('onClose', () => failedAlerts.close());
  app.addHook('onClose', () => closeOpsAlertQueue());
  setupCanvasWorker(app.prismaAdmin, app.io);

  // 定時工作一律經 Job Scheduler：多個實例時每一期只執行一次。註冊不等 Redis 回應，
  // Redis 連不上時 API 照常啟動，排程等 Redis 恢復後才開始
  const jobScheduler = createBullJobScheduler(config.REDIS_URL);
  setupAnalyticsScheduler(jobScheduler, app.prismaAdmin);
  // 附券廣播以 app_tenant 連線逐步發送，票券連結存 Redis（design D29）
  setupBroadcastScheduler(jobScheduler, app.prismaAdmin, app.io, { prisma: app.prisma, store: getBindingStore() });
  setupCsatScheduler(jobScheduler, app.prismaAdmin, app.io);
  setupMetaTokenHealthScheduler(jobScheduler, app.prismaAdmin, app.io);
  setupInactivityCloseWorker(jobScheduler, app.prismaAdmin, app.io);
  setupCanvasScheduler(jobScheduler);
  setupTrialScheduler(jobScheduler, app.prismaAdmin);
  setupCouponScheduler(jobScheduler, { admin: app.prismaAdmin, prisma: app.prisma });
  setupOutboxSchedulers(jobScheduler, app.prismaAdmin);
  jobScheduler.start();
  app.addHook('onClose', () => jobScheduler.close());
  app.addHook('onClose', () => closeOutboxQueues());
  ensureBucket().catch((err) => app.log.warn({ err }, 'MinIO bucket init skipped'));
  startA2ABridgeWorker(app).catch((err) => app.log.warn({ err }, '[A2A] Bridge worker start failed'));

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
