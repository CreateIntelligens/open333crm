## 1. 新建預設不勾、勾選要確認

- [x] 1.1 測試先行：`apps/web/tests/unit/components/line/rich-menu-default.test.tsx`「New draft is not the default」「Check the default option」
- [x] 1.2 實作：`new/page.tsx` 預設 `selected: false`；`RichMenuEditor.tsx` 改選項文字，勾選時確認

## 2. 發布與取消發布的確認文字

- [x] 2.1 測試先行：`rich-menu-default.test.tsx`「Publish a default menu」「Unpublish a default menu」
- [x] 2.2 實作：新增 `lib/rich-menu-confirm.ts`，列表頁與編輯頁的發布、取消發布改用依 `selected` 產生的確認文字

## 3. 完成檢查

- [x] 3.1 「Set default」「Cancel default」是既有後端行為：`apps/api/tests/unit/modules/line/rich-menu-default.test.ts` 寫時即通過，以突變驗證——把 `publishRichMenu()`、`unpublishRichMenu()` 的 `if (menu.selected)` 改成 `if (false)`，兩個情境的測試都失敗，還原後通過
- [x] 3.2 `CHANGELOG.md` 新增 Changed 條目
- [x] 3.3 `pnpm test` 通過
- [x] 3.4 `node scripts/validate-openspec.mjs fix-rich-menu-default-safety` 通過

## 備註

- 1.1、2.1 的測試先因找不到「設為所有好友的預設選單」勾選框、確認文字沒有「所有好友」而失敗，實作後通過。
- 複製選單會一併複製 `selected`（spec「Rich Menu 複製」），副本發布時同樣會出現上述確認。
