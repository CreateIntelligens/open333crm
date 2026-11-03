import type { FastifyInstance } from "fastify";
import { z } from "zod/v3";
import { success } from "../../shared/utils/response.js";
import { getTrackingSettings, updateTrackingSettings } from "./tracking-settings.service.js";
import { GA4_ID_PATTERN, META_PIXEL_ID_PATTERN } from "../shortlink/strategies/tracking-snippet.js";
import { writeTenantAudit } from "../tenant-audit/tenant-audit.service.js";

/** 追蹤設定（GA4／Meta Pixel）。由 settings.routes.ts 註冊，沿用該檔的登入檢查與 settings.manage */
export default async function trackingSettingsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/settings/tracking
  fastify.get("/tracking", async (request, reply) => {
    return reply.send(success(await getTrackingSettings(request.tenantPrisma, request.agent.tenantId)));
  });

  // PUT /api/v1/settings/tracking
  fastify.put("/tracking", async (request, reply) => {
    const data = trackingSettingsSchema.parse(request.body);
    const tenantId = request.agent.tenantId;
    const settings = await updateTrackingSettings(request.tenantPrisma, tenantId, {
      gaId: data.gaId ?? null,
      metaPixelId: data.metaPixelId ?? null,
    });
    // 稽核：變更追蹤設定（只記有無設定 GA/Pixel，不放 ID 值）
    await writeTenantAudit(request.tenantPrisma, {
      tenantId,
      actorId: request.agent.id,
      action: "settings.update",
      targetType: "settings",
      payload: {
        section: "tracking",
        gaIdSet: Boolean(data.gaId),
        metaPixelIdSet: Boolean(data.metaPixelId),
      },
      ip: request.ip,
    });
    return reply.send(success(settings));
  });
}

/**
 * 追蹤 ID 會被拼進短連結公開中轉頁的 <script>：只收固定格式，否則是儲存型 XSS（G06）。
 * 空字串視為清除（null）。
 */
const trackingIdSchema = (pattern: RegExp, message: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || pattern.test(v), { message })
    .nullable()
    .optional();

export const trackingSettingsSchema = z.object({
  gaId: trackingIdSchema(GA4_ID_PATTERN, "GA4 ID 格式不正確，應為 G- 開頭加大寫英文字母或數字，例如 G-ABC123XYZ9"),
  metaPixelId: trackingIdSchema(META_PIXEL_ID_PATTERN, "Meta Pixel ID 格式不正確，應為 5～20 位數字"),
});
