/**
 * Tracking script snippet generators for external analytics services.
 * Returns HTML string fragments to inject into redirect micro-pages.
 *
 * The IDs come from tenant settings. The settings route validates their format
 * (settings.routes.ts), but these builders also escape every value they inline:
 * a value that reaches the DB another way must not break out of the <script>
 * tag or the JS string and run as code (stored XSS). `escapeHtmlAttr` covers the
 * attribute context, `jsonForScript` the inline-script context.
 */
import { escapeHtmlAttr, jsonForScript } from "./render-utils.js";

/**
 * Build Google Analytics 4 gtag.js snippet.
 * Returns empty string if gaId is null/empty.
 */
export function buildGa4Snippet(gaId: string | null | undefined): string {
  if (!gaId) return "";
  const id = gaId.trim();
  if (!id) return "";

  return `<script async src="${escapeHtmlAttr(`https://www.googletagmanager.com/gtag/js?id=${id}`)}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', ${jsonForScript(id)});
</script>`;
}

/**
 * Build Meta (Facebook) Pixel base code snippet.
 * Returns empty string if metaPixelId is null/empty.
 */
export function buildMetaPixelSnippet(
  metaPixelId: string | null | undefined,
): string {
  if (!metaPixelId) return "";
  const id = metaPixelId.trim();
  if (!id) return "";

  return `<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', ${jsonForScript(id)});
fbq('track', 'PageView');
</script>`;
}

/**
 * Build combined tracking snippets for a tenant.
 * Returns empty string if no tracking is configured.
 */
export function buildTrackingSnippets(
  gaId: string | null | undefined,
  metaPixelId: string | null | undefined,
): string {
  const ga = buildGa4Snippet(gaId);
  const meta = buildMetaPixelSnippet(metaPixelId);
  if (!ga && !meta) return "";
  return `${ga}\n${meta}`;
}
