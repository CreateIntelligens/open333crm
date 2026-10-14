'use client';

import { useParams } from 'next/navigation';
import { PhoneRegistrationForm } from '@/components/bind/PhoneRegistrationForm';

/** 顧客的手機登記頁（公開頁，不需登入；change add-phone-identity-merge） */
export default function PhoneRegistrationPage() {
  const params = useParams();
  return <PhoneRegistrationForm token={String(params.token ?? '')} />;
}
