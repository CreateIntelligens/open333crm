# 顏色 Token 對照表

定義在 `apps/web/src/app/globals.css`（`:root` 亮色、`.dark` 暗色），Tailwind 對應在 `apps/web/tailwind.config.ts`。
CSS 變數存的是 HSL 三個數字（例 `210 71% 54%`），Tailwind 用 `hsl(var(--primary))` 包起來。

## 文字

| Figma 變數 | 色碼 | Tailwind class | 用途 |
|---|---|---|---|
| Text/Primary | #37404C | `text-foreground` | 主要文字、標題 |
| Text/Secondary | #707E93 | `text-muted-foreground` | 說明文字、表頭、次要資訊 |
| Text/Tertiary | #6D6D6D | `text-tertiary-foreground` | 未選中選單、圖示、Outline 按鈕字 |
| Status/Neutral | #919191 | `text-status-neutral` | placeholder、停用文字 |

## 動作（藍）

| Figma 變數 | 色碼 | Tailwind class | 用途 |
|---|---|---|---|
| Action/Default | #378ADD | `bg-primary` `text-primary` `border-primary` | 主要按鈕、連結、focus |
| Action/Hover | #2876C4 | `bg-primary-hover` | 按鈕 hover、選單選中 |
| Background/Secondary | #EFF6FF | `bg-primary-subtle` | Secondary 按鈕底、Info 標籤底 |
| Border/Info | #C4D2FF | `border-primary-border` | 藍色淡框 |
| Action/Disabled | #C6CFDD | `bg-control-disabled` `border-control-disabled` | Switch 關、Checkbox 框、Outline 標籤框 |
| （主要按鈕停用） | #D0D0D0 | `bg-disabled-solid` | Primary 停用底 |

## 背景與框線

| Figma 變數 | 色碼 | Tailwind class | 用途 |
|---|---|---|---|
| Background/Primary | #FFFFFF | `bg-background` | 內容區、卡片 |
| Background/Tertiary | #F8FAFC | `bg-muted` | 表頭、輸入框灰底、Select 底 |
| Background/Hover | #F5F5F5 | `bg-shell` | 外框（頂部列、圖示欄、子選單）、hover |
| （圖示欄漸層底端） | #E6E6E6 | `to-shell-end` | 目前未使用（設計師決定外框全為 #F5F5F5） |
| Border/Default | #E2E8F0 | `border-border` `border-input` | 框線、分隔線 |

## 狀態

| Figma 變數 | 色碼 | Tailwind class | 淡底 class |
|---|---|---|---|
| Status/Success | #008236 | `text-success` | `bg-success-subtle`（#EEF5F0） |
| Status/Online | #00AB50 | `bg-online` | — |
| Status/Error | #EE3134 | `text-destructive` `bg-destructive` | `bg-destructive-subtle`（#FFECED） |
| Status/In Progress | #FF6E00 | `text-warning` `bg-warning` | `bg-warning-subtle`（#FFF0E4） |
| Status/Accent（Robot） | #79489C | `text-robot` `bg-robot` | `bg-ai-subtle`（#F8EEFF） |
| （AI 紫，專案原有） | #9810FA | `bg-ai` `text-ai` | `bg-ai-subtle` |

## 新增 token 的步驟

1. `globals.css` 的 `:root` 加亮色值，`.dark` 加暗色值，**兩個都要加**，並在註解寫 Figma 變數名稱與色碼
2. `tailwind.config.ts` 的 `theme.extend.colors` 加對應名稱
3. 名稱不要跟 Tailwind 內建色階撞名（例：不要叫 `neutral`，會蓋掉 `neutral-100` 那些，所以用 `status-neutral`）
4. 改了 `tailwind.config.ts` 後要重開前端：`docker compose -f docker-compose.dev.yml restart web`
