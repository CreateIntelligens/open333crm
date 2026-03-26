/**
 * WhatsApp HSM (Highly Structured Message) template submission & tracking (Task 2.4)
 * Integrates with Meta Graph API to submit and poll template approval status.
 */

import { logger } from '../logger/index.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type HsmStatus =
  | 'PENDING'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'DISABLED'
  | 'UNKNOWN';

export interface HsmComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO';
  text?: string;
  buttons?: HsmButton[];
}

export interface HsmButton {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
  text: string;
  url?: string;
  phone_number?: string;
}

export interface HsmSubmitPayload {
  templateName: string;           // Snake_case, no spaces
  language: string;               // e.g. 'zh_TW', 'en_US'
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  components: HsmComponent[];
}

export interface HsmSubmitResult {
  templateId: string;
  status: HsmStatus;
  metaTemplateId?: string;
}

export interface WhatsAppChannelCredentials {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;          // WhatsApp Business Account ID
}

// ── WhatsApp HSM Service ───────────────────────────────────────────────────

const META_GRAPH_BASE = 'https://graph.facebook.com/v19.0';

/**
 * Submit a WhatsApp HSM template to Meta for review.
 * Sets template status to PENDING_REVIEW in one's database after submission.
 *
 * @param credentials - Decrypted WhatsApp channel credentials
 * @param payload     - Template content to submit
 * @returns Submit result with Meta template ID and initial status
 */
export async function submitHsmTemplate(
  credentials: WhatsAppChannelCredentials,
  payload: HsmSubmitPayload,
): Promise<HsmSubmitResult> {
  const url = `${META_GRAPH_BASE}/${credentials.wabaId}/message_templates`;

  const body = {
    name: payload.templateName,
    language: payload.language,
    category: payload.category,
    components: payload.components,
  };

  logger.info(`[WhatsAppHSM] Submitting template "${payload.templateName}" to Meta...`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Meta HSM submit failed (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as { id: string; status: string };

  logger.info(`[WhatsAppHSM] Template submitted. Meta ID: ${data.id}, status: ${data.status}`);

  return {
    templateId: payload.templateName,
    status: (data.status as HsmStatus) ?? 'PENDING_REVIEW',
    metaTemplateId: data.id,
  };
}

/**
 * Poll the approval status of a submitted WhatsApp HSM template.
 *
 * @param credentials   - Decrypted WhatsApp channel credentials
 * @param templateName  - The template name (snake_case) to check
 * @returns Current approval status
 */
export async function pollHsmStatus(
  credentials: WhatsAppChannelCredentials,
  templateName: string,
): Promise<HsmStatus> {
  const url = `${META_GRAPH_BASE}/${credentials.wabaId}/message_templates?name=${encodeURIComponent(templateName)}&fields=name,status`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${credentials.accessToken}` },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Meta HSM poll failed (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as { data: Array<{ name: string; status: string }> };
  const template = data.data.find((t) => t.name === templateName);

  if (!template) return 'UNKNOWN';

  logger.debug(`[WhatsAppHSM] Template "${templateName}" status: ${template.status}`);

  return (template.status as HsmStatus) ?? 'UNKNOWN';
}
