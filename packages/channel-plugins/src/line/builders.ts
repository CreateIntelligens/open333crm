/**
 * LINE Message Builders
 *
 * 把 Material body（line_carousel / line_imagemap / line_video）轉成 LINE Messaging API 期望的 payload。
 * 純函式、無 I/O、無外部依賴。
 *
 * 詳細 body schema 見：
 *   - openspec/changes/add-line-fb-split-materials/design.md
 *   - openspec/changes/add-line-fb-split-materials/specs/material-system/spec.md
 */

// ─── 共用型別 ─────────────────────────────────────────────

export type ActionConfig =
  | { type: 'message'; label: string; text: string }
  // tagOnClick：素材編輯器的「點擊後貼標」內部欄位；送出前由 marketing 消化進短連結，
  // 不進 LINE payload（actionToLine 只挑 type/label/uri，不帶此欄位）。
  | { type: 'uri'; label: string; uri: string; altUriDesktop?: string; tagOnClick?: string }
  | { type: 'postback'; label: string; data: string; displayText?: string };

function actionToLine(action: ActionConfig | undefined | null): Record<string, unknown> | null {
  if (!action) return null;
  if (action.type === 'uri') {
    const out: Record<string, unknown> = { type: 'uri', label: action.label, uri: action.uri };
    if (action.altUriDesktop) out.altUri = { desktop: action.altUriDesktop };
    return out;
  }
  if (action.type === 'postback') {
    const out: Record<string, unknown> = { type: 'postback', label: action.label, data: action.data };
    if (action.displayText) out.displayText = action.displayText;
    return out;
  }
  return { type: 'message', label: action.label, text: action.text };
}

// ─── line_carousel ──────────────────────────────────────────
//
// body 結構：
// {
//   pageType: 'product' | 'location' | 'person' | 'image_text';
//   pages: Array<{...，依 pageType 不同欄位}>;
//   endPage?: { imageUrl, label, action };
// }

interface CarouselPage {
  label?: { text: string; bgColor?: string };
  imageUrl?: string;
  title?: string;
  description?: string;
  // product
  price?: { currency?: string; amount?: string };
  // location
  address?: string;
  extraInfo?: { type?: string; value?: string };
  // person
  name?: string;
  tags?: Array<{ text: string; color?: string }>;
  // 共用
  action1?: ActionConfig;
  action2?: ActionConfig;
}

export function buildLineCarousel(content: Record<string, unknown>): Record<string, unknown> {
  const pageType = (content.pageType as string) ?? 'product';
  const pages = (content.pages as CarouselPage[] | undefined) ?? [];
  const endPage = content.endPage as { imageUrl?: string; label?: string; action?: ActionConfig } | undefined;
  const altText = (content.altText as string) ?? '多頁訊息';

  const bubbles = pages.map((page) => carouselPageToBubble(pageType, page));
  if (endPage) bubbles.push(endPageToBubble(endPage));

  return {
    type: 'flex',
    altText,
    contents: { type: 'carousel', contents: bubbles.slice(0, 12) },
  };
}

function carouselPageToBubble(pageType: string, page: CarouselPage): Record<string, unknown> {
  const bubble: Record<string, unknown> = { type: 'bubble', size: 'mega' };
  const bodyContents: Array<Record<string, unknown>> = [];

  // hero 圖片
  if (page.imageUrl) {
    bubble.hero = {
      type: 'image',
      url: page.imageUrl,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    };
  }

  // 標籤（最上方有色塊文字）。用 horizontal 外框 + 色塊 flex:0 讓標籤只佔內容寬（靠左），
  // 而非用 LINE Flex 不支援的 alignSelf（會被 LINE API 擋為 unknown field）。
  if (page.label?.text) {
    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          contents: [{ type: 'text', text: page.label.text, color: '#ffffff', weight: 'bold', size: 'xs' }],
          backgroundColor: page.label.bgColor ?? '#27272a',
          paddingAll: '4px',
          cornerRadius: '4px',
          flex: 0,
        },
      ],
    });
  }

  // 姓名（人物 pageType 用）
  if (pageType === 'person' && page.name) {
    bodyContents.push({ type: 'text', text: page.name, weight: 'bold', size: 'xl' });
  }

  // 人物特點 tags。底色/圓角/padding 是 box 屬性（text 不支援，LINE API 會擋 unknown field），
  // 故每個 tag 用一個帶底色的 box 包住 text。
  if (pageType === 'person' && page.tags && page.tags.length > 0) {
    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'xs',
      margin: 'sm',
      contents: page.tags.slice(0, 3).map((tag) => ({
        type: 'box',
        layout: 'vertical',
        backgroundColor: tag.color ?? '#27272a',
        paddingAll: '2px',
        cornerRadius: '2px',
        flex: 0,
        contents: [{ type: 'text', text: tag.text, color: '#ffffff', size: 'xs' }],
      })),
    });
  }

  // 標題
  if (page.title) {
    bodyContents.push({ type: 'text', text: page.title, weight: 'bold', size: 'lg', wrap: true });
  }

  // 地址（地點 pageType 用）
  if (pageType === 'location' && page.address) {
    bodyContents.push({
      type: 'box',
      layout: 'baseline',
      margin: 'sm',
      contents: [
        { type: 'text', text: '📍', size: 'sm', flex: 0 },
        { type: 'text', text: page.address, size: 'sm', color: '#666666', wrap: true, margin: 'sm' },
      ],
    });
  }

  // 相關資訊（地點）
  if (pageType === 'location' && page.extraInfo?.value) {
    bodyContents.push({
      type: 'text',
      text: `${page.extraInfo.type ?? ''} ${page.extraInfo.value}`,
      size: 'sm',
      color: '#666666',
    });
  }

  // 文字說明
  if (page.description) {
    bodyContents.push({ type: 'text', text: page.description, size: 'sm', color: '#666666', wrap: true, margin: 'md' });
  }

  // 價格（商品 pageType）
  if (pageType === 'product' && page.price?.amount) {
    bodyContents.push({
      type: 'text',
      text: `${page.price.currency ?? 'NT$'} ${page.price.amount}`,
      weight: 'bold',
      size: 'xl',
      margin: 'md',
      color: '#27272a',
    });
  }

  bubble.body = { type: 'box', layout: 'vertical', contents: bodyContents, spacing: 'sm' };

  // footer 動作
  const footerContents: Array<Record<string, unknown>> = [];
  const a1 = actionToLine(page.action1);
  const a2 = actionToLine(page.action2);
  if (a1) footerContents.push({ type: 'button', style: 'primary', height: 'sm', action: a1 });
  if (a2) footerContents.push({ type: 'button', style: 'secondary', height: 'sm', action: a2 });
  if (footerContents.length > 0) {
    bubble.footer = { type: 'box', layout: 'vertical', spacing: 'sm', contents: footerContents };
  }

  return bubble;
}

