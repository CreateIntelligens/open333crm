export const WEBTALK_SCRIPT_SRC = 'https://webtalk-nine.vercel.app/webtalk.js';
export const WEBTALK_AI_ENDPOINT = 'https://webtalk-nine.vercel.app/api/webtalk/ai';

export interface WebTalkMountOptions {
  scope: 'origin';
  siteId: string;
  enableVirtualRoom: boolean;
}

export interface WebTalkApi {
  mount: (options: WebTalkMountOptions) => void | Promise<void>;
  unmount: () => void | Promise<void>;
}

declare global {
  interface Window {
    WebTalk?: WebTalkApi;
  }
}

export const WEBTALK_MOUNT_OPTIONS: WebTalkMountOptions = {
  scope: 'origin',
  siteId: 'open333crm-uat',
  enableVirtualRoom: false,
};

let sdkLoadPromise: Promise<void> | null = null;

function findExistingScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>(
    `script[data-open333-webtalk-sdk="true"], script[src="${WEBTALK_SCRIPT_SRC}"]`,
  );
}

export function loadWebTalkSdk(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('WebTalk SDK can only be loaded in the browser'));
  }

  if (window.WebTalk?.mount) {
    return Promise.resolve();
  }

  if (sdkLoadPromise) {
    return sdkLoadPromise;
  }

  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = findExistingScript();
    const script = existing ?? document.createElement('script');

    script.src = WEBTALK_SCRIPT_SRC;
    script.async = true;
    script.dataset.open333WebtalkSdk = 'true';
    script.dataset.webtalkAutoMount = 'false';
    script.dataset.webtalkAiEndpoint = WEBTALK_AI_ENDPOINT;

    const cleanup = () => {
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
    };

    const handleLoad = () => {
      script.dataset.webtalkLoaded = 'true';
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      sdkLoadPromise = null;
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

export function unmountWebTalk(): void {
  if (typeof window === 'undefined') return;

  try {
    void window.WebTalk?.unmount();
  } catch (error) {
    console.warn('Failed to unmount WebTalk', error);
  }
}
