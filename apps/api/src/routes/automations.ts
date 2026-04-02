import { FastifyInstance } from "fastify";
import { prisma } from "@open333crm/database";
import { dispatcher } from "@open333crm/automation";

export default async function automationRoutes(app: FastifyInstance) {
  // ── Rule CRUD ──────────────────────────────────────────────────

  // List rules
  app.get("/rules", async (request) => {
    const tenantId = (request.user as any)?.tenantId || "default-tenant";

    const rules = await prisma.automationRule.findMany({
      where: { tenantId },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    });

    return { rules };
  });

  // Get single rule
  app.get("/rules/:id", async (request) => {
    const tenantId = (request.user as any)?.tenantId || "default-tenant";
    const { id } = request.params as { id: string };

    const rule = await prisma.automationRule.findFirst({
      where: { id, tenantId },
    });

    if (!rule) {
      return { error: "Rule not found" };
    }

    return { rule };
  });

  // Create rule
  app.post("/rules", async (request, reply) => {
    const tenantId = (request.user as any)?.tenantId || "default-tenant";
    const data = request.body as any;
    const trigger = data.eventType ? { type: data.eventType } : (data.trigger ?? {});
    const conditions = data.conditionsJson ?? data.conditions ?? {};
    const actions = data.actionsJson ?? data.actions ?? [];
    const isActive = data.enabled ?? data.isActive ?? true;
    const stopOnMatch = data.stopProcessing ?? data.stopOnMatch ?? false;

    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: data.name,
        description: data.description ?? null,
        enabled: isActive,
        isActive,
        eventType: String(trigger.type ?? ''),
        scopeType: "TENANT",
        trigger,
        priority: data.priority ?? 0,
        stopProcessing: stopOnMatch,
        stopOnMatch,
        conditions,
        actions,
      },
    });

    return reply.status(201).send(rule);
  });

  // Update rule
  app.put("/rules/:id", async (request) => {
    const tenantId = (request.user as any)?.tenantId || "default-tenant";
    const { id } = request.params as { id: string };
    const data = request.body as any;

    const existing = await prisma.automationRule.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      return { error: "Rule not found" };
    }

    const rule = await prisma.automationRule.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
        ...(data.enabled !== undefined && { enabled: data.enabled, isActive: data.enabled }),
        ...(data.isActive !== undefined && { enabled: data.isActive, isActive: data.isActive }),
        ...(data.eventType !== undefined && { eventType: data.eventType, trigger: { type: data.eventType } }),
        ...(data.trigger !== undefined && { eventType: String(data.trigger.type ?? ''), trigger: data.trigger }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.stopProcessing !== undefined && {
          stopProcessing: data.stopProcessing,
          stopOnMatch: data.stopProcessing,
        }),
        ...(data.stopOnMatch !== undefined && {
          stopProcessing: data.stopOnMatch,
          stopOnMatch: data.stopOnMatch,
        }),
        ...(data.conditionsJson !== undefined && {
          conditions: data.conditionsJson,
        }),
        ...(data.conditions !== undefined && {
          conditions: data.conditions,
        }),
        ...(data.actionsJson !== undefined && {
          actions: data.actionsJson,
        }),
        ...(data.actions !== undefined && {
          actions: data.actions,
        }),
      },
    });

    return { rule };
  });

  // Delete rule
  app.delete("/rules/:id", async (request, reply) => {
    const tenantId = (request.user as any)?.tenantId || "default-tenant";
    const { id } = request.params as { id: string };

    const existing = await prisma.automationRule.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      return reply.status(404).send({ error: "Rule not found" });
    }

    await prisma.automationRule.delete({ where: { id } });
    return reply.status(204).send();
  });

  // Toggle enabled
  app.patch("/rules/:id/toggle", async (request) => {
    const tenantId = (request.user as any)?.tenantId || "default-tenant";
    const { id } = request.params as { id: string };
    const body = request.body as { enabled?: boolean; isActive?: boolean };
    const isActive = body.enabled ?? body.isActive;

    const existing = await prisma.automationRule.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      return { error: "Rule not found" };
    }

    const rule = await prisma.automationRule.update({
      where: { id },
      data: { isActive },
    });

    return { rule };
  });

  // ── Manual Dispatch ────────────────────────────────────────────

  // Test-run all rules for a given event type
  app.post("/dispatch", async (request) => {
    const tenantId = (request.user as any)?.tenantId || "default-tenant";
    const data = request.body as { eventType: string; fact: any };

    const result = await dispatcher.dispatchManual(
      data.eventType,
      data.fact,
      tenantId,
    );

    return { result };
  });

  // ── Executions ─────────────────────────────────────────────────

  // List executions
  app.get("/executions", async (request) => {
    const tenantId = (request.user as any)?.tenantId || "default-tenant";
    const query = request.query as any;

    const where: Record<string, unknown> = { tenantId };
    if (query.eventType) where.eventType = query.eventType;
    if (query.status) where.status = query.status;

    const [executions, total] = await Promise.all([
      prisma.automationExecution.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: parseInt(query.limit) || 50,
        skip: parseInt(query.offset) || 0,
        include: {
          actionResults: true,
        },
      }),
      prisma.automationExecution.count({ where }),
    ]);

    return { executions, total };
  });

  // Get execution detail
  app.get("/executions/:id", async (request) => {
    const { id } = request.params as { id: string };

    const execution = await prisma.automationExecution.findUnique({
      where: { id },
      include: {
        actionResults: true,
      },
    });

    if (!execution) {
      return { error: "Execution not found" };
    }

    return { execution };
  });

  // ── Rollback ───────────────────────────────────────────────────

  // Rollback an execution
  app.post("/executions/:id/rollback", async (request) => {
    const tenantId = (request.user as any)?.tenantId || "default-tenant";
    const { id } = request.params as { id: string };

    const execution = await prisma.automationExecution.findFirst({
      where: { id, tenantId },
      include: { actionResults: true },
    });

    if (!execution) {
      return { error: "Execution not found" };
    }

    const rollbackable = execution.actionResults.filter(
      (r: any) => r.rollbackable && r.status === "SUCCESS",
    );

    const rolledBack: string[] = [];

    for (const action of rollbackable) {
      try {
        await prisma.automationActionResult.update({
          where: { id: action.id },
          data: {
            status: "ROLLED_BACK",
            rolledBackAt: new Date(),
          },
        });
        rolledBack.push(action.id);
      } catch (_e) {
        // Continue with other actions
      }
    }

    return {
      executionId: id,
      rolledBack,
      total: rollbackable.length,
    };
  });

  // ── Logs (backward compat) ────────────────────────────────────

  app.get("/logs", async (request) => {
    const query = request.query as any;

    const logs = await prisma.automationLog.findMany({
      take: parseInt(query.limit) || 50,
      orderBy: { createdAt: "desc" },
      include: {
        rule: {
          select: { name: true },
        },
      },
    });

    return { logs };
  });
}
