/**
 * Feature Registry（平台 feature module 定義）
 *
 * 平台層以 feature module 為單位控制租戶能用哪些功能（entitlement）。
 * 每個 feature 涵蓋一組權限點——這是「平台可控功能」與「租戶可授權限」的對應橋樑。
 * 對應 ARCH-PLATFORM-LAYER §0.1（定義順序）與 SPEC-PLATFORM-LAYER。
 *
 * 注意：feature 的 `perms` 是由 permissions registry 反向推導（每個權限點宣告自己的 feature），
 * 此處只定義 feature 的中繼資料（顯示名稱、是否核心）。實際涵蓋的權限點由 buildFeaturePerms() 動態組出。
 */

export interface FeatureDef {
  /** feature module slug */
  slug: string;
  /** 顯示名稱（使用者語言） */
  label: string;
  /** 核心 feature：恆開、不可被 entitlement 關閉 */
  core?: boolean;
}

export const FEATURES: readonly FeatureDef[] = [
  { slug: 'inbox', label: '客服收發' },
  { slug: 'channels', label: '渠道管理' },
  { slug: 'automation', label: '自動化' },
  { slug: 'marketing', label: '行銷群發' },
  { slug: 'analytics', label: '分析報表' },
  { slug: 'knowledge', label: '知識庫' },
  { slug: 'portal', label: '粉絲活動' },
  { slug: 'core', label: '帳號 · 角色 · 設定', core: true },
] as const;

/** 所有 feature slug 集合 */
export const FEATURE_SLUGS: ReadonlySet<string> = new Set(FEATURES.map((f) => f.slug));

/** core feature slug（恆開） */
export const CORE_FEATURE = 'core';
