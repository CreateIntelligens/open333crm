import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import rateLimit from "@fastify/rate-limit";
import caching from "@fastify/caching";
import { env } from "./config/env.js";
import { licenseService } from "./services/license.js";
import authRoutes from "./routes/authRoutes.js";
import { connectPostgres, disconnectPostgres } from "./lib/prisma.js";
import {
  cachePluginOptions,
  connectCacheStore,
  disconnectCacheStore,
} from "./lib/cacheStore.js";
import {
  startAutomationListener,
  stopAutomationListener,
} from "./services/automation-listener.js";

const app = Fastify({ logger: true });

// ── Initialization ────────────────────────
await licenseService.initialize();

// ── Plugins ───────────────────────────────
app.register(cors, { origin: env.CORS_ORIGIN });
app.register(jwt, { secret: env.JWT_SECRET });
app.register(websocket);
app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
app.register(caching, cachePluginOptions);

// ── Health check ──────────────────────────
app.get("/health", async () => ({ status: "ok", version: "0.4.0" }));

// ── Webhook routes ────────────────────────
import webhookRoutes from "./routes/webhooks.js";

app.register(webhookRoutes, { prefix: "/webhooks" });

// ── API routes ────────────────────────────
import kmRoutes from "./routes/km.js";
import brainRoutes from "./routes/brain.js";
import channelRoutes from "./routes/channels.js";
import reportRoutes from "./routes/reports.js";
import agentRoutes from "./routes/agents.js";

app.register(kmRoutes, { prefix: "/api/v1/km" });
app.register(brainRoutes, { prefix: "/api/v1/brain" });
app.register(channelRoutes, { prefix: "/api/v1/channels" });
app.register(reportRoutes, { prefix: "/api/v1/reports" });
app.register(agentRoutes, { prefix: "/api/v1/agents" });

import contactRoutes from "./routes/contacts.js";
import caseRoutes from "./routes/cases.js";
import automationRoutes from "./routes/automations.js";

app.register(contactRoutes, { prefix: "/api/v1/contacts" });
app.register(caseRoutes, { prefix: "/api/v1/cases" });
app.register(automationRoutes, { prefix: "/api/v1/automations" });

app.addHook("onClose", async () => {
  stopAutomationListener();
  await disconnectPostgres();
  await disconnectCacheStore();
});

const start = async () => {
  await connectPostgres();
  await connectCacheStore();
  startAutomationListener();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`API Server running on port ${env.PORT}`);
};

start().catch((error) => {
  app.log.error(error, "Failed to start API server");
  process.exit(1);
});
