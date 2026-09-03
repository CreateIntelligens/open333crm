export interface ChatboxFingerprint {
  browserFamily?: string;
  osFamily?: string;
  language?: string;
  timezone?: string;
  screenBucket?: string;
}

export interface SessionResult {
  sessionId: string;
  claimToken: string;
  expiresAt: string;
  greeting: string | null;
  theme: {
    backgroundImageUrl?: string | null;
    backgroundSize?: 'cover' | 'contain';
    backgroundPosition?: string;
  };
}

export interface Message {
  id?: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderType?: string;
  contentType: string;
  content: { text?: string; [key: string]: unknown };
  createdAt?: string;
}

function getBrowserFamily(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'edge';
  if (ua.includes('chrome/') || ua.includes('crios/')) return 'chrome';
  if (ua.includes('firefox/') || ua.includes('fxios/')) return 'firefox';
  if (ua.includes('safari/') || ua.includes('version/')) return 'safari';
  return 'unknown';
}

function getOsFamily(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

export function getBrowserFingerprint(): ChatboxFingerprint {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const width = typeof screen === 'undefined' ? 0 : screen.width;
  const screenBucket = width >= 1280 ? 'xl' : width >= 768 ? 'lg' : width >= 480 ? 'md' : 'sm';
  let timezone = 'unknown';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone;
  } catch {
    // Keep the coarse fallback when the browser does not expose timezone data.
  }

  return {
    browserFamily: getBrowserFamily(userAgent),
    osFamily: getOsFamily(userAgent),
    language: typeof navigator === 'undefined' ? 'unknown' : navigator.language,
    timezone,
    screenBucket,
  };
}

interface SessionResponse {
  sessionId: string;
  config?: {
    greeting?: string | null;
    theme?: SessionResult['theme'];
  };
  expiresAt?: string;
}

interface VerifyResponse {
  claimToken: string;
  session: { expiresAt: string };
  config: {
    greeting?: string | null;
    theme?: SessionResult['theme'];
  };
}

export async function initSession(
  apiBaseUrl: string,
  channelPublicKey: string,
  fingerprint = getBrowserFingerprint(),
): Promise<SessionResult> {
  const createRes = await fetch(`${apiBaseUrl}/chatbox/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: channelPublicKey, fingerprint }),
  });

  if (!createRes.ok) throw new Error(`Session init failed: ${createRes.status}`);
  const created = await createRes.json() as { data: SessionResponse };
  if (!created.data?.sessionId) throw new Error('Session init returned no sessionId');

  const verifyRes = await fetch(`${apiBaseUrl}/chatbox/sessions/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: created.data.sessionId, fingerprint }),
  });

  if (!verifyRes.ok) throw new Error(`Session verification failed: ${verifyRes.status}`);
  const verified = await verifyRes.json() as { data: VerifyResponse };
  if (!verified.data?.claimToken || !verified.data.session?.expiresAt) {
    throw new Error('Session verification returned no claim');
  }

  return {
    sessionId: created.data.sessionId,
    claimToken: verified.data.claimToken,
    expiresAt: verified.data.session.expiresAt,
    greeting: verified.data.config.greeting ?? created.data.config?.greeting ?? null,
    theme: verified.data.config.theme ?? created.data.config?.theme ?? {},
  };
}
