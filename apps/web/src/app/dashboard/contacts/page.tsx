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

  return (
    <div className="flex h-full flex-col">
      <Topbar title="聯繫人">
        <SearchInput
          placeholder="搜尋聯繫人..."
          onSearch={handleSearch}
          className="w-64"
        />
      </Topbar>
      <div className="flex-1 overflow-auto">
        <ContactList contacts={contacts} isLoading={isLoading} />
      </div>
      {total > 0 ? (
        <div className="flex flex-col gap-3 border-t bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            第 {rangeStart}-{rangeEnd} / 共 {total} 筆
          </div>
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setPage}
            className="justify-start sm:justify-center"
          />
        </div>
      ) : null}
    </div>
  );
}
