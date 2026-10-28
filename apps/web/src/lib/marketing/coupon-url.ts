/**
 * 顧客專屬券連結佔位字 {{coupon.url}}（change improve-coupon-url-insert-ux design D1）。
 *
 * 只有附券廣播會發券並換成每位收件人自己的票券連結；一般廣播會送出原字，
 * 關鍵字回覆與自動化規則會把它拿掉，顧客都拿不到券。判斷規則與後端 bodyHasCouponUrl() 相同。
 */

export const COUPON_URL_PLACEHOLDER = '{{coupon.url}}';

/** 預覽與提醒中對這個佔位字的稱呼 */
export const COUPON_URL_LABEL = '顧客專屬券連結';

/** 素材 body 的任何字串欄位含 {{coupon.url}} 時為 true */
export function bodyHasCouponUrl(body: unknown): boolean {
  if (typeof body === 'string') return body.includes(COUPON_URL_PLACEHOLDER);
  if (Array.isArray(body)) return body.some(bodyHasCouponUrl);
  if (body !== null && typeof body === 'object') return Object.values(body).some(bodyHasCouponUrl);
  return false;
}

/** 把文字切成一般文字與佔位字兩種片段，預覽用來把佔位字畫成標籤 */
export function splitCouponUrl(text: string): Array<{ kind: 'text' | 'coupon-url'; value: string }> {
  const parts: Array<{ kind: 'text' | 'coupon-url'; value: string }> = [];
  let rest = text;
  let at = rest.indexOf(COUPON_URL_PLACEHOLDER);
  while (at !== -1) {
    if (at > 0) parts.push({ kind: 'text', value: rest.slice(0, at) });
    parts.push({ kind: 'coupon-url', value: COUPON_URL_PLACEHOLDER });
    rest = rest.slice(at + COUPON_URL_PLACEHOLDER.length);
    at = rest.indexOf(COUPON_URL_PLACEHOLDER);
  }
  if (rest) parts.push({ kind: 'text', value: rest });
  return parts;
}

/** 關鍵字回覆與自動化規則選到含佔位字的素材時的提醒（與後端訊息同義） */
export const COUPON_URL_IN_RULE_MESSAGE =
  '這個素材有顧客專屬券連結，但關鍵字回覆不會發券，顧客收到的訊息裡不會有券連結。'
  + '請改選沒有顧客專屬券連結的素材；要發券請用下方「同時發送優惠券」，或在素材放領券連結。';

/** 自動化規則編輯器的提醒（沒有「同時發送優惠券」欄位） */
export const COUPON_URL_IN_AUTOMATION_MESSAGE =
  '這個素材有顧客專屬券連結，但自動化規則不會發券，顧客收到的訊息裡不會有券連結。'
  + '請改選沒有顧客專屬券連結的素材，或在素材放領券連結；存檔時會被擋下。';

/** 建立廣播選了含佔位字的素材、沒附券時的提醒 */
export const COUPON_URL_NEEDS_COUPON_MESSAGE =
  '這個素材有顧客專屬券連結，請在「附上優惠券」選一張券，否則顧客會看到 {{coupon.url}}';
