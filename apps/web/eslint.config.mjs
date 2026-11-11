import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";

// eslint-config-next 15 只提供舊格式（eslintrc）設定，以 FlatCompat 轉成 flat config。
// 版本跟 next 一致；升到 Next 16 後可改回直接 import eslint-config-next/core-web-vitals。
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const eslintConfig = defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/**"]),
]);

export default eslintConfig;
