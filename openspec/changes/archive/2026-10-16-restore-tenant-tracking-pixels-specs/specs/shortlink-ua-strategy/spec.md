## ADDED Requirements

### Requirement: 中轉頁放入租戶的追蹤碼

人類訪客開啟有效的短連結時，系統回應的中轉頁 SHALL 放入短連結所屬租戶的追蹤碼：

- 租戶設定了 `gaId` 時，放入 GA4 的 gtag.js 與 `gtag('config', gaId)`。
- 租戶設定了 `metaPixelId` 時，放入 Meta Pixel 的基本程式碼、`fbq('init', metaPixelId)` 與 `fbq('track', 'PageView')`。
- 沒有設定的 ID，SHALL NOT 放入對應的 script。

這條需求涵蓋 `EXTERNAL_BROWSER`、`FB_WEBVIEW` 的中轉頁，以及 `LINE_WEBVIEW` 導向 LIFF 的中轉頁。中轉頁不等追蹤事件送出就轉址，所以 GA 與 Meta 不一定收到事件。

#### Scenario: 一般瀏覽器的中轉頁含追蹤碼
- **WHEN** 租戶設定了 `gaId` 為 `G-ABC123XYZ9`、`metaPixelId` 為 `123456789012345`，訪客以一般瀏覽器開啟該租戶的短連結
- **THEN** 頁面含 `https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ9`、`gtag('config', 'G-ABC123XYZ9')`、`fbq('init', '123456789012345')` 與 `fbq('track', 'PageView')`

#### Scenario: Facebook 內建瀏覽器的中轉頁含追蹤碼
- **WHEN** 租戶設定了兩個 ID，訪客以 Facebook 內建瀏覽器開啟該租戶的短連結
- **THEN** 頁面含 GA4 與 Meta Pixel 的 script

#### Scenario: LIFF 中轉頁含追蹤碼
- **WHEN** 租戶設定了兩個 ID，訪客以 LINE 內建瀏覽器開啟綁定了 LIFF 渠道的短連結
- **THEN** 頁面導向 `liff.line.me`，並含 GA4 與 Meta Pixel 的 script

#### Scenario: 沒有設定的 ID 不放入 script
- **WHEN** 租戶只設定了 `metaPixelId`，訪客以一般瀏覽器開啟該租戶的短連結
- **THEN** 頁面含 Meta Pixel 的 script，不含 `googletagmanager.com`
