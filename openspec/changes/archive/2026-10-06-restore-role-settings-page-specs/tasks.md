## 1. 測試環境

- [x] 1.1 `apps/web` 加上 `@testing-library/react`、`@testing-library/dom` 與 `jsdom`，`vitest.config.ts` 收 `*.test.tsx`，並加上 `@/` 的路徑與 `tests/setup/jsdom.ts`

## 2. 測試

測試名稱以情境名稱開頭。描述現行行為的測試寫好時就通過，所以這些測試改以突變驗證（第 4 節）。描述 bug 的測試先在修正前執行，確認以斷言失敗。

測試檔的簡稱：

- `matrix`：`apps/web/tests/unit/components/settings/role-permission-matrix.test.tsx`
- `settings`：`apps/web/tests/unit/app/dashboard/settings/settings-page.test.tsx`
- `sidebar`：`apps/web/tests/unit/components/layout/sidebar.test.tsx`
- `auth`：`apps/web/tests/unit/providers/auth-provider.test.tsx`

**`role-settings-page`**

| 需求 | 情境 | 測試 | 修正前 |
| --- | --- | --- | --- |
| 依群組顯示角色的權限 | 選取角色後依群組顯示權限 | `matrix` | 通過 |
| 依群組顯示角色的權限 | 折疊群組 | `matrix` | 通過 |
| 依群組顯示角色的權限 | 角色的權限載入失敗 | `matrix` | 通過 |
| 勾選時處理前置權限 | 勾選權限時一併勾選前置權限 | `matrix` | 失敗：標籤在相依權限上 |
| 勾選時處理前置權限 | 前置權限原本已勾選時不顯示自動開啟 | `matrix` | 失敗：同上 |
| 勾選時處理前置權限 | 取消勾選前置權限時確認相依的權限 | `matrix` | 通過 |
| 勾選時處理前置權限 | 不確認時不變更 | `matrix` | 通過 |
| 勾選時處理前置權限 | 群組全關時一併取消其他群組的相依權限 | `matrix` | 失敗：沒有確認，組外的權限仍勾選 |
| 勾選時處理前置權限 | 群組全開時一併勾選其他群組的前置權限 | `matrix` | 失敗：標籤在相依權限上 |
| 隱含權限只顯示說明 | 指派案件顯示隱含權限的說明 | `matrix` | 通過 |
| 隱含權限只顯示說明 | 勾選時不勾選隱含權限 | `matrix` | 通過 |
| admin 角色的內建鎖定 | admin 角色的內建鎖定權限不能操作 | `matrix` | 失敗：前置權限沒有鎖定 |
| admin 角色的內建鎖定 | 全關略過內建鎖定的權限 | `matrix` | 失敗：全關移除了 `adminLock` 權限 |
| admin 角色的內建鎖定 | admin 以外的角色沒有內建鎖定 | `matrix` | 通過 |
| 變更暫存到按下儲存 | 勾選不送出請求 | `matrix` | 通過 |
| 變更暫存到按下儲存 | 放棄變更 | `matrix` | 通過 |
| 變更暫存到按下儲存 | 儲存成功 | `matrix` | 通過 |
| 變更暫存到按下儲存 | 儲存失敗時保留草稿 | `matrix` | 通過 |
| 變更暫存到按下儲存 | 有未儲存的變更時切換角色 | `matrix` | 通過 |
| 沒有 role.manage 時唯讀 | 只有 role.view 時唯讀 | `matrix` | 通過 |
| 沒有 role.manage 時唯讀 | 沒有 role.view 時不顯示角色設定頁 | `settings` | 通過 |

**`permission-check`**

| 需求 | 情境 | 測試 | 修正前 |
| --- | --- | --- | --- |
| 前端依權限顯示選單 | 沒有權限時隱藏選單項目 | `sidebar` | 通過 |
| 前端依權限顯示選單 | 有權限時顯示選單項目 | `sidebar` | 通過 |
| 前端依權限顯示選單 | 子項目全部隱藏時隱藏上層項目 | `sidebar` | 通過 |
| 前端依權限顯示選單 | 以密碼登入後載入權限 | `auth` | 通過 |
| 前端依權限顯示選單 | 以 Passkey 登入後載入權限 | `auth` | 失敗：權限沒有載入 |
| 前端依權限顯示選單 | 權限載入失敗時權限集合是空的 | `auth` | 通過 |

- [x] 2.1 寫上表的測試，確認標「失敗」的 7 個測試在修正前以斷言失敗

## 3. 修正

- [x] 3.1 `RolePermissionMatrix.tsx`：admin 角色鎖定 `adminLock` 權限與它們的前置權限；群組全關略過鎖定的權限
- [x] 3.2 `RolePermissionMatrix.tsx`：群組全關一併取消其他群組的相依權限，並先確認；群組全開一併勾選其他群組的前置權限
- [x] 3.3 `RolePermissionMatrix.tsx`：「自動開啟」標籤改為標示這次編輯中被自動勾選的前置權限
- [x] 3.4 `AuthProvider.tsx`：Passkey 登入後載入權限

## 4. 突變驗證

改壞一處程式，執行對應的測試，確認測試失敗。36 個突變都讓測試失敗。

| 範圍 | 突變 |
| --- | --- |
| 群組與載入 | 群組計數錯；折疊無效；權限載入失敗時不停用勾選格 |
| 前置權限 | 不補前置權限；取消前置權限時不確認；不連帶取消相依權限；已勾選的前置權限也標示自動開啟；不顯示自動開啟 |
| 群組全開、全關 | 全關不處理組外的相依權限；全關不確認；全開不補組外的前置權限 |
| 隱含權限 | 說明文字錯；勾選時也勾選隱含權限 |
| 內建鎖定 | 所有角色都鎖定；不鎖前置權限；全關不略過鎖定的權限 |
| 暫存與儲存 | 勾選就送出；放棄無效；只送差異；成功不提示；失敗清空草稿；失敗不顯示後端訊息；切換角色不確認 |
| 唯讀 | 勾選格可以操作；顯示全開、全關；顯示新增角色；不說明唯讀；設定頁不檢查 `role.view` |
| 選單與登入 | 選單不過濾；有權限也隱藏；上層項目不隱藏；「報表」沒有權限碼；密碼登入、Passkey 登入、恢復登入狀態不載入權限；載入失敗時沿用權限 |

- [x] 4.1 執行突變驗證

## 5. 完成的定義

- [x] 5.1 `pnpm test` 通過
- [x] 5.2 `CHANGELOG.md` 記錄 bug 的修正與「自動開啟」標籤的修改
- [x] 5.3 `docs/ref/modules/PERMISSIONS.md` 更新「前端的顯示」
- [x] 5.4 `openspec validate --strict` 通過後以 `openspec archive` 歸檔，並改寫 `role-settings-page` 與 `permission-check` 的 Purpose
