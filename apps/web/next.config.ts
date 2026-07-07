import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
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
