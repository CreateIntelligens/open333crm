/**
 * 假資料庫用的 AI 個資遮罩政策（platform_settings 的 `ai.privacy.<tenantId>`）。
 *
 * 呼叫端以 readAiPrivacyPolicy() 讀政策，再傳給 deidentification.service.ts 的遮罩函式。
 * 測的不是遮罩的測試，把 disabledAiPrivacy 展開到假資料庫裡：政策是關閉，遮罩函式不呼叫 2md。
 * 要測遮罩時改用 enabledAiPrivacy，並把 2md 換成假的 fetch。
 */
export const disabledAiPrivacy = {
  platformSetting: { findUnique: async () => null },
};

export const enabledAiPrivacy = {
  platformSetting: { findUnique: async () => ({ value: { enabled: true } }) },
};
