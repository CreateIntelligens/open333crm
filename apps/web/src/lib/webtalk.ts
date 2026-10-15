/**
 * WebTalk 協作工具列的載入、掛載與清除（change webtalk-multi-tenant）。
 *
 * SDK 網址、房間代號與 AI 端點都由 API 的 `GET /webtalk/session` 下發，前端不寫死任何值。
 * SDK 的行為（儲存位置、unmount 會清掉 window.WebTalk 等）來自原始碼研究，
 * 見 openspec/changes/webtalk-multi-tenant/design.md。
 */
import api from '@/lib/api';
import { API_BASE_URL } from '@/lib/constants';

export type WebTalkSession =
  | { enabled: false; reason: 'NOT_CONFIGURED' | 'TENANT_DISABLED' }
  | {
      enabled: true;
      roomId: string;
      sdkUrl: string;
      sdkIntegrity: string | null;
      aiEnabled: boolean;
      aiEndpoint: string | null;
    };

/** 傳給 SDK mount() 的選項。刻意不含 scope／siteId，避免 SDK 由網域推算出共用房間。 */
export interface WebTalkMountOptions {
  roomId: string;
  aiEndpoint: string;
  enableVirtualRoom: false;
}

export interface WebTalkApi {
  mount: (options: WebTalkMountOptions) => unknown;
  unmount: () => unknown;
}

export interface WebTalkOperator {
  id: string;
  name: string;
  avatar?: string | null;
}

declare global {
  interface Window {
    WebTalk?: WebTalkApi;
  }
}

/** SDK 在 localStorage 與 IndexedDB 的 key 都以此開頭 */
const WEBTALK_STORAGE_PREFIX = 'WEB_TALK_';
/** SDK 讀取使用者資料的位置（storage 區域 sync） */
const USER_INFO_KEY = 'WEB_TALK_WEB:sync:WEB_TALK_USER_INFO';
/** SDK 讀取頭像的位置（storage 區域 local） */
const USER_AVATARS_KEY = 'WEB_TALK_WEB:local:WEB_TALK_USER_AVATARS';
/** SDK 用 idb-keyval 的預設資料庫存聊天紀錄 */
const IDB_NAME = 'keyval-store';
const IDB_STORE = 'keyval';

let sdkLoadPromise: Promise<WebTalkApi['mount']> | null = null;
/** SDK 的 unmount() 會把 window.WebTalk 設為 undefined，所以保留第一次拿到的 mount 才能再次掛載 */
let cachedMount: WebTalkApi['mount'] | null = null;
/** 這個頁面是否載入過 SDK（SDK 載入時就連上信令伺服器，unmount 不會關閉） */
let sdkLoadedInPage = false;

/** @description 取得目前登入成員的 WebTalk session（房間代號與 SDK 設定）。 */
export async function fetchWebTalkSession(): Promise<WebTalkSession> {
  const res = await api.get('/webtalk/session');
  return res.data.data as WebTalkSession;
}

/** @description 租戶未開啟 AI 摘要時，SDK 的 AI 請求改打這個 CRM API 端點，端點一律回 403。 */
export function getWebTalkAiDisabledEndpoint(): string {
  return `${API_BASE_URL}/webtalk/ai-disabled`;
}

function findExistingScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>('script[data-open333-webtalk-sdk="true"]');
}

/**
 * @description 載入 WebTalk SDK（同一頁只插入一次 script），回傳可重複使用的 mount 函式。
 * @param src SDK 網址（來自 session）
 * @param integrity 選填的 SRI 雜湊
 */
