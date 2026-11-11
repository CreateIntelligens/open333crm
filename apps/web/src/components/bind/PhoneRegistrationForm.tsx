'use client';

import { RegistrationForm, type RegistrationFormKind } from './RegistrationForm';

const PHONE: RegistrationFormKind = {
  apiPath: 'phone-registration',
  field: 'phone',
  noun: '手機號碼',
  label: '手機號碼',
  input: { type: 'tel', inputMode: 'tel', autoComplete: 'tel', placeholder: '0912345678' },
};

/**
 * 顧客的手機登記頁（change add-phone-identity-merge）。只接受台灣手機，格式由後端統一。
 * 對應 API：GET／POST /public/phone-registration/:token
 */
export function PhoneRegistrationForm({ token }: { token: string }) {
  return <RegistrationForm kind={PHONE} token={token} />;
}
