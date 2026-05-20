/**
 * 各 contentType 首次建立時的預設 body（含展示內容）
 *
 * 同時用在：
 *   - /materials/new 建立素材時的初始 draft.body
 *   - TemplatePickerGrid 內 TemplateThumb 渲染類型卡縮圖
 *     （直接用 MaterialPreview 渲染，所見即所得）
 */

// 預設展示用圖片（picsum.photos 公開 CDN，依 seed 固定回同樣圖）
const DEMO = {
  cafe: 'https://picsum.photos/seed/cafe/800/520',
  shop: 'https://picsum.photos/seed/shop/800/520',
  product: 'https://picsum.photos/seed/product/800/420',
  place: 'https://picsum.photos/seed/place/800/520',
  person: 'https://picsum.photos/seed/person/800/520',
  imagemap: 'https://picsum.photos/seed/imagemap/1040/1040',
  videoCover: 'https://picsum.photos/seed/video/800/450',
  endCard: 'https://picsum.photos/seed/endcard/800/450',
  coupon: 'https://picsum.photos/seed/coupon/800/420',
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

  line_imagemap: {
    baseImageUrl: DEMO.imagemap,
    layoutId: 'sq_2_h',
    width: 1040,
    height: 1040,
    areas: [
      {
        x: 0,
        y: 0,
        width: 1040,
        height: 520,
        action: { type: 'uri', label: '上半區', uri: 'https://example.com/top' },
      },
      {
        x: 0,
        y: 520,
        width: 1040,
        height: 520,
        action: { type: 'message', label: '下半區', text: '我點了下半區' },
      },
    ],
  },

  // 精選範本進入後彈出 dialog 選擇，這裡放一個預設範本好讓縮圖有內容
  line_flex_showcase: {
    sampleId: 'restaurant',
    altText: 'Restaurant',
    contents: {
      type: 'bubble',
      hero: {
        type: 'image',
        url: 'https://developers-resource.landpress.line.me/fx/img/01_1_cafe.png',
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'Brown Cafe', weight: 'bold', size: 'xl' },
          {
            type: 'box',
            layout: 'baseline',
            margin: 'md',
            contents: [
              { type: 'icon', size: 'sm', url: 'https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png' },
              { type: 'icon', size: 'sm', url: 'https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png' },
              { type: 'icon', size: 'sm', url: 'https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png' },
              { type: 'icon', size: 'sm', url: 'https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png' },
              { type: 'icon', size: 'sm', url: 'https://developers-resource.landpress.line.me/fx/img/review_gray_star_28.png' },
              { type: 'text', text: '4.0', size: 'sm', color: '#999999', margin: 'md', flex: 0 },
            ],
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
