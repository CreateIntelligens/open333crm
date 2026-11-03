import type { FastifyInstance } from "fastify";
import { z } from "zod/v3";
import { success } from "../../shared/utils/response.js";
import { getOfficeHours, updateOfficeHours } from "./office-hours.service.js";
import { writeTenantAudit } from "../tenant-audit/tenant-audit.service.js";

const dayScheduleSchema = z
  .object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  })
  .nullable();

const officeHoursSchema = z.object({
  timezone: z.string().default("Asia/Taipei"),
  officeHours: z.object({
    enabled: z.boolean(),
    schedule: z.object({
      mon: dayScheduleSchema.optional(),
      tue: dayScheduleSchema.optional(),
      wed: dayScheduleSchema.optional(),
      thu: dayScheduleSchema.optional(),
      fri: dayScheduleSchema.optional(),
      sat: dayScheduleSchema.optional(),
      sun: dayScheduleSchema.optional(),
    }),
    holidays: z.array(z.string()).default([]),
    outsideHoursMessage: z
      .string()
      .default("您好！目前為非營業時間，我們將在營業時間內盡速回覆您。"),
  }),
});

/** 營業時間。由 settings.routes.ts 註冊，沿用該檔的登入檢查與 settings.manage */
export default async function officeHoursRoutes(fastify: FastifyInstance) {
  // GET /api/v1/settings/office-hours
  fastify.get("/office-hours", async (request, reply) => {
    const result = await getOfficeHours(request.tenantPrisma, request.agent.tenantId);
    return reply.send(success(result));
  });

  // PUT /api/v1/settings/office-hours
  fastify.put("/office-hours", async (request, reply) => {
    const data = officeHoursSchema.parse(request.body);
    const result = await updateOfficeHours(
      request.tenantPrisma,
      request.agent.tenantId,
      data.timezone,
      data.officeHours as any,
    );
    // 稽核：變更系統設定（只記變更的設定區塊，不放敏感值）
    await writeTenantAudit(request.tenantPrisma, {
      tenantId: request.agent.tenantId,
      actorId: request.agent.id,
      action: "settings.update",
      targetType: "settings",
      payload: { section: "office-hours" },
      ip: request.ip,
    });
    return reply.send(success(result));
  });
}
