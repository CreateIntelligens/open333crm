import type { Translations } from 'react-querybuilder';

/**
 * 條件建構器的組合方式。值仍是 and / or（qb-to-engine 依此轉成 json-rules-engine 的 all / any），
 * 只改顯示文字：原本是英文的 AND / OR。
 */
export const CONDITION_COMBINATORS: Array<{ name: 'and' | 'or'; label: string }> = [
  { name: 'and', label: '全部符合' },
  { name: 'or', label: '任一符合' },
];

/** 條件建構器的按鈕文字與滑鼠提示。react-querybuilder 預設是英文（+ Rule、Remove rule…） */
export const CONDITION_TRANSLATIONS = {
  fields: { title: '欄位', placeholderName: '~', placeholderLabel: '請選擇欄位', placeholderGroupLabel: '請選擇欄位' },
  operators: { title: '比較方式', placeholderName: '~', placeholderLabel: '請選擇比較方式', placeholderGroupLabel: '請選擇比較方式' },
  value: { title: '比較值' },
  removeRule: { label: '刪除', title: '刪除這個條件' },
  removeGroup: { label: '刪除群組', title: '刪除這個條件群組' },
  addRule: { label: '+ 新增條件', title: '新增一個條件' },
  addGroup: { label: '+ 新增條件群組', title: '新增一組條件，可以設定這組裡要全部符合或任一符合' },
  combinators: { title: '條件要全部符合，還是任一符合就好' },
  notToggle: { label: '不符合', title: '反轉這組條件' },
  cloneRule: { label: '複製', title: '複製這個條件' },
  cloneRuleGroup: { label: '複製', title: '複製這個條件群組' },
  shiftActionUp: { label: '上移', title: '往上移' },
  shiftActionDown: { label: '下移', title: '往下移' },
  dragHandle: { label: '⁞⁞', title: '拖曳調整順序' },
  lockRule: { label: '鎖定', title: '鎖定這個條件' },
  lockGroup: { label: '鎖定', title: '鎖定這個條件群組' },
  lockRuleDisabled: { label: '解鎖', title: '解除鎖定這個條件' },
  lockGroupDisabled: { label: '解鎖', title: '解除鎖定這個條件群組' },
  valueSourceSelector: { title: '比較值的來源' },
} satisfies Partial<Translations>;
