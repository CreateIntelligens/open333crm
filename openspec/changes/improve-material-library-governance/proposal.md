## Why

素材庫（Material）目前是一個「表單式、單渠道、16 種版型的內容 CRUD」，但**治理面幾乎全缺**：分類只有單一 `category` 字串且列表頁 UI 沒接、無標籤、無版本控制、無素材級成效統計（只有一個 `usageCount` 數字，連 `lastUsedAt` 都沒顯示）。競品研究顯示版本控制與素材級成效是全業界普遍空白，而我們有多個「欄位已存在但沒接 UI」的低垂果實。補齊治理能讓行銷/客服團隊真正管得動成長中的素材庫。

## What Changes

- **分類樹**：把單一 `category` 字串升級為租戶自訂的巢狀分類（parent/child），列表頁左側顯示分類樹並可篩選；支援自由搬移素材與分類（避開 Intercom「建立後不可搬移」的痛點）。
- **標籤系統**：新增素材多標籤（tags），列表頁可依標籤篩選；標籤為租戶層自訂。
- **篩選與排序**：列表頁接上分類/標籤/渠道複合篩選，並新增排序切換（最近使用、使用次數、更新時間、名稱）。
- **最後使用時間**：列表顯示既有 `lastUsedAt`（目前有欄位無 UI）。
- **版本控制**：每次編輯素材時保存一個歷史版本快照，可檢視版本歷史與還原到指定版本。新增 `MaterialVersion` 表。
- **素材級成效**：把使用率（送出次數）與互動成效（點擊/回覆，若可取得）歸因到單則素材，列表以數值＋長條顯示，並可於素材詳情看趨勢。
- **顯示用狀態欄位**：列表顯示素材狀態（草稿/已核准等），但**本 change 只做狀態的顯示與手動設定，不做送審核准狀態機**（送審流程另開 change）。

不在本 change 範圍：送審核准工作流（審核者指派、送審通知、核准/退回動作）、LINE Flex 視覺化編輯器、AI 輔助。

## Capabilities

### New Capabilities
（無全新 capability；治理為既有素材系統的能力延伸）

### Modified Capabilities
- `material-system`: 新增素材治理相關 requirements —— 巢狀分類與標籤、複合篩選與排序、素材版本歷史與還原、素材級成效歸因、以及列表顯示既有 `lastUsedAt` 與狀態欄位。

## Impact

- **DB (`packages/database/prisma/schema.prisma`)**：
  - `Material` 新增 `tags String[]`、`categoryId String?`（改指向新分類表，保留舊 `category` 字串相容一段時間）、`status` 顯示欄位。
  - 新增 `MaterialCategory` 表（tenant-scoped、parent/child 自我關聯）。
  - 新增 `MaterialVersion` 表（materialId、版本序號、body/name 快照、editedById、createdAt）。
  - 需產正式 migration（不可只 db push）。
- **API (`apps/api/src/modules/marketing/material.*`)**：
  - 列表 route 擴充篩選（categoryId/tags/多條件）與排序參數。
  - 新增分類 CRUD、標籤列舉、版本歷史查詢與還原、成效查詢端點。
  - 更新素材時寫入 `MaterialVersion` 快照；發送時累加成效歸因。
  - 權限沿用 `marketing.view` / `marketing.manage`；分類/標籤管理需 `marketing.manage`。
- **Web (`apps/web/src/app/dashboard/marketing/materials/`)**：
  - 列表頁：左側分類樹＋標籤篩選、排序切換、新增狀態/版本/使用率/最後使用欄。
  - 素材詳情/編輯頁：版本歷史面板與還原。
- **RLS**：新表（MaterialCategory/MaterialVersion）需納入租戶隔離 policy（見 postgres-rls-tenant-isolation skill，避免 fail-closed 漏接）。
- **相容性**：`targetChannels`、`variables` 為既有死欄位，本 change 不啟用、不移除。
