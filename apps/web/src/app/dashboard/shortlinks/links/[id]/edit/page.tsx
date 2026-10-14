'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { LinkForm } from '@/components/shortlink/LinkForm';
import { useShortLink } from '@/hooks/useShortLinks';

export default function EditShortLinkPage() {
  const { id } = useParams<{ id: string }>();
  const { link, isLoading, error } = useShortLink(id);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !link) {
    return (
      <div className="px-8 pt-8 text-sm text-muted-foreground">
        找不到這個短連結，可能已被刪除。
        <Link href="/dashboard/shortlinks/links" className="ml-2 text-primary hover:text-primary-hover">回連結管理</Link>
      </div>
    );
  }
  // key：換到另一筆時重新初始化表單
  return <LinkForm key={link.id} editData={link} />;
}
