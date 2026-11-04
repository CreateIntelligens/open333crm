import type { FastifyInstance } from "fastify";
import { z } from "zod/v3";
import { success } from "../../shared/utils/response.js";
import { actorOf } from "../../lib/request-actor.js";
import { getTrackingSettingsFlow, updateTrackingSettingsFlow } from "./tracking-settings.flow.js";
import { GA4_ID_PATTERN, META_PIXEL_ID_PATTERN } from "../shortlink/strategies/tracking-snippet.js";

/** 追蹤設定（GA4／Meta Pixel）。由 settings.routes.ts 註冊，沿用該檔的登入檢查與 settings.manage */
export default async function trackingSettingsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/settings/tracking
  fastify.get("/tracking", async (request, reply) => {
    return reply.send(success(await getTrackingSettingsFlow(fastify, actorOf(request).tenantId)));
  });

  // PUT /api/v1/settings/tracking
  fastify.put("/tracking", async (request, reply) => {
    const data = trackingSettingsSchema.parse(request.body);
    const settings = await updateTrackingSettingsFlow(fastify, actorOf(request), {
      gaId: data.gaId ?? null,
      metaPixelId: data.metaPixelId ?? null,
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
