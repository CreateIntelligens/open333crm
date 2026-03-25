'use client';

import React, { useState } from 'react';
import { Topbar } from '@/components/layout/Topbar';
import { ChannelManagement } from '@/components/settings/ChannelManagement';
import { AgentManagement } from '@/components/settings/AgentManagement';
import { TagManagement } from '@/components/settings/TagManagement';
import { SlaManagement } from '@/components/settings/SlaManagement';
import { GeneralSettings } from '@/components/settings/GeneralSettings';
import { OfficeHoursSettings } from '@/components/settings/OfficeHoursSettings';

const SETTINGS_TABS = [
  { key: 'channels', label: '渠道管理' },
  { key: 'agents', label: '人員與權限' },
  { key: 'tags', label: '標籤管理' },
  { key: 'sla', label: 'SLA 政策' },
  { key: 'office-hours', label: '營業時間' },
  { key: 'general', label: '一般設定' },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]['key'];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('channels');

  return (
    <div className="flex h-full flex-col">
      <Topbar title="設定" />

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar navigation */}
        <nav className="w-48 shrink-0 border-r bg-muted/30 p-3 overflow-y-auto">
          <ul className="space-y-0.5">
            {SETTINGS_TABS.map((tab) => (
              <li key={tab.key}>
                <button
                  onClick={() => setActiveTab(tab.key)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
                    activeTab === tab.key
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Right content area */}
        <div className="flex-1 overflow-auto p-6">
          {activeTab === 'channels' && <ChannelManagement />}
          {activeTab === 'agents' && <AgentManagement />}
          {activeTab === 'tags' && <TagManagement />}
          {activeTab === 'sla' && <SlaManagement />}
          {activeTab === 'office-hours' && <OfficeHoursSettings />}
          {activeTab === 'general' && <GeneralSettings />}
        </div>
      </div>
    </div>
  );
}
