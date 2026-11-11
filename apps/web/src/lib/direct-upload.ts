/**
 * 直傳：檔案從瀏覽器直接上傳到 storage，不經過 API（change line-video-direct-upload）。
 * 用於超過一般上傳上限（25MB）的檔案，例如 LINE 影片（200MB）。
 *
 * 1. API 簽發上傳網址（檔案大小簽進網址，超過用途上限不簽發）
 * 2. PUT 到 storage
 * 3. API 檢查檔案內容，通過後轉成正式檔，回傳網址
 */
import axios from 'axios';
import api from './api';

export type DirectUploadPurpose = 'line-video';

export async function uploadDirect(
  file: File,
  purpose: DirectUploadPurpose,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const mimeType = file.type || 'application/octet-stream';
  const presign = await api.post('/files/presign-upload', { filename: file.name, mimeType, size: file.size, purpose });
  const { key, uploadUrl } = presign.data.data as { key: string; uploadUrl: string };

  // 用原生 axios，不用 api：api 會加上登入 token，storage 收到兩種驗證會拒收
  try {
    await axios.put(uploadUrl, file, {
      headers: { 'Content-Type': mimeType },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    throw new Error(status ? `上傳失敗（HTTP ${status}）` : '上傳失敗，請檢查網路連線後再試');
  }

  const done = await api.post('/files/complete-upload', { key, filename: file.name, mimeType, purpose });
  return (done.data.data as { url: string }).url;
}
