'use client';

import { useParams } from 'next/navigation';
import { EmailRegistrationForm } from '@/components/bind/EmailRegistrationForm';

/** 顧客的 email 登記頁（公開頁，不需登入；change add-email-identity-merge） */
export default function EmailRegistrationPage() {
  const params = useParams();
  return <EmailRegistrationForm token={String(params.token ?? '')} />;
}
