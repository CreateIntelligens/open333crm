const DEFAULT_PUBLIC_API_URL = 'http://localhost:3001/api/v1';
const API_V1_PATH = '/api/v1';
const API_PATH = '/api';

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function normalizePublicApiUrl(value?: string): string {
  const normalizedValue = stripTrailingSlash(value || DEFAULT_PUBLIC_API_URL);

  if (normalizedValue.endsWith(API_V1_PATH)) {
    return normalizedValue;
  }

  if (normalizedValue.endsWith(API_PATH)) {
    return `${normalizedValue}/v1`;
  }

  if (/^[a-z]+:\/\/[^/]+$/i.test(normalizedValue)) {
    return `${normalizedValue}${API_V1_PATH}`;
  }

  return normalizedValue;
}

export function getRealtimeOrigin(apiBaseUrl: string): string {
  const normalizedApiBaseUrl = normalizePublicApiUrl(apiBaseUrl);
  const match = normalizedApiBaseUrl.match(/^[a-z]+:\/\/[^/]+/i);

  if (match) {
    return match[0];
  }

  return normalizedApiBaseUrl.replace(/\/api\/v1$/, '');
}

export interface PublicRuntimeEndpoints {
  apiBaseUrl: string;
  realtimeOrigin: string;
}

export function getPublicRuntimeEndpoints(value?: string): PublicRuntimeEndpoints {
  const apiBaseUrl = normalizePublicApiUrl(value);

  return {
    apiBaseUrl,
    realtimeOrigin: getRealtimeOrigin(apiBaseUrl),
  };
}
