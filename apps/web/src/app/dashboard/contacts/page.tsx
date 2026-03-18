'use client';

import React, { useState } from 'react';
import { useContacts } from '@/hooks/useContacts';
import { ContactList } from '@/components/contact/ContactList';
import { SearchInput } from '@/components/shared/SearchInput';
import { Topbar } from '@/components/layout/Topbar';

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const { contacts, isLoading } = useContacts({ q: search || undefined });

  return (
    <div className="flex h-full flex-col">
      <Topbar title="聯繫人">
        <SearchInput
          placeholder="搜尋聯繫人..."
          onSearch={setSearch}
          className="w-64"
        />
      </Topbar>
      <div className="flex-1 overflow-auto">
        <ContactList contacts={contacts} isLoading={isLoading} />
      </div>
    </div>
  );
}
