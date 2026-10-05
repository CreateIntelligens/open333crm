## Why

Issue #206：客人從 LINE 傳來的語音與檔案訊息，系統只記下文字 `[audio]`、`[file]`，沒有下載內容。`980781d5`（change `line-webhook-image-profile-sync`）加入 `contentProvider` 判斷時，把原本 image / video / audio / file 共用的 case 改成只剩 image 與 video。該 change 的 proposal、tasks 與 delta spec 都要求處理語音與檔案，判斷是誤刪。主規格 `line-webhook-events` 也要求解析並下載這四種媒體。

修這個問題時另外發現：**LINE 的圖片與影片在收件匣其實也顯示不出來**。LINE 外掛把 `mediaUrl` 設為 `line-content:<id>`，下載完成後後端只寫入 `content.url`，`mediaUrl` 沒有更新；前端的 `extractMediaUrl()` 優先讀 `mediaUrl`，得到瀏覽器打不開的 `line-content:` 網址。UAT 上 3 則 LINE 圖片與影片都是這個狀態。

此外，收件匣只為圖片與影片顯示媒體，語音與檔案即使下載了，也只會顯示文字。

## What Changes

- LINE 外掛的 `parseWebhook()` 恢復解析 `audio`（依 `contentProvider` 判斷，帶 `duration`）與 `file`（帶 `fileName`、`fileSize`）。
- 媒體下載完成後，同時把 `content.mediaUrl` 改成儲存後的網址，不再留下 `line-content:` 網址。
- 外掛不再把 `line-content:` 佔位值寫進 `mediaUrl`，待下載由 `contentId` 表示。
- 下載加上 25 MB 上限；存檔時只保留圖片（不含 SVG）、影片、語音的 MIME，其他存成 `application/octet-stream`，避免客人傳的 html、svg 在儲存網域執行；檔案保留副檔名。
- 下載失敗時把中文原因寫進 `content.mediaError` 並推送給收件匣，不再只寫 log。
- 收件匣重新抓訊息的節流改為間隔結束後補執行，下載完成的 `message.new` 不會被丟掉。
- 收件匣顯示媒體時只採用瀏覽器打得開的網址（相容既有資料），語音顯示播放器，檔案顯示可下載的檔名與大小。
- 主規格 `line-webhook-events` 的媒體下載需求改寫為實際做法：API 行程內非同步下載（沒有經過 BullMQ），結果寫入 `content.url` 與 `content.mediaUrl`。

## Capabilities

### Modified Capabilities

- `line-webhook-events`：媒體下載需求改寫為實際做法，補上語音、檔案與外部提供的媒體。
- `core-inbox`：新增收件匣顯示進站媒體。

## Impact

- `packages/channel-plugins`（需重新 build）、`apps/api` 進站媒體下載、`apps/web` 收件匣訊息泡泡
- 不需要 migration。
- 既有資料：UAT 上沒有 LINE 語音或檔案訊息（`contentType = 'unknown'` 的 LINE 訊息為 0 筆），不需補救。已下載的 LINE 圖片與影片有 `content.url`，前端改為略過 `line-content:` 後即可顯示。
- 本 change 也補上 `line-webhook-image-profile-sync` 沒有套用到主規格的 `line-webhook-events` delta（該 change 在 `980781d5` 直接放進 `archive/`）。
