import type { FastifyInstance } from "fastify";
import { success } from "../../shared/utils/response.js";
import { actorOf } from "../../lib/request-actor.js";
import { getOfficeHoursFlow, updateOfficeHoursFlow } from "./office-hours.flow.js";
import { officeHoursSettingsSchema } from "./office-hours-settings.js";

/** 營業時間。由 settings.routes.ts 註冊，沿用該檔的登入檢查與 settings.manage */
export default async function officeHoursRoutes(fastify: FastifyInstance) {
  // GET /api/v1/settings/office-hours
  fastify.get("/office-hours", async (request, reply) => {
    const result = await getOfficeHoursFlow(fastify, actorOf(request).tenantId);
    return reply.send(success(result));
  });

  // PUT /api/v1/settings/office-hours
  fastify.put("/office-hours", async (request, reply) => {
    const data = officeHoursSettingsSchema.parse(request.body);
    const result = await updateOfficeHoursFlow(fastify, actorOf(request), data.timezone, data.officeHours);
    return reply.send(success(result));
  });
}
