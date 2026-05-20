/**
 * LINE 多頁訊息 — 4 種頁面類型的欄位定義
 *
 * 對齊 LINE OA Manager 後台「多頁訊息 > 頁面類型」：
 *   商品服務 / 地點 / 人物 / 圖文
 */

import type { ActionConfig } from './ActionConfigEditor';

export type CarouselPageType = 'product' | 'location' | 'person' | 'image_text';

export interface PageLabel {
  text: string;
  bgColor: string;
}

// 標籤底色（LINE OA 6 種）
export const LABEL_COLORS = [
  '#27272a', // 深灰（預設）
  '#ffffff', // 白
  '#ef4444', // 紅
  '#f97316', // 橘
  '#10b981', // 綠
  '#3b82f6', // 藍
];

export interface CarouselPage {
  // 共用
  label?: PageLabel;
  imageUrl?: string;
  title?: string;
  description?: string;
  action1?: ActionConfig;
  action2?: ActionConfig;
  // product
  price?: { currency: 'NT$' | '$' | '¥'; amount: string };
  // location
  address?: string;
  extraInfo?: { type: '時間' | '電話' | '其他'; value: string };
  // person
  name?: string;
  tags?: Array<{ text: string; color: string }>; // 最多 3 個
}

export interface CarouselBody {
  pageType: CarouselPageType;
  pages: CarouselPage[];
  endPage?: {
    imageUrl?: string;
    label?: string; // CTA 按鈕文字
    action?: ActionConfig;
  };
  altText?: string;
}

export const PAGE_TYPE_OPTIONS: Array<{ value: CarouselPageType; label: string; desc: string }> = [
  { value: 'product', label: '商品服務', desc: '展示商品 / 服務，含標題、價格、按鈕' },
  { value: 'location', label: '地點', desc: '介紹地點，含地址、相關資訊' },
  { value: 'person', label: '人物', desc: '介紹人物，含姓名、特點標籤' },
  { value: 'image_text', label: '圖文', desc: '簡易圖文卡，含標題、文字、按鈕' },
];

export function createEmptyPage(pageType: CarouselPageType): CarouselPage {
  const base: CarouselPage = {};
  if (pageType === 'product') {
    base.price = { currency: 'NT$', amount: '' };
  }
  if (pageType === 'location') {
    base.extraInfo = { type: '時間', value: '' };
  }
  if (pageType === 'person') {
    base.tags = [];
  }
  return base;
}

export function defaultCarouselBody(pageType: CarouselPageType = 'product'): CarouselBody {
  return {
    pageType,
    pages: [createEmptyPage(pageType)],
  };
}
