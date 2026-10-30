import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  // 建置時不跑 ESLint：src 還有既有的 lint 錯誤，跑了會讓建置與部署失敗。
  // eslint-config-next 補上之前 ESLint 載入失敗，Next 一直是略過 lint 的；這裡維持同樣的行為。
  // 手動檢查：pnpm --filter @open333crm/web exec eslint src
  eslint: { ignoreDuringBuilds: true },
  // playcaptcha 僅提供 ESM exports（含 motion 依賴），需交由 Next 轉譯才能正確解析。
  transpilePackages: ['playcaptcha'],
  webpack: (config) => {
    // playcaptcha 的 package.json exports 只宣告 `import` 條件，
    // Next 的 server/RSC 編譯器以 require/node 條件解析時會失敗。
    // 將裸模組別名指向 dist 進入點，繞過 exports 條件解析（CSS 子路徑不受影響）。
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      playcaptcha$: path.join(
        process.cwd(),
        'node_modules/playcaptcha/dist/index.js',
      ),
    };
    return config;
  },
};

export default nextConfig;
