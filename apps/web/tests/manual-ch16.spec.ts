/**
 * 手冊第 16 章「人員、角色與權限」影片與截圖。
 * ⚠️ 正式環境：只開對話框、填示範文字、按「取消」。不按建立／儲存／停用／刪除／更新密碼／繼續綁定。
 */
import { test, Page } from '@playwright/test';
import { startRecording, stopRecording, poster, caption, point, tap, typeIn, go, newShotPage } from './manual-video-helpers';
import { shot } from './manual-helpers';

/** 去識別化：糊掉真人姓名與個人裝置名稱、隱藏 [E2E] 測試資料 */
async function scrub(page: Page) {
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const run = () => {
      const leaves = [...document.querySelectorAll('main *, [role="dialog"] *')].filter((e) => e.children.length === 0);
      for (const el of leaves) {
        const t = (el.textContent || '').trim();
        if (/^Daniel$|david|tatung|大同/i.test(t)) (el as HTMLElement).style.filter = 'blur(6px)';
        if (t.startsWith('[E2E]')) {
          const box = (el.closest('tr, li, .grid > div') || el.closest('div.rounded-lg.border')) as HTMLElement | null;
          if (box) box.style.display = 'none';
        }
      }
    };
    run();
    if (!(window as any).__scrubObs) {
      (window as any).__scrubObs = new MutationObserver(() => run());
      (window as any).__scrubObs.observe(document.body, { childList: true, subtree: true });
    }
  });
}

test('ch16-agent-add 新增人員', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch16-agent-add');
  const { page } = rec;
  await go(page, '/dashboard/settings/agents');
  await scrub(page);
  await caption(page, '這是人員管理，列出所有成員');
  await point(page, page.getByRole('columnheader', { name: '角色' }).or(page.getByText('開啟案件')).first());
  await caption(page, '上方按鈕可依角色篩選', 1200);
  await tap(page, page.getByRole('button', { name: /^SUPERVISOR\s*\d+$/ }));
  await tap(page, page.getByRole('button', { name: /^全部\s*\d+$/ }));
  await caption(page, '按右上「新增人員」', 1200);
  await tap(page, page.getByRole('button', { name: '新增人員' }));
  // 對話框很高，字幕移到左下側欄區，避免被對話框蓋住
  await page.addStyleTag({ content: '#mv-cap{left:24px!important;transform:none!important;max-width:300px!important}' });
  const dlg = page.getByRole('dialog');
  await caption(page, '填姓名與登入用的電子信箱', 800);
  await typeIn(page, dlg.getByPlaceholder('王小明'), '範例：王小明');
  await typeIn(page, dlg.getByPlaceholder('agent@example.com'), 'demo@example.com');
  await caption(page, '選角色，決定他能做哪些事', 1000);
  await point(page, dlg.locator('select'));
  await dlg.locator('select').selectOption({ label: 'Supervisor' });
  await page.waitForTimeout(900);
  await caption(page, '設一組至少 8 個字的初始密碼', 800);
  await typeIn(page, dlg.getByPlaceholder('至少 8 個字元'), 'example-only');
  await caption(page, '勾選他看得到哪些渠道', 1000);
  await point(page, dlg.getByText('看得到哪些渠道'), 1800);
  await caption(page, '確認無誤再按建立；示範按取消', 1200);
  await tap(page, dlg.getByRole('button', { name: '取消', exact: true }));
  await caption(page, '', 400);
  await stopRecording(rec);
  poster('ch16-agent-add', 2);
});

test('ch16-agent-edit 編輯人員', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch16-agent-edit');
  const { page } = rec;
  await go(page, '/dashboard/settings/agents');
  await scrub(page);
  await caption(page, '要調整某位成員，按他那列的「編輯」', 1200);
  await tap(page, page.locator('div.border-b', { hasText: 'agent@open333crm.dev' }).getByRole('button', { name: '編輯' }), 2000);
  const dlg = page.getByRole('dialog');
  await caption(page, '可以換角色', 800);
  await point(page, dlg.locator('select'), 1600);
  await caption(page, '成員忘記密碼時，在這裡設新密碼', 800);
  await point(page, dlg.locator('input').first(), 1800);
  await caption(page, '勾選他可使用的渠道', 800);
  await point(page, dlg.getByText('可使用的渠道'), 1800);
  await caption(page, '左下是停用與刪除，請謹慎', 800);
  await point(page, dlg.getByRole('button', { name: '停用' }), 1600);
  await caption(page, '示範不改任何東西，按取消', 1000);
  await tap(page, dlg.getByRole('button', { name: '取消', exact: true }));
  await stopRecording(rec);
  poster('ch16-agent-edit', 2);
});

