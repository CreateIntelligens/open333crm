# Frontend 架構文檔

## 1. 前端技術棧

這是一個 **Vue 3 + TypeScript + Vite** 的單頁應用 (SPA)。

### 1.1 核心依賴

```json
{
  "vue": "^3.4.21",
  "vue-router": "^4.3.2",
  "axios": "^1.8.2",
  "typescript": "^5.2.2",
  "vite": "^5.4.19"
}
```

### 1.2 構建配置

- **構建工具**：Vite
- **輸出目錄**：`public/web/`
- **訪問路徑**：`/web`
- **開發服務器**：http://localhost:3000

### 1.3 專案目錄結構

```
resources/frontend/
├── index.html              # 入口 HTML
├── package.json            # 依賴配置
├── vite.config.ts          # Vite 配置
├── tsconfig.json           # TypeScript 配置
├── public/                 # 靜態資源
│   └── ...
└── src/
    ├── main.ts             # 入口文件
    ├── App.vue             # 根組件
    ├── style.css           # 全局樣式
    ├── vite-env.d.ts       # Vite 類型定義
    ├── assets/             # 靜態資源
    ├── components/         # 可重用組件
    ├── config/             # 配置
    ├── router/             # 路由配置
    │   └── index.ts
    ├── service/            # API 服務
    └── views/              # 頁面視圖
        ├── ball/           # 幸運轉球
        ├── box/            # 幸運盒子
        ├── card/           # 卡片
        ├── draw/           # 抽獎
        ├── form/           # 表單/訂閱
        └── record/         # 記錄
```

---

## 2. 路由配置

### 2.1 前端路由表

路由配置位於 [`resources/frontend/src/router/index.ts`](resources/frontend/src/router/index.ts)

| 路由 | 組件 | 說明 |
|------|------|------|
| `/` | form.vue | 首頁/表單頁面 |
| `/form` | form.vue | 訂閱表單 |
| `/form/result` | result.vue | 表單結果 |
| `/form/subscribe` | subscribe.vue | 訂閱頁面 |
| `/ball` | ball.vue | 幸運轉球 |
| `/box` | box.vue | 幸運盒子 |
| `/card` | card.vue | 卡片遊戲 |
| `/draw` | draw.vue | 抽獎活動 |
| `/record` | list.vue | 記錄列表 |
| `/record/success` | success.vue | 成功記錄 |
| `/record/fail` | fail.vue | 失敗記錄 |

### 2.2 路由特性

- 使用 Vue Router 4.x
- 所有頁面都是 LINE LIFF 內嵌頁面
- 主要用於 LINE OA 官方帳號內的互動遊戲

---

## 3. API 服務層

### 3.1 HTTP 客戶端

使用 **Axios** 作為 HTTP 客戶端，實例配置：

```typescript
// 基礎配置
{
  baseURL: '/api',  // 對應 Laravel API 路由
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
}
```

### 3.2 主要 API 模塊

API 服務位於 [`resources/frontend/src/service/`](resources/frontend/src/service/)

| 模塊 | 用途 |
|------|------|
| HTTP 客戶端封裝 | 統一的請求/響應處理 |
| 認證模塊 | JWT Token 管理 |
| LINE LIFF 模塊 | LIFF SDK 初始化 |

---

## 4. 頁面模塊詳解

### 4.1 表單模塊 (form/)

用於用戶資料收集和訂閱。

- `form.vue` - 主表單頁面
- `result.vue` - 結果顯示
- `subscribe.vue` - 訂閱確認

### 4.2 遊戲模塊

| 模塊 | 說明 |
|------|------|
| `ball/` | 幸運轉球遊戲 |
| `box/` | 幸運盒子開獎 |
| `card/` | 卡片翻牌遊戲 |
| `draw/` | 抽獎轉盤 |

### 4.3 記錄模塊 (record/)

用於顯示用戶的活動記錄。

- `list.vue` - 記錄列表
- `success.vue` - 成功記錄
- `fail.vue` - 失敗記錄

---

## 5. LINE LIFF 集成

### 5.1 LIFF SDK

```json
{
  "@line/liff": "^2.27.3"
}
```

### 5.2 LIFF 功能

- **用戶識別**：通過 LIFF 取得 LINE 用戶 ID
- **訊息分享**：使用 LIFF API 分享內容
- **應用內跳轉**：在 LINE 內開啟其他頁面

### 5.3 LIFF 視圖類型

在後端 [`config/liff.php`](config/liff.php) 中配置：

| 類型 | 尺寸 | 用途 |
|------|------|------|
| `compact` | 50% | 底部半屏 |
| `tall` | 80% | 大部分螢幕 |
| `full` | 100% | 全螢幕 |

---

## 6. 樣式與UI

### 6.1 CSS 框架

- **Tailwind CSS** v4.x
- 自定義樣式在 [`resources/frontend/src/style.css`](resources/frontend/src/style.css)

### 6.2 樣式特點

- 響應式設計
- 深色/淺色主題支援
- 移動端優化

---

## 7. 開發指南

### 7.1 安裝依賴

```bash
cd resources/frontend
npm install
```

### 7.2 開發模式

```bash
npm run dev
# 啟動開發服務器 http://localhost:3000
```

### 7.3 生產構建

```bash
npm run build
# 輸出到 public/web/
```

或使用生產模式：

```bash
npm run build:production
```

---

## 8. 與後端集成

### 8.1 API 路由前綴

所有 API 請求使用 `/api` 前綴，與 Laravel 路由 [`routes/api.php`](routes/api.php) 對應。

### 8.2 認證方式

- **JWT Token**：通過 `/api/token` 端點獲取
- **LINE User ID**：通過 LIFF SDK 獲取

### 8.3 CORS 配置

在 `vite.config.ts` 中配置代理：

```typescript
server: {
  proxy: {
    '/api': {
      target: 'https://your-backend.com',
      changeOrigin: true,
    }
  }
}
```

---

## 9. 部署

### 9.1 構建輸出

```
public/web/
├── index.html
├── assets/
│   ├── *.js
│   └── *.css
└── ...
```

### 9.2 部署路徑

訪問 URL：`https://your-domain.com/web/`

### 9.3 Nginx 配置

```nginx
location /web/ {
    try_files $uri $uri/ /web/index.html;
}
```

---

## 10. 依賴樹

```
resources/frontend/
├── vue (^3.4.21)
│   ├── @vue/reactivity
│   ├── @vue/runtime-core
│   └── @vue/runtime-dom
├── vue-router (^4.3.2)
├── axios (^1.8.2)
│   └── form-data
├── chinese-s2t (^1.0.0)    # 簡繁轉換
├── language-tw-loader      # 語系載入
├── vconsole (^3.15.1)     # 移動端調試
│
├── devDependencies
│   ├── vite (^5.4.19)
│   ├── @vitejs/plugin-vue
│   ├── typescript
│   └── vue-tsc
```

---

## 11. 總結

這是一個 **Monorepo** 架構：

- **後端**：Laravel (根目錄)
- **前端**：Vue 3 + TypeScript + Vite (`resources/frontend/`)
- **發布**：兩者構建後都在 `public/` 目錄

前端主要用於 LINE OA 內嵌遊戲和互動活動頁面，通過 LIFF SDK 與 LINE 平台深度集成。
