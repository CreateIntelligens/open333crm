/**
 * 發券訊息組裝（worker 側）。
 *
 * 與 apps/api 的 coupon-delivery.service 是同一套文案規則。未抽到 core 的原因：
 * 它依賴 WEB_BASE_URL 環境變數，兩端讀取方式不同（api 走 getConfig，
 * worker 直接讀 process.env）。文案若要改，兩處都要動——已在此註明。
 */

/** FB／IG 沒有可信的平台身分，發出的券一律需要領取憑證（design D10）。 */
export function requiresCouponClaimToken(channelType: string): boolean {
  return channelType.toUpperCase() !== 'LINE';
}

function baseUrl(): string {
  return (process.env.WEB_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export function buildCouponUrl(params: { claimToken: string | null; instanceId: string }): string {
  return params.claimToken
    ? `${baseUrl()}/coupon/claim/${encodeURIComponent(params.claimToken)}`
    : `${baseUrl()}/coupon/${encodeURIComponent(params.instanceId)}`;
}

export function buildCouponMessage(params: {
  couponName: string;
  claimToken: string | null;
  instanceId: string;
}): string {
  const url = buildCouponUrl(params);
  const lines = [
    `為您準備了一張優惠券：${params.couponName}`,
    '',
    params.claimToken ? '點擊以下連結領取：' : '點擊以下連結查看：',
    url,
  ];
  // 憑證即所有權，被轉發即被領走——文案是唯一的使用者側緩解（design D10）
  if (params.claimToken) {
    lines.push('', '※ 此連結專屬於您，請勿轉發給他人。');
  }
  return lines.join('\n');
}
