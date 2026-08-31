/**
 * 各 contentType 首次建立時的預設 body（含展示內容）
 *
 * 同時用在：
 *   - /materials/new 建立素材時的初始 draft.body
 *   - TemplatePickerGrid 內 TemplateThumb 渲染類型卡縮圖
 *     （直接用 MaterialPreview 渲染，所見即所得）
 */

// 預設展示用圖片（AI 生成的情境示範圖，放在 public/material-samples/；
// 使用者新建素材、圖片欄位未填時自動帶入，一進來即有貼合情境的示範，上傳自己的圖後覆蓋）。
const DEMO = {
  cafe: '/material-samples/cafe.jpeg',
  shop: '/material-samples/shop.jpeg',
  product: '/material-samples/product.jpeg',
  place: '/material-samples/place.jpeg',
  person: '/material-samples/person.jpeg',
  imagemap: '/material-samples/promo-banner.jpeg',
  videoCover: '/material-samples/promo-banner.jpeg',
  endCard: '/material-samples/promo-banner.jpeg',
  coupon: '/material-samples/coupon.jpeg',
};

export const DEFAULT_BODY_FOR_TYPE: Record<string, Record<string, unknown>> = {
  // ─── LINE ─────────────────────────────────────
  line_text: {
    text: '您好，這是一則 LINE 文字訊息範例。\n換行也支援。',
  },

  line_image: {
    mediaUrl: DEMO.cafe,
    previewUrl: DEMO.cafe,
  },

  line_video: {
    videoUrl: 'https://example.com/sample.mp4',
    previewImageUrl: DEMO.videoCover,
    endCard: {
      imageUrl: DEMO.endCard,
      label: '了解更多',
      action: { type: 'uri', label: '了解更多', uri: 'https://example.com' },
    },
  },

  line_carousel: {
    pageType: 'product',
    pages: [
      {
        label: { text: '熱銷', bgColor: '#ef4444' },
        imageUrl: DEMO.product,
        title: '示範商品',
        description: '商品介紹文字會顯示在這裡',
        price: { currency: 'NT$', amount: '1,290' },
        action1: { type: 'uri', label: '立即購買', uri: 'https://example.com' },
        action2: { type: 'postback', label: '加入購物車', data: 'add_cart:demo' },
      },
    ],
  },

  // 預設用橫長 1040×700 左右 2 區，比例貼合示範底圖（promo-banner 橫幅）
  line_imagemap: {
    baseImageUrl: DEMO.imagemap,
    layoutId: 'lo_700_2v',
    width: 1040,
    height: 700,
    areas: [
      {
        x: 0,
        y: 0,
        width: 520,
        height: 700,
        action: { type: 'uri', label: '左半區', uri: 'https://example.com/left' },
      },
      {
        x: 520,
        y: 0,
        width: 520,
        height: 700,
        action: { type: 'message', label: '右半區', text: '我點了右半區' },
      },
    ],
  },

  // 精選範本進入後彈出 dialog 選擇，這裡放一個預設範本好讓縮圖有內容
  // 空 body：一進來走 LineFlexShowcaseEditor 空狀態，讓使用者選「AI 描述生成」或「精選範本」
  line_flex_showcase: {},

  line_flex_template: {
    type: 'flex',
    altText: '新品優惠',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '新品優惠', weight: 'bold', size: 'xl', wrap: true },
          {
            type: 'text',
            text: '請先在 LINE Flex Simulator 編輯完成，再貼上 Flex JSON。',
            size: 'sm',
            color: '#666666',
            wrap: true,
            margin: 'md',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            action: { type: 'uri', label: '查看活動', uri: 'https://example.com' },
          },
        ],
      },
    },
  },

  // ─── FB ─────────────────────────────────────
  fb_text: {
    text: '您好，這是一則 FB Messenger 訊息範例。',
  },

  fb_image: {
    url: DEMO.cafe,
  },

  fb_video: {
    url: 'https://example.com/sample.mp4',
  },

  fb_generic: {
    elements: [
      {
        title: '示範商品 A',
        subtitle: 'NT$ 590',
        image_url: DEMO.product,
        buttons: [{ type: 'web_url', title: '了解更多', url: 'https://example.com/a' }],
      },
      {
        title: '示範商品 B',
        subtitle: 'NT$ 890',
        image_url: DEMO.shop,
        buttons: [{ type: 'web_url', title: '了解更多', url: 'https://example.com/b' }],
      },
    ],
  },

  fb_button: {
    text: '請問需要什麼協助？',
    buttons: [
      { type: 'postback', title: '查訂單', payload: 'menu:order' },
      { type: 'postback', title: '查商品', payload: 'menu:product' },
      { type: 'web_url', title: '前往官網', url: 'https://example.com' },
    ],
  },

  fb_media: {
    media_type: 'image',
    url: DEMO.product,
  },

  fb_coupon: {
    title: '會員 8 折優惠',
    subtitle: '會員專屬 · 5/31 前使用',
    coupon_pre_message: '感謝您一直以來的支持',
    coupon_code: 'MAY80',
    image_url: DEMO.coupon,
    payload: 'coupon_demo',
  },

  fb_receipt: {
    recipient_name: '王小明',
    order_number: '1234567890',
    currency: 'TWD',
    payment_method: 'Visa **1234',
    merchant_name: 'open333 Shop',
    summary: { total_cost: 650 },
  },

  fb_feedback: {
    title: '您對本次服務的滿意度？',
    subtitle: '您的回饋會幫助我們進步',
    question_type: 'csat',
    expires_in_days: 7,
  },
};