test('ch16-roles 角色與權限', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch16-roles');
  const { page } = rec;
  await go(page, '/dashboard/settings/roles');
  await caption(page, '左邊是角色，右邊是這個角色的權限');
  await caption(page, '點「Supervisor」看主管能做什麼', 800);
  await tap(page, page.getByText('Supervisor', { exact: true }).first(), 1800);
  await caption(page, '有打勾的，就是這個角色能做的事', 2400);
  await caption(page, '權限很多時，用搜尋找', 800);
  await typeIn(page, page.getByPlaceholder('搜尋權限…'), '標籤');
  await page.waitForTimeout(1200);
  await caption(page, '也可以只看已開的項目', 800);
  await tap(page, page.getByRole('button', { name: '只看已開' }), 1500);
  await page.getByPlaceholder('搜尋權限…').fill('');
  await tap(page, page.getByRole('button', { name: '全部', exact: true }), 1000);
  await caption(page, '要新增自訂角色，按「＋ 新增角色」', 800);
  await tap(page, page.getByRole('button', { name: '＋ 新增角色' }));
  const dlg = page.getByRole('dialog');
  await typeIn(page, dlg.getByPlaceholder('例如：客服組長、行銷專員'), '範例：客服組長');
  await caption(page, '建立後再到右邊勾權限；示範按取消', 1200);
  await tap(page, dlg.getByRole('button', { name: '取消', exact: true }));
  await stopRecording(rec);
  poster('ch16-roles', 2);
});

test('ch16-password 修改自己的密碼', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch16-password');
  const { page } = rec;
  await go(page, '/dashboard/settings/general');
  await caption(page, '一般設定是你自己的帳號頁');
  await point(page, page.getByRole('heading', { name: '個人資料' }), 1200);
  await caption(page, '姓名、信箱、角色由管理員維護', 1800);
  await caption(page, '在下方修改自己的密碼', 800);
  await typeIn(page, page.getByLabel('目前密碼'), 'example-only');
  await typeIn(page, page.getByLabel('新密碼', { exact: true }), 'example-new-1');
  await typeIn(page, page.getByLabel('確認新密碼'), 'example-new-1');
  await caption(page, '填好按「更新密碼」；示範不送出', 1000);
  await point(page, page.getByRole('button', { name: '更新密碼' }), 1800);
  await stopRecording(rec);
  poster('ch16-password', 2);
});

test('ch16-passkey 綁定 Passkey', async ({ browser }) => {
  const rec = await startRecording(browser, 'ch16-passkey');
  const { page } = rec;
  await go(page, '/dashboard/settings/passkeys');
  await scrub(page);
  await caption(page, '綁定後，登入可以用指紋或臉部辨識');
  await caption(page, '按「綁定 Passkey」', 800);
  await tap(page, page.getByRole('button', { name: '綁定 Passkey' }));
  const dlg = page.getByRole('dialog');
  await caption(page, '幫這台裝置取個好認的名字', 800);
  await typeIn(page, dlg.getByLabel('裝置名稱'), '範例：公司筆電');
  await caption(page, '按「繼續綁定」後會跳出裝置驗證', 2200);
  await caption(page, '示範到這裡，按取消', 800);
  await tap(page, dlg.getByRole('button', { name: '取消', exact: true }));
  await caption(page, '綁好的裝置會列在下方，可改名或撤銷', 2200);
  await stopRecording(rec);
  poster('ch16-passkey', 2);
});

test('ch16 截圖', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newShotPage(browser);
  page.on('dialog', (d) => d.dismiss());

  await go(page, '/dashboard/settings/agents');
  await scrub(page);
  await shot(page, page.locator('main'), 'ch16-agents');
  await page.getByRole('button', { name: '新增人員' }).click();
  await page.waitForTimeout(2500);
  await shot(page, page.getByRole('dialog'), 'ch16-agent-add');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '編輯' }).nth(1).click();
  await page.waitForTimeout(3000);
  await shot(page, page.getByRole('dialog'), 'ch16-agent-edit');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();

  await go(page, '/dashboard/settings/roles');
  await page.getByText('Supervisor', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await shot(page, page.locator('main'), 'ch16-roles');

  await go(page, '/dashboard/settings/general');
  await shot(page, page.locator('main'), 'ch16-general');

  await go(page, '/dashboard/settings/passkeys');
  await scrub(page);
  await shot(page, page.locator('main'), 'ch16-passkeys');
});
