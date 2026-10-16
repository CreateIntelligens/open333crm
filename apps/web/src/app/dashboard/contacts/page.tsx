'use client';

import React, { useState } from 'react';
import { useContacts } from '@/hooks/useContacts';
import { ContactList } from '@/components/contact/ContactList';
import { SearchInput } from '@/components/shared/SearchInput';
import { Pagination } from '@/components/shared/Pagination';
import { Topbar } from '@/components/layout/Topbar';

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;
  const { contacts, meta, isLoading } = useContacts({
    q: search || undefined,
    excludeChannelType: 'WEBCHAT',
    page,
    limit,
  });

  const total = meta?.total ?? 0;
  const currentPage = meta?.page ?? page;
  const pageLimit = meta?.limit ?? limit;
  const totalPages = meta?.totalPages ?? 1;
  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageLimit + 1;
  const rangeEnd = Math.min(currentPage * pageLimit, total);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  // 版面依 Figma 4.1.1 聯繫人
  return (
    <div className="flex h-full flex-col">
      {/* 說明文字：Figma 4.1.1 是從人員管理頁複製來的佔位文字，這裡改成聯繫人的說明 */}
      <Topbar title="聯繫人" description="所有從各渠道傳訊息進來的客人，跨渠道的同一位客人會合併成一筆">
        <SearchInput placeholder="搜尋聯繫人" onSearch={handleSearch} className="w-[337px]" />
      </Topbar>
      <div className="flex-1 overflow-auto px-8 pb-8">
        <ContactList contacts={contacts} isLoading={isLoading} />
        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-7 pl-3 pt-5">
            <span className="text-base font-medium text-muted-foreground">
              顯示 {rangeStart}-{rangeEnd} 筆，共 {total} 筆
            </span>
            {totalPages > 1 && <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />}
          </div>
        )}
      </div>
    </div>
  );
}
