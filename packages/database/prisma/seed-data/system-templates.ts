/**
 * System templates seed data
 *
 * 自 add-line-fb-split-materials change 起，不再 seed 任何 system templates。
 * Material 直接從 contentType 建立，不需要先選版型。
 *
 * 此檔保留 export 結構供其他程式碼引用，但內容為空陣列。
 */

export type SystemTemplateSeed = {
  id: string;
  name: string;
  description: string;
  category: string;
  channelType: 'line' | 'fb';
  contentType: string;
  body: Record<string, unknown>;
  variables?: Array<{ key: string; label: string; defaultValue?: string; required?: boolean }>;
  previewImageUrl?: string;
};

export const systemTemplates: SystemTemplateSeed[] = [];