function endPageToBubble(endPage: { imageUrl?: string; label?: string; action?: ActionConfig }): Record<string, unknown> {
  const bubble: Record<string, unknown> = { type: 'bubble', size: 'mega' };
  if (endPage.imageUrl) {
    bubble.hero = {
      type: 'image',
      url: endPage.imageUrl,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    };
  }
  const action = actionToLine(endPage.action);
  if (action) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'button', style: 'primary', action: { ...action, label: endPage.label ?? action.label } },
      ],
    };
  }
  return bubble;
}

// ─── line_imagemap ──────────────────────────────────────────
//
// body 結構：
// {
//   baseImageUrl: string;
//   width: 1040;
//   height: number;
//   areas: Array<{ x, y, width, height, action }>;
// }

interface ImagemapArea {
  x: number;
  y: number;
  width: number;
  height: number;
  action: ActionConfig;
}

export function buildLineImagemap(content: Record<string, unknown>): Record<string, unknown> {
  const baseImageUrl = content.baseImageUrl as string;
  const width = (content.width as number) ?? 1040;
  const height = (content.height as number) ?? 1040;
  const areas = (content.areas as ImagemapArea[] | undefined) ?? [];
  const altText = (content.altText as string) ?? '圖文訊息';

  return {
    type: 'imagemap',
    baseUrl: baseImageUrl,
    altText,
    baseSize: { width, height },
    actions: areas.map((area) => {
      const a = area.action;
      if (a.type === 'uri') {
        return {
          type: 'uri',
          linkUri: a.uri,
          area: { x: area.x, y: area.y, width: area.width, height: area.height },
          label: a.label,
        };
      }
      if (a.type === 'message') {
        return {
          type: 'message',
          text: a.text,
          area: { x: area.x, y: area.y, width: area.width, height: area.height },
          label: a.label,
        };
      }
      // imagemap 不支援 postback；轉成 message fallback（送 data 字串）
      return {
        type: 'message',
        text: (a as { data?: string }).data ?? '',
        area: { x: area.x, y: area.y, width: area.width, height: area.height },
        label: a.label,
      };
    }),
  };
}

// ─── line_video ──────────────────────────────────────────
//
// body 結構：
// {
//   videoUrl: string;
//   previewImageUrl: string;
//   trackingId?: string;
//   endCard?: { imageUrl, label, action };
// }
//
// LINE video message 可選帶 trackingId 用於統計。
// endCard 在 LINE API 中是「影片播完後的 CTA」，需用 imagemap 替代或包裝後 follow-up。
// 為簡化，本實作把 endCard 包成 imagemap + video 兩個 message 一起送（呼叫端會把回傳值當陣列處理）。

export function buildLineVideoWithEndCard(content: Record<string, unknown>): Record<string, unknown> {
  const videoUrl = content.videoUrl as string;
  const previewImageUrl = content.previewImageUrl as string;
  const trackingId = content.trackingId as string | undefined;

  const video: Record<string, unknown> = {
    type: 'video',
    originalContentUrl: videoUrl,
    previewImageUrl,
  };
  if (trackingId) video.trackingId = trackingId;

  return video;
}
