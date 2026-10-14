'use client';

import { RegistrationForm, type RegistrationFormKind } from './RegistrationForm';

const EMAIL: RegistrationFormKind = {
  apiPath: 'email-registration',
  field: 'email',
  noun: ' email ',
  label: 'Email',
  input: { type: 'email', inputMode: 'email', autoComplete: 'email', placeholder: 'name@example.com' },
};

/**
 * 顧客的 email 登記頁（change add-email-identity-merge）。
 * 對應 API：GET／POST /public/email-registration/:token
 */
export function EmailRegistrationForm({ token }: { token: string }) {
  return <RegistrationForm kind={EMAIL} token={token} />;
}
