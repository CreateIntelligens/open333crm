const STORAGE_KEY = 'open333crm_visitor';

export interface SessionResult {
  visitorToken: string;
  greeting: string | null;
}

export interface Message {
  id?: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderType?: string;
  contentType: string;
  content: { text?: string; [key: string]: unknown };
  createdAt?: string;
}

function getOrCreateToken(): string {
  let token = sessionStorage.getItem(STORAGE_KEY);
  if (!token || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    token = crypto.randomUUID();
    sessionStorage.setItem(STORAGE_KEY, token);
  }
  return token;
}

export async function initSession(apiUrl: string, channelId: string): Promise<SessionResult> {
  const visitorToken = getOrCreateToken();

  const res = await fetch(`${apiUrl}/api/v1/webchat/${channelId}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitorToken }),
  });

  if (!res.ok) throw new Error(`Session init failed: ${res.status}`);

  const data = await res.json() as { data: { greeting: string | null } };
  return { greeting: data.data.greeting, visitorToken };
}
