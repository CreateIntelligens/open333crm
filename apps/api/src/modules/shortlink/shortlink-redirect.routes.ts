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
import { detectSource, parseSourceOverride } from "./source-detector.js";
import {
  getLinkForRedirect,
  getChannelLiffId,
  trackClick,
} from "./shortlink.service.js";
import { getStrategy, renderExpiredPage } from "./strategies/index.js";

const TRACK_PATH = "/s/track";

/** `?ua_simulator=` overrides are allowed only outside production (or via opt-in env). */
function uaSimulatorEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.SHORTLINK_UA_SIMULATOR === "1"
  );
}

interface TrackBody {
  slug?: string;
  cid?: string;
  lineUid?: string;
}

function parseTrackBody(body: unknown): TrackBody {
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as TrackBody;
    } catch {
      return {};
    }
  }
  if (body && typeof body === "object") return body as TrackBody;
  return {};
}

export default async function shortlinkRedirectRoutes(app: FastifyInstance) {
  // ─── POST /s/track ── the only place a click is recorded ──────────────────
  app.post("/track", async (request, reply) => {
    const { slug, cid, lineUid } = parseTrackBody(request.body);
    if (!slug) {
      return reply
        .status(400)
        .send({
          success: false,
          error: { code: "BAD_REQUEST", message: "slug required" },
        });
    }

    const targetUrl = await trackClick(
      app.prisma,
      slug,
      {
        contactId: cid,
        lineUid,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        referer: request.headers.referer,
      },
      app.io,
    );

    if (!targetUrl) {
      return reply
        .status(410)
        .send({
          success: false,
          error: { code: "GONE", message: "Link not found or expired" },
        });
    }

    return reply.send({ success: true, data: { targetUrl } });
  });

  // ─── GET /s/:slug ── UA strategy dispatch, no tracking ────────────────────
  app.get("/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const { cid, ua_simulator } = request.query as {
      cid?: string;
      ua_simulator?: string;
    };

    const resolved = await getLinkForRedirect(app.prisma, slug);
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
      liffId = await getChannelLiffId(app.prisma, link.lineChannelId);
    }

    // Fetch tenant tracking settings (GA4, Meta Pixel).
    const tenantSettings = await app.prisma.tenantSettings.findUnique({
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
