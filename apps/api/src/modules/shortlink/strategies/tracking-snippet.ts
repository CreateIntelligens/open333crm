/**
 * Tracking script snippet generators for external analytics services.
 * Returns HTML string fragments to inject into redirect micro-pages.
 *
 * 安全：ID 會被拼進公開中轉頁的 <script>。設定 API 已驗證格式（settings.routes.ts
 * trackingSettingsSchema），這裡再驗一次——驗證上線前就存進資料庫的值不可輸出（G06）。
 */

/** GA4 評估 ID：G- 加大寫英數字。gtag.js 只把大寫 G- 當 GA4 ID，小寫載入的是空設定、不會追蹤 */
export const GA4_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;
/** Meta Pixel ID：純數字 */
export const META_PIXEL_ID_PATTERN = /^\d{5,20}$/;

/**
 * 跳脫後才放進 JS 字串與 HTML 屬性。格式驗證過的 ID 不會含這些字元，
 * 這層是驗證規則日後被放寬時的第二道防線。
 */
function escapeForScript(value: string): string {
  return value.replace(/[^A-Za-z0-9-]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** 取出合格的 ID；空值或格式不符回 null */
function validId(raw: string | null | undefined, pattern: RegExp): string | null {
  if (!raw) return null;
  const id = raw.trim();
  if (!id || !pattern.test(id)) return null;
  return escapeForScript(id);
}

/**
 * Build Google Analytics 4 gtag.js snippet.
 * Returns empty string if gaId is null/empty/invalid.
 */
export function buildGa4Snippet(gaId: string | null | undefined): string {
  const id = validId(gaId, GA4_ID_PATTERN);
  if (!id) return "";

  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${id}');
</script>`;
}

/**
 * Build Meta (Facebook) Pixel base code snippet.
 * Returns empty string if metaPixelId is null/empty/invalid.
 */
export function buildMetaPixelSnippet(
  metaPixelId: string | null | undefined,
): string {
  const id = validId(metaPixelId, META_PIXEL_ID_PATTERN);
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
fbq('init', '${id}');
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
