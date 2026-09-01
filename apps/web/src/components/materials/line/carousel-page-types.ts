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

/**
 * 各頁面類型的預設示範圖（AI 生成情境圖，public/material-samples/）。
 * 新增頁面 / 切換頁面類型時自動帶入，讓使用者一進來即有貼合情境的圖可看，
 * 上傳自己的圖後覆蓋。與 default-bodies 的 DEMO 對應一致。
 */
const SAMPLE_IMAGE_FOR_PAGE: Record<CarouselPageType, string> = {
  product: '/material-samples/product.jpeg',
  location: '/material-samples/place.jpeg',
  person: '/material-samples/person.jpeg',
  image_text: '/material-samples/cafe.jpeg',
};

/** 判斷某 imageUrl 是否為內建示範圖（非使用者自己上傳的）。 */
function isSampleImage(url: string | undefined): boolean {
  if (!url) return true;
  return Object.values(SAMPLE_IMAGE_FOR_PAGE).includes(url);
}

export function createEmptyPage(pageType: CarouselPageType): CarouselPage {
  const base: CarouselPage = { imageUrl: SAMPLE_IMAGE_FOR_PAGE[pageType] };
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

/**
 * 切換頁面類型時保留共用欄位（label / title / description / action1 / action2），
 * 只重設類型專屬欄位（price / address+extraInfo / name+tags），不清空、不需確認框。
 * 圖片：若目前是內建示範圖則換成新類型的示範圖；使用者自己上傳的圖則保留。
 */
export function switchPageType(page: CarouselPage, newType: CarouselPageType): CarouselPage {
  const next: CarouselPage = {
    label: page.label,
    imageUrl: isSampleImage(page.imageUrl) ? SAMPLE_IMAGE_FOR_PAGE[newType] : page.imageUrl,
    title: page.title,
    description: page.description,
    action1: page.action1,
    action2: page.action2,
  };
  if (newType === 'product') {
    next.price = { currency: 'NT$', amount: '' };
  }
  if (newType === 'location') {
    next.extraInfo = { type: '時間', value: '' };
  }
  if (newType === 'person') {
    next.tags = [];
  }
  return next;
}

export function defaultCarouselBody(pageType: CarouselPageType = 'product'): CarouselBody {
  return {
    pageType,
    pages: [createEmptyPage(pageType)],
  };
}
