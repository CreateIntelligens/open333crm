import { getPublicRuntimeEndpoints } from '@open333crm/shared';

const publicRuntimeEndpoints = getPublicRuntimeEndpoints(process.env.NEXT_PUBLIC_API_URL);

export const API_BASE_URL = publicRuntimeEndpoints.apiBaseUrl;
export const REALTIME_ORIGIN = publicRuntimeEndpoints.realtimeOrigin;
