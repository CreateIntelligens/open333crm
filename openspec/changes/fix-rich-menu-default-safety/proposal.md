## Why

2026-10-15 重寫操作手冊時盤點 LINE Rich Menu（M07）：編輯頁的「預設展開選單（使用者開啟對話時自動展開）」在發布時其實會把這張選單設成該官方帳號**所有好友**的預設選單，換掉好友目前看到的選單；取消發布一張預設選單，所有好友的預設選單會消失。新建草稿時這個選項預設勾選，確認框也只寫「確定發布到 LINE？」。任何一張新選單一發布，就會換掉正式環境全部好友的選單，畫面沒有任何提醒。

## What Changes

- 新建 Rich Menu 時「設為所有好友的預設選單」預設不勾。
- 勾選這個選項時跳出確認，說明發布後會換掉所有好友目前看到的選單；取消確認就不勾。
- 發布一張預設選單時，確認文字說明會換掉所有好友目前的選單。
- 取消發布一張預設選單時，確認文字說明所有好友的預設選單會消失。
- 選項文字改成「設為所有好友的預設選單」，說明它實際做的事。

後端行為不變（API 未帶 `selected` 時本來就是 `false`）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `line-rich-menu`：「Default Rich Menu」加入新建預設不勾與確認提示。

## Impact

- Web：`app/dashboard/line/rich-menus/new/page.tsx`、`app/dashboard/line/rich-menus/page.tsx`、`app/dashboard/line/rich-menus/[id]/page.tsx`、`components/line/rich-menu/RichMenuEditor.tsx`、新增 `lib/rich-menu-confirm.ts`
- 文件：`CHANGELOG.md`、操作手冊 LINE 章節
