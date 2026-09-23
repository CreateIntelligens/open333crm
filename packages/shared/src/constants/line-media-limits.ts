/**
 * LINE 平台的媒體規格限制（單一事實來源）。
 *
 * 來源：LINE Messaging API 官方文件
 *   - Requirements for rich menu image
 *   - Video message（originalContentUrl / previewImageUrl）
 *
 * 為什麼要集中：這些是「LINE 端會退件」的硬限制，但我們的上傳端點
 * （/files/upload 通用政策，25MB）比它寬鬆得多。若只靠後端上傳擋，
 * 使用者會看到「上傳成功」，直到按下發布才收到 LINE 的 400——
 * 白做工，而且錯誤時機晚、訊息難懂。
 *
 * 前端在選檔當下就用這組常數擋，後端發布前再驗一次（雙層防護）。
 */

// ─── Rich Menu 背景圖 ──────────────────────────────────────────────────────

/** Rich Menu 背景圖大小上限：1 MB */
export const LINE_RICH_MENU_MAX_IMAGE_BYTES = 1024 * 1024;

/** Rich Menu 背景圖可接受的格式 */
export const LINE_RICH_MENU_IMAGE_MIMES = ['image/jpeg', 'image/png'] as const;

/** Rich Menu 圖片寬度範圍（px） */
export const LINE_RICH_MENU_MIN_WIDTH = 800;
export const LINE_RICH_MENU_MAX_WIDTH = 2500;

/** Rich Menu 圖片最小高度（px） */
export const LINE_RICH_MENU_MIN_HEIGHT = 250;

/** Rich Menu 圖片最小寬高比（width / height） */
export const LINE_RICH_MENU_MIN_ASPECT_RATIO = 1.45;

// ─── Video message ────────────────────────────────────────────────────────

/** 影片檔大小上限：200 MB */
export const LINE_VIDEO_MAX_BYTES = 200 * 1024 * 1024;

/** 影片預覽圖大小上限：1 MB */
export const LINE_VIDEO_PREVIEW_MAX_BYTES = 1024 * 1024;

/** originalContentUrl / previewImageUrl 的字元上限 */
export const LINE_MEDIA_URL_MAX_LENGTH = 2000;

/**
 * 常見的「影片分享網頁」網域——這些是網頁而非影片檔，LINE 無法播放。
 *
 * LINE 的 video message 要求 `originalContentUrl` 是可直接下載的 mp4 檔
 * （Protocol: HTTPS、Video format: mp4）。使用者最常見的誤用就是
 * 直接貼 YouTube 連結，訊息會送出成功但點開播不動。
 */
export const NON_DIRECT_VIDEO_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'vimeo.com',
  'www.vimeo.com',
  'player.vimeo.com',
  'dailymotion.com',
  'www.dailymotion.com',
  'facebook.com',
  'www.facebook.com',
  'fb.watch',
  'tiktok.com',
  'www.tiktok.com',
  'instagram.com',
  'www.instagram.com',
  'twitch.tv',
  'www.twitch.tv',
  'bilibili.com',
  'www.bilibili.com',
  'drive.google.com',
] as const;

/**
 * 檢查影片網址是否為 LINE 可播放的直接 mp4 連結。
 *
 * 回傳 null 表示通過；否則回傳「為什麼不行」的中文訊息。
 *
 * 判斷順序刻意這樣排：先擋掉已知的影片網站（訊息最明確、最常見），
 * 再檢查協定與副檔名。
 */
export function validateLineVideoUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return '請填入影片網址';

  if (trimmed.length > LINE_MEDIA_URL_MAX_LENGTH) {
    return `影片網址不可超過 ${LINE_MEDIA_URL_MAX_LENGTH} 字`;
  }

  // 這個套件同時供 Node 與瀏覽器使用，tsconfig 未帶 DOM lib，
  // 故以正規表達式拆解而非依賴全域的 URL 建構式。
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)/i.exec(trimmed);
  if (!m) {
    return '影片網址格式不正確，請填入完整網址（https://...）';
  }
  const [, scheme, hostPort, pathname] = m;

  // LINE 要求 HTTPS（TLS 1.2 以上）
  if (scheme.toLowerCase() !== 'https') {
    return 'LINE 要求影片網址必須是 HTTPS';
  }

  // 去掉可能的 port 與使用者資訊
  const host = hostPort.toLowerCase().replace(/^.*@/, '').replace(/:\d+$/, '');
  if ((NON_DIRECT_VIDEO_HOSTS as readonly string[]).includes(host)) {
    return (
      `LINE 無法播放 ${host} 的分享連結——那是網頁，不是影片檔。` +
      '請改用可直接下載的 mp4 網址（網址結尾為 .mp4），' +
      '或先把影片上傳到自己的空間再貼上該檔案網址。'
    );
  }

  // 直接 mp4 連結：路徑應以 .mp4 結尾（允許帶 query string，如簽章網址）
  if (!/\.mp4$/i.test(pathname)) {
    return (
      'LINE 只支援 mp4 格式的影片檔，網址路徑需以 .mp4 結尾。' +
      '若這是影片分享頁的連結，請改用可直接下載的檔案網址。'
    );
  }

  return null;
}
