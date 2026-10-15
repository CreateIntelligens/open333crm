/**
 * 手冊第 07 章「AI 設定」影片與截圖（對 UAT 正式環境，只看不存）。
 * 不放行任何 POST/PUT。金鑰、服務網址、租戶自訂提示詞一律遮蔽。
 */
import { test, Page } from '@playwright/test';
import { startRecording, stopRecording, poster, caption, point, go, newShotPage } from './manual-video-helpers';
import { shot, shotPage } from './manual-helpers';

async function mask(page: Page) {
  await page.addStyleTag({
    content: `input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea{filter:blur(5px)!important}`,
  });
  await page.evaluate(() => {
    document.querySelectorAll('.font-mono').forEach((el) => {
      if (/AIza/.test(el.textContent || '')) el.textContent = 'AIza••••••••';
    });
  });
  await page.waitForTimeout(200);
}
const sec = (page: Page, title: string) =>
  page.getByText(title, { exact: true }).first().locator('xpath=ancestor::section[1]');

test('ch07-embedding Embedding 頁導覽', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch07-embedding');
  const { page } = rec;
  await go(page, '/dashboard/knowledge/embedding');
  await mask(page);
  await caption(page, '「Embedding」管 AI 怎麼讀懂文章');
  await point(page, sec(page, 'Ollama 服務狀態'), 1800);
  await caption(page, '先看這裡：連線正常、模型已安裝就好');
  await point(page, sec(page, '模型設定'), 1800);
  await caption(page, '模型設定平常不要動');
  await caption(page, '換模型後，全部文章都要重新讀一次', 2400);
  await point(page, sec(page, '語意搜尋參數'), 1800);
  await caption(page, '這兩個滑桿決定 AI 找幾篇、多相關才算');
  await point(page, sec(page, '批次重新嵌入'), 1800);
  await caption(page, '「未嵌入」不是 0，就按下方按鈕補做', 2400);
  await stopRecording(rec);
  poster('ch07-embedding', 2);
});

test('ch07-chat Chat & Prompt 頁導覽', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch07-chat');
  const { page } = rec;
  await go(page, '/dashboard/knowledge/chat-prompt');
  await mask(page);
  await caption(page, '「Chat & Prompt」管 AI 怎麼回話');
  await point(page, sec(page, '服務狀態'), 1600);
  await caption(page, '狀態「連線正常」代表 AI 能正常回覆');
  await point(page, sec(page, 'Provider 與模型'), 1800);
  await caption(page, '這裡選用哪一家、哪一個 AI 模型');
  await point(page, sec(page, '生成參數'), 1600);
  await caption(page, '回答要保守還是活潑、最長多少字');
  await point(page, sec(page, '客服回覆 System Prompt'), 1800);
  await caption(page, '提示詞＝給 AI 的工作守則');
  await point(page, page.getByRole('button', { name: '還原預設' }).first(), 1600);
  await caption(page, '改壞了？用「還原預設」找回原版', 2400);
  await point(page, sec(page, '多輪追問（Clarify）'), 1800);
  await caption(page, '問題不清楚時，AI 會先反問再回答', 2200);
  await stopRecording(rec);
  poster('ch07-chat', 2);
});

test('ch07 截圖', async ({ browser }) => {
  test.setTimeout(120000);
  const page = await newShotPage(browser);
  await go(page, '/dashboard/knowledge/embedding');
  await mask(page);
  await shot(page, sec(page, 'Ollama 服務狀態'), 'ch07-embedding-status');
  await shot(page, sec(page, '語意搜尋參數'), 'ch07-embedding-search');
  await shot(page, sec(page, '批次重新嵌入'), 'ch07-embedding-reembed');
  await go(page, '/dashboard/knowledge/chat-prompt');
  await mask(page);
  await shot(page, sec(page, 'Provider 與模型'), 'ch07-chat-provider');
  await shot(page, sec(page, '生成參數'), 'ch07-chat-params');
  await shot(page, sec(page, '客服回覆 System Prompt'), 'ch07-chat-prompt');
  await shot(page, sec(page, '多輪追問（Clarify）'), 'ch07-chat-clarify');
  // 一般客服視角：看得到選單，但打開是假的預設值（說明「這頁不是你的」）
  const agent = await newShotPage(browser, { storageState: 'auth-state-agent.json' });
  await go(agent, '/dashboard/knowledge/embedding');
  await agent.waitForTimeout(1500);
  await shotPage(agent, 'ch07-agent-view');
});