export function loadWebTalkSdk(src: string, integrity: string | null): Promise<WebTalkApi['mount']> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('WebTalk SDK can only be loaded in the browser'));
  }
  if (cachedMount) return Promise.resolve(cachedMount);
  if (window.WebTalk?.mount) {
    cachedMount = window.WebTalk.mount;
    return Promise.resolve(cachedMount);
  }
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise<WebTalkApi['mount']>((resolve, reject) => {
    const existing = findExistingScript();
    const script = existing ?? document.createElement('script');

    if (!existing) {
      script.src = src;
      script.async = true;
      script.dataset.open333WebtalkSdk = 'true';
      script.dataset.webtalkAutoMount = 'false';
      if (integrity) {
        script.setAttribute('integrity', integrity);
        script.setAttribute('crossorigin', 'anonymous');
      }
    }

    const cleanup = () => {
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
    };

    const handleLoad = () => {
      cleanup();
      sdkLoadedInPage = true;
      const mount = window.WebTalk?.mount;
      if (!mount) {
        sdkLoadPromise = null;
        reject(new Error('WebTalk SDK is loaded but window.WebTalk.mount is unavailable'));
        return;
      }
      cachedMount = mount;
      resolve(mount);
    };

    const handleError = () => {
      cleanup();
      sdkLoadPromise = null;
      script.remove();
      reject(new Error('Failed to load WebTalk SDK'));
    };

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });

    if (!existing) {
      document.head.appendChild(script);
    }
  });

  return sdkLoadPromise;
}

function readJson(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * @description 在 mount 前把目前客服的 ID 與名稱寫進 SDK 讀取的使用者資料，讓同事看到本名。
 *   SDK 沒有帶入身分的選項，這依賴 SDK 的內部儲存格式；只是顯示用途，不是驗證。
 * @param operator 目前登入的成員
 */
export function seedWebTalkIdentity(operator: WebTalkOperator): void {
  try {
    const existing = readJson(USER_INFO_KEY) ?? {};
    const info = {
      // SDK 第一次建立使用者資料時的預設欄位
      createTime: Date.now(),
      language: 'auto',
      compatibilityMode: 'legacy',
      themeMode: 'system',
      developerMode: false,
      bannedUserIds: [],
      hideAllAiMessages: false,
      danmakuEnabled: true,
      notificationEnabled: true,
      notificationType: 'all',
      ...existing,
      id: operator.id,
      name: operator.name,
    };
    localStorage.setItem(USER_INFO_KEY, JSON.stringify(info));
    if (operator.avatar && /^https?:\/\//i.test(operator.avatar)) {
      localStorage.setItem(USER_AVATARS_KEY, JSON.stringify({ avatar: operator.avatar }));
    }
  } catch (error) {
    console.warn('Failed to seed WebTalk identity', error);
  }
}

/** 刪除 SDK 存在 IndexedDB 的聊天紀錄（只刪 WEB_TALK_ 開頭的 key，且資料庫不存在時不建立）。 */
async function clearWebTalkIndexedDb(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  if (typeof indexedDB.databases === 'function') {
    const databases = await indexedDB.databases();
    if (!databases.some((db) => db.name === IDB_NAME)) return;
  }
  await new Promise<void>((resolve) => {
    const request = indexedDB.open(IDB_NAME);
    request.onerror = () => resolve();
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.close();
        resolve();
        return;
      }
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const keysRequest = store.getAllKeys();
      keysRequest.onsuccess = () => {
        for (const key of keysRequest.result) {
          if (typeof key === 'string' && key.startsWith(WEBTALK_STORAGE_PREFIX)) store.delete(key);
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    };
  });
}

/**
 * @description 清除 SDK 在瀏覽器留下的資料：localStorage 與 IndexedDB 中 WEB_TALK_ 開頭的 key。
 *   其他功能的資料不受影響。
 */
export async function clearWebTalkLocalData(): Promise<void> {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(WEBTALK_STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch (error) {
    console.warn('Failed to clear WebTalk localStorage', error);
  }
  try {
    await clearWebTalkIndexedDb();
  } catch (error) {
    console.warn('Failed to clear WebTalk IndexedDB', error);
  }
}

/**
 * @description 卸載 WebTalk 並清除本機資料（離開後台、換帳號、登出時呼叫）。
 * @returns 這個頁面是否載入過 SDK；為 true 時登出應整頁導向，才能關閉 SDK 的信令連線
 */
export function teardownWebTalk(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    void window.WebTalk?.unmount();
  } catch (error) {
    console.warn('Failed to unmount WebTalk', error);
  }
  void clearWebTalkLocalData();
  return sdkLoadedInPage;
}

/** @description 整頁導向（結束 SDK 留在頁面上的 peer 與信令連線）。 */
export function navigateWithFullReload(path: string): void {
  window.location.assign(path);
}
