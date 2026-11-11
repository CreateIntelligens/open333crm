/**
 * Public short link routes (no auth). Prefix: /s
 *
 * GET  /s/:slug  — UA-based strategy dispatch. Returns HTTP 200 HTML (bot OG
 *                  preview / human zero-click page / LINE→LIFF redirect).
 *                  Records NOTHING.
 * POST /s/track  — the single authoritative click counter. Fired by the page's
 *                  sendBeacon (external browser) or the LIFF callback fetch.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod/v3";
import { logger } from "@open333crm/core";
import { detectSource, parseSourceOverride } from "./source-detector.js";
import { getLinkForRedirect, getChannelLiffId } from "./shortlink.service.js";
import { trackClickFlow } from "./shortlink.flow.js";
import { getStrategy, renderExpiredPage } from "./strategies/index.js";

const TRACK_PATH = "/s/track";

/** `?ua_simulator=` overrides are allowed only outside production (or via opt-in env). */
function uaSimulatorEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.SHORTLINK_UA_SIMULATOR === "1"
  );
}

// 公開端點，任何人都能送任意 body（#387）。外部瀏覽器頁送 cid: null，LIFF 頁省略 cid，所以允許 null。
// slug 上限與後台自訂代碼相同；LINE uid 是 33 字元，cid 是 UUID，上限 64 已足夠。
const trackBodySchema = z.object({
  slug: z.string().max(64).optional(),
  cid: z.string().max(64).nullish().transform((v) => v ?? undefined),
  lineUid: z.string().max(64).nullish().transform((v) => v ?? undefined),
});

/** sendBeacon 送 text/plain，fetch 送 JSON；不是 JSON 的字串當成空 body */
function parseTrackBody(body: unknown) {
  let raw: unknown = body;
  if (typeof body === "string") {
    try {
      raw = JSON.parse(body);
    } catch {
      raw = {};
    }
  }
  return trackBodySchema.safeParse(raw && typeof raw === "object" ? raw : {});
}

export default async function shortlinkRedirectRoutes(app: FastifyInstance) {
  // ─── POST /s/track ── the only place a click is recorded ──────────────────
  app.post("/track", async (request, reply) => {
    const parsed = parseTrackBody(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({
          success: false,
          error: { code: "BAD_REQUEST", message: "invalid track body" },
        });
    }
    const { slug, cid, lineUid } = parsed.data;
    if (!slug) {
      return reply
        .status(400)
        .send({
          success: false,
          error: { code: "BAD_REQUEST", message: "slug required" },
        });
    }

    // 公開端點無登入身分、無 tenant context，RLS 會 fail-closed 擋掉查詢，
    // 故以 prismaAdmin（BYPASSRLS）用 slug 找短連結。租戶邊界由 slug 全域唯一保證。
    const resolved = await getLinkForRedirect(app.prismaAdmin, slug);

    if (!resolved) {
      return reply
        .status(410)
        .send({
          success: false,
          error: { code: "GONE", message: "Link not found or expired" },
        });
    }

    // 點擊在背景寫入（交易綁定短連結的租戶），不等待：轉址不因記錄點擊而變慢。
    // 最多一次：寫入失敗只記 log，這次點擊不計入（與搬遷前相同）
    void trackClickFlow(app, resolved.link, {
      contactId: cid,
      lineUid,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
      referer: request.headers.referer,
    }).catch((err) => logger.error("[ShortLink] Click tracking error:", err));

    return reply.send({ success: true, data: { targetUrl: resolved.targetUrl } });
  });

  // ─── GET /s/:slug ── UA strategy dispatch, no tracking ────────────────────
  app.get("/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const { cid, ua_simulator } = request.query as {
      cid?: string;
      ua_simulator?: string;
    };

    // 同 /track：公開端點必須走 prismaAdmin，否則 RLS fail-closed 一律查不到
    const resolved = await getLinkForRedirect(app.prismaAdmin, slug);
    const override = uaSimulatorEnabled()
      ? parseSourceOverride(ua_simulator)
      : null;
    const source = override ?? detectSource(request.headers["user-agent"]);
    // Expose the chosen branch for easy curl/devtools inspection.
    reply.header("X-Shortlink-Source", source);

    // Missing / inactive / expired link.
    if (!resolved) {
      const expired = renderExpiredPage();
      return reply
        .status(expired.status)
        .headers(expired.headers ?? {})
        .send(expired.html);
    }

    const { link, targetUrl } = resolved;

    // LINE webview only: resolve the bound channel's LIFF app id.
    let liffId: string | null = null;
    if (source === "LINE_WEBVIEW" && link.lineChannelId) {
      liffId = await getChannelLiffId(app.prismaAdmin, link.lineChannelId);
    }

    // Fetch tenant tracking settings (GA4, Meta Pixel).
    // tenantId 取自已解析的 link，查詢仍限定單一租戶。
    const tenantSettings = await app.prismaAdmin.tenantSettings.findUnique({
      where: { tenantId: link.tenantId },
      select: { gaId: true, metaPixelId: true },
    });

    const strategy = getStrategy(source);
    const result = strategy.render({
      link,
      targetUrl,
      cid,
      liffId,
      trackPath: TRACK_PATH,
      gaId: tenantSettings?.gaId ?? null,
      metaPixelId: tenantSettings?.metaPixelId ?? null,
    });

    return reply
      .status(result.status)
      .headers(result.headers ?? {})
      .send(result.html);
  });
}
