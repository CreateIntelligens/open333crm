/**
 * FB 版型的內容檢查（change validate-fb-material-content，spec material-system）。
 *
 * 為什麼要有：素材路由的 body 是 z.record(z.unknown())，LINE 版型存檔時會呼叫 LINE validate API，
 * FB 沒有對應的 API，原本完全不檢查——必填欄位空值、javascript: 網址、負數金額都能存
 * （2026-10-13 UAT E2E）。這裡只檢查 FB 外掛（packages/channel-plugins/src/facebook）實際會送出的欄位。
 *
 * 編輯器在 media_type、currency、question_type、expires_in_days 沒有值時顯示預設值（image／TWD／csat／7），
 * FB 外掛也有預設，所以這幾個欄位只在有值時檢查，避免畫面顯示 TWD 卻被說幣別不正確。
 *
 * 網址沿用 LINE 的「先存草稿、發送前換成公開網址」：接受 http(s) 與站內路徑（編輯器預設的示範圖是
 * /material-samples/...），擋下 javascript:、data: 等其他 scheme。
 */
import { AppError } from '../../shared/utils/response.js';

type Issue = { path: string; message: string };
type Body = Record<string, unknown>;

/** 長度上限：Meta Messenger 模板的公開限制，與前端編輯器的 maxLength 一致 */
const LIMIT = { text: 2000, buttonText: 640, title: 80, subtitle: 80, buttonTitle: 20, payload: 1000 };

const isObject = (v: unknown): v is Body => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

class Checker {
  issues: Issue[] = [];

  add(path: string, message: string) {
    this.issues.push({ path: `body.${path}`, message });
  }

  /** 必填文字：去頭尾空白後 1～max 字 */
  required(body: Body, key: string, max: number, path = key, label = key) {
    const v = str(body[key]).trim();
    if (!v) this.add(path, `${label}為必填`);
    else if (v.length > max) this.add(path, `${label}不可超過 ${max} 字`);
  }

  /** 選填文字：有值時不超過 max 字 */
  optional(body: Body, key: string, max: number, path = key, label = key) {
    if (body[key] === undefined || body[key] === null || body[key] === '') return;
    if (typeof body[key] !== 'string') this.add(path, `${label}必須是文字`);
    else if ((body[key] as string).length > max) this.add(path, `${label}不可超過 ${max} 字`);
  }

  /** 網址：http(s) 或站內路徑（/ 開頭、不是 //）；required 時不可空 */
  url(body: Body, key: string, required: boolean, path = key, label = '網址') {
    const v = str(body[key]).trim();
    if (!v) {
      if (required) this.add(path, `${label}為必填`);
      return;
    }
    const ok = /^https?:\/\/[^\s]+$/i.test(v) || (v.startsWith('/') && !v.startsWith('//'));
    if (!ok) this.add(path, `${label}必須是 http:// 或 https:// 開頭的網址`);
  }

  buttons(list: unknown, path: string, min: number, max: number) {
    if (list === undefined || list === null) {
      if (min > 0) this.add(path, `至少需要 ${min} 個按鈕`);
      return;
    }
    if (!Array.isArray(list)) return this.add(path, '按鈕格式不正確');
    if (list.length < min || list.length > max) {
      this.add(path, min === max || min === 0 ? `按鈕最多 ${max} 個` : `按鈕需要 ${min}～${max} 個`);
    }
    list.forEach((b, i) => {
      const p = `${path}.${i}`;
      if (!isObject(b)) return this.add(p, '按鈕格式不正確');
      this.required(b, 'title', LIMIT.buttonTitle, `${p}.title`, '按鈕文字');
      if (b.type === 'web_url') this.url(b, 'url', true, `${p}.url`, '按鈕網址');
      else if (b.type === 'postback') this.required(b, 'payload', LIMIT.payload, `${p}.payload`, '按鈕回傳值');
      else this.add(`${p}.type`, '按鈕類型只能是 web_url 或 postback');
    });
  }
}

/**
 * 檢查 FB 版型內容；不是 fb_* 時不做事。不通過時丟出 400，details.issues 列出所有不合規的欄位。
 */
export function validateFbMaterialBody(contentType: string, body: Body): void {
  if (!contentType.startsWith('fb_')) return;
  const c = new Checker();

  switch (contentType) {
    case 'fb_text':
      c.required(body, 'text', LIMIT.text, 'text', '訊息內容');
      break;
    case 'fb_image':
    case 'fb_video':
      // FB 外掛送出 url ?? mediaUrl
      c.url(body.url ? body : { url: body.mediaUrl }, 'url', true, 'url', contentType === 'fb_image' ? '圖片網址' : '影片網址');
      break;
    case 'fb_generic': {
      const elements = body.elements;
      if (!Array.isArray(elements) || elements.length < 1 || elements.length > 10) {
        c.add('elements', '商品輪播需要 1～10 張卡片');
      }
      (Array.isArray(elements) ? elements : []).forEach((el, i) => {
        const p = `elements.${i}`;
        if (!isObject(el)) return c.add(p, '卡片格式不正確');
        c.required(el, 'title', LIMIT.title, `${p}.title`, '卡片標題');
        c.optional(el, 'subtitle', LIMIT.subtitle, `${p}.subtitle`, '卡片副標題');
        c.url(el, 'image_url', false, `${p}.image_url`, '卡片圖片網址');
        c.buttons(el.buttons, `${p}.buttons`, 0, 3);
      });
      break;
    }
    case 'fb_button':
      c.required(body, 'text', LIMIT.buttonText, 'text', '主要訊息');
      c.buttons(body.buttons, 'buttons', 1, 3);
      break;
    case 'fb_media':
      if (body.media_type !== undefined && body.media_type !== 'image' && body.media_type !== 'video') {
        c.add('media_type', '媒體類型只能是 image 或 video');
      }
      if (!str(body.attachment_id).trim()) c.url(body, 'url', true, 'url', '媒體網址');
      c.buttons(body.buttons, 'buttons', 0, 1);
      break;
    case 'fb_coupon':
      c.required(body, 'title', LIMIT.title, 'title', '優惠券標題');
      c.optional(body, 'subtitle', LIMIT.subtitle, 'subtitle', '優惠券副標題');
      c.url(body, 'image_url', false, 'image_url', '優惠券圖片網址');
      break;
    case 'fb_receipt': {
      c.required(body, 'recipient_name', LIMIT.title, 'recipient_name', '收件人');
      c.required(body, 'order_number', LIMIT.title, 'order_number', '訂單編號');
      if (body.currency !== undefined && !/^[A-Z]{3}$/.test(str(body.currency))) {
        c.add('currency', '幣別必須是三個大寫英文字母（例如 TWD）');
      }
      const total = isObject(body.summary) ? body.summary.total_cost : undefined;
      if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
        c.add('summary.total_cost', '總金額必須是不小於 0 的數字');
      }
      break;
    }
    case 'fb_feedback': {
      c.required(body, 'title', LIMIT.title, 'title', '問卷標題');
      if (body.question_type !== undefined && !['csat', 'nps', 'ces'].includes(str(body.question_type))) {
        c.add('question_type', '問卷類型只能是 csat、nps 或 ces');
      }
      const days = body.expires_in_days;
      if (days !== undefined && (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 7)) {
        c.add('expires_in_days', '有效天數必須是 1～7 的整數');
      }
      break;
    }
    default:
      break;
  }

  if (c.issues.length > 0) {
    throw new AppError(`素材內容不符合 FB 規範：${c.issues[0].message}`, 'VALIDATION_ERROR', 400, { issues: c.issues });
  }
}
