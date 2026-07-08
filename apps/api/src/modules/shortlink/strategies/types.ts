/**
 * Redirect strategy contract. Each strategy takes a prepared RenderContext
 * (the route resolves everything up-front so strategies stay pure: context in,
 * HTTP response out) and returns an HTTP 200 HTML response. No strategy writes
 * to the DB — the only place a click is recorded is `POST /s/track`.
 */

export interface ShortLinkView {
  slug: string;
  title?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImage?: string | null;
  lineChannelId?: string | null;
}

export interface RenderContext {
  /** The short link record (subset needed for rendering). */
  link: ShortLinkView;
  /** Fully-resolved destination URL including UTM params. */
  targetUrl: string;
  /** Contact id carried from the inbound URL (`?cid=`), if any. */
  cid?: string;
  /** LIFF app id resolved from the bound LINE channel settings (LINE only). */
  liffId?: string | null;
  /** Path the client beacon/fetch posts the click to. */
  trackPath: string;
  /** Tenant GA4 Measurement ID (null = not configured). */
  gaId?: string | null;
  /** Tenant Meta Pixel ID (null = not configured). */
  metaPixelId?: string | null;
}

export interface RenderResult {
  status: number;
  html: string;
  headers?: Record<string, string>;
}

export interface RedirectStrategy {
  render(ctx: RenderContext): RenderResult;
}
