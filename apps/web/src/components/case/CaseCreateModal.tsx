'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import api from '@/lib/api';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface CaseCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId?: string;
  contactName?: string;
  contactId?: string;
  channelType?: string;
  conversationTime?: string;
}

interface ContactOption {
  id: string;
  displayName: string;
  phone?: string;
  email?: string;
}

interface AgentOption {
  id: string;
  name: string;
  teamId?: string;
  team?: { id: string; name: string } | null;
}

interface SlaPolicy {
  id: string;
  name: string;
  priority: string;
}

interface ChannelOption {
  id: string;
  name: string;
  type: string;
}

const PRIORITIES = [
  { value: 'LOW', label: '低' },
  { value: 'MEDIUM', label: '中' },
  { value: 'HIGH', label: '高' },
  { value: 'URGENT', label: '緊急' },
];

const CATEGORIES = [
  { value: '維修', label: '維修' },
  { value: '查詢', label: '查詢' },
  { value: '投訴', label: '投訴' },
  { value: '其他', label: '其他' },
];

// Field components — visually match Figma "Form / Variable Input"
function FormField({
  label,
  required,
  wordLimit,
  children,
}: {
  label: string;
  required?: boolean;
  wordLimit?: { current: number; max: number };
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 px-0 py-1">
        <span className="text-[14px] font-medium leading-5 text-ink">{label}</span>
        {required && <span className="text-[14px] font-medium leading-5 text-[#EE3134]">*</span>}
      </div>
      {children}
      {wordLimit && (
        <div className="flex items-center justify-end px-1 py-0">
          <span className="text-[12px] font-medium leading-6 text-[#C1C1C1]">
            {wordLimit.current}/{wordLimit.max}
          </span>
        </div>
      )}
    </div>
  );
}

function FieldInput({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <div
      className={cn(
        'flex h-12 items-center gap-1 rounded-card border px-4',
        disabled
          ? 'border-transparent bg-[#F5F5F5]'
          : 'border-surface-line bg-white',
      )}
    >
      {children}
    </div>
  );
}

export function CaseCreateModal({
  open,
  onOpenChange,
  conversationId,
  contactName,
  contactId,
  channelType,
  conversationTime,
}: CaseCreateModalProps) {
  const router = useRouter();
  const isFromInbox = !!conversationId;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [category, setCategory] = useState('');
  const [selectedContactId, setSelectedContactId] = useState(contactId || '');
  const [assigneeId, setAssigneeId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [contactSearch, setContactSearch] = useState('');
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([]);
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const [selectedContactName, setSelectedContactName] = useState(contactName || '');

  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [slaPolicies, setSlaPolicies] = useState<SlaPolicy[]>([]);
  const [channels, setChannels] = useState<ChannelOption[]>([]);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      api.get('/agents').catch(() => ({ data: { data: [] } })),
      api.get('/sla-policies').catch(() => ({ data: { data: [] } })),
      api.get('/channels').catch(() => ({ data: { data: [] } })),
    ]).then(([agentsRes, slaRes, channelsRes]) => {
      setAgents(agentsRes.data.data || []);
      setSlaPolicies(slaRes.data.data || []);
      setChannels(channelsRes.data.data || []);
    });
  }, [open]);

  useEffect(() => {
    if (contactId) setSelectedContactId(contactId);
    if (contactName) setSelectedContactName(contactName);
  }, [contactId, contactName]);

  const searchContacts = useCallback(async (q: string) => {
    if (!q || q.length < 2) {
      setContactOptions([]);
      return;
    }
    try {
      const res = await api.get(`/contacts?q=${encodeURIComponent(q)}&limit=10`);
      setContactOptions(res.data.data || []);
    } catch {
      setContactOptions([]);
    }
  }, []);

  useEffect(() => {
    if (isFromInbox) return;
    const timer = setTimeout(() => searchContacts(contactSearch), 300);
    return () => clearTimeout(timer);
  }, [contactSearch, searchContacts, isFromInbox]);

  const teams = agents.reduce<Array<{ id: string; name: string }>>((acc, a) => {
    const tid = a.teamId || a.team?.id;
    const tname = a.team?.name;
    if (tid && tname && !acc.find((t) => t.id === tid)) {
      acc.push({ id: tid, name: tname });
    }
    return acc;
  }, []);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setPriority('MEDIUM');
    setCategory('');
    if (!isFromInbox) {
      setSelectedContactId('');
      setSelectedContactName('');
    }
    setAssigneeId('');
    setTeamId('');
    setError('');
    setContactSearch('');
    setContactOptions([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('請輸入案件標題');
      return;
    }
    if (!selectedContactId && !isFromInbox) {
      setError('請選擇聯繫人');
      return;
    }
    if (!category) {
      setError('請選擇分類');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      let caseId: string;

      if (isFromInbox && conversationId) {
        const res = await api.post(`/cases/from-conversation/${conversationId}`, {
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          category,
          assigneeId: assigneeId || undefined,
          teamId: teamId || undefined,
        });
        caseId = res.data.data?.id;
      } else {
        const effectiveChannelId = channels[0]?.id;
        if (!effectiveChannelId) {
          setError('系統尚無可用渠道，請先建立渠道');
          setIsSubmitting(false);
          return;
        }
        const res = await api.post('/cases', {
          contactId: selectedContactId,
          channelId: effectiveChannelId,
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          category,
          assigneeId: assigneeId || undefined,
          teamId: teamId || undefined,
        });
        caseId = res.data.data?.id;
      }

      onOpenChange(false);
      resetForm();
      if (caseId) {
        router.push(`/dashboard/cases/${caseId}`);
      }
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || '建立案件失敗');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = !!(
    title.trim() &&
    (selectedContactId || isFromInbox) &&
    priority &&
    category
  );

  const sourceLabel = isFromInbox
    ? `${contactName || '未知'} · ${channelType || '未知'} · ${conversationTime || ''}`
    : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }} chromeless>
      <DialogContent className="w-[460px] max-w-[460px] overflow-hidden rounded-3xl bg-white p-0 shadow-[4px_4px_12px_0_rgba(0,0,0,0.25)]">
        {/* Header — Figma blue (#378ADD), padding 20/24 */}
        <div className="flex items-center justify-between gap-3 bg-[#378ADD] px-6 py-5">
          <h2 className="text-[18px] font-semibold leading-5 text-white">建立案件</h2>
          <button
            type="button"
            onClick={() => { onOpenChange(false); resetForm(); }}
            className="rounded-md p-1 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="關閉"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

          {/* Body — white, padding 16, gap 12, max-height for scroll */}
          <form
            onSubmit={handleSubmit}
            className="flex max-h-[calc(85vh-160px)] flex-col gap-3 overflow-y-auto bg-white p-4"
          >
            {/* Source conversation (inbox mode only) */}
            {sourceLabel && (
              <FormField label="來源對話">
                <FieldInput disabled>
                  <span className="truncate text-[14px] leading-5 text-[#727272]">{sourceLabel}</span>
                </FieldInput>
              </FormField>
            )}

            {/* Contact */}
            <FormField label="聯繫人" required>
              {isFromInbox ? (
                <FieldInput disabled>
                  <span className="truncate text-[14px] leading-5 text-[#727272]">
                    {selectedContactName}
                  </span>
                </FieldInput>
              ) : (
                <div className="relative">
                  <FieldInput>
                    <input
                      type="text"
                      value={selectedContactName || contactSearch}
                      onChange={(e) => {
                        setContactSearch(e.target.value);
                        setSelectedContactId('');
                        setSelectedContactName('');
                        setShowContactDropdown(true);
                      }}
                      onFocus={() => contactOptions.length > 0 && setShowContactDropdown(true)}
                      onBlur={() => setTimeout(() => setShowContactDropdown(false), 200)}
                      placeholder="搜尋聯繫人姓名..."
                      className="w-full bg-transparent text-[14px] leading-5 text-ink placeholder:text-[#919191] focus:outline-none"
                    />
                  </FieldInput>
                  {showContactDropdown && (
                    <div className="absolute z-50 mt-1 max-h-40 w-full overflow-auto rounded-card border border-surface-line bg-white shadow-lg">
                      {contactOptions.length > 0 ? (
                        contactOptions.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-[14px] text-ink hover:bg-neutral-20"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setSelectedContactId(c.id);
                              setSelectedContactName(c.displayName);
                              setContactSearch('');
                              setShowContactDropdown(false);
                            }}
                          >
                            <span>{c.displayName}</span>
                            <span className="text-[12px] text-ink-subtle">
                              {c.phone || c.email || ''}
                            </span>
                          </button>
                        ))
                      ) : contactSearch.length >= 2 ? (
                        <div className="px-3 py-2 text-[14px] text-ink-subtle">找不到聯繫人</div>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
            </FormField>

            {/* Title */}
            <FormField label="案件標題" required wordLimit={{ current: title.length, max: 100 }}>
              <FieldInput>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：客戶冰箱不冷"
                  maxLength={100}
                  className="w-full bg-transparent text-[14px] leading-5 text-ink placeholder:text-[#919191] focus:outline-none"
                />
              </FieldInput>
            </FormField>

            {/* Description */}
            <FormField label="問題描述" wordLimit={{ current: description.length, max: 2000 }}>
              <div className="rounded-card border border-surface-line bg-white px-4 py-3">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="描述問題詳情 ..."
                  rows={3}
                  maxLength={2000}
                  className="w-full resize-none bg-transparent text-[14px] leading-5 text-ink placeholder:text-[#919191] focus:outline-none"
                />
              </div>
            </FormField>

            {/* Priority + Category row */}
            <div className="flex gap-3">
              <div className="flex-1">
                <FormField label="優先級" required>
                  <FieldInput>
                    <select
                      value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                      className="w-full bg-transparent text-[14px] leading-5 text-ink focus:outline-none"
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </FieldInput>
                </FormField>
              </div>
              <div className="flex-1">
                <FormField label="分類" required>
                  <FieldInput>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full bg-transparent text-[14px] leading-5 text-ink focus:outline-none"
                    >
                      <option value="">請選擇分類</option>
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </FieldInput>
                </FormField>
              </div>
            </div>

            {/* Assignee + Team row */}
            <div className="flex gap-3">
              <div className="flex-1">
                <FormField label="指派給">
                  <FieldInput>
                    <select
                      value={assigneeId}
                      onChange={(e) => {
                        const agentIdVal = e.target.value;
                        setAssigneeId(agentIdVal);
                        if (agentIdVal) {
                          const agent = agents.find((a) => a.id === agentIdVal);
                          const agentTeamId = agent?.teamId || agent?.team?.id;
                          if (agentTeamId) setTeamId(agentTeamId);
                        }
                      }}
                      className="w-full bg-transparent text-[14px] leading-5 text-ink focus:outline-none"
                    >
                      <option value="">不指派</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </FieldInput>
                </FormField>
              </div>
              <div className="flex-1">
                <FormField label="團隊">
                  <FieldInput>
                    <select
                      value={teamId}
                      onChange={(e) => setTeamId(e.target.value)}
                      className="w-full bg-transparent text-[14px] leading-5 text-ink focus:outline-none"
                    >
                      <option value="">不指定</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </FieldInput>
                </FormField>
              </div>
            </div>

            {/* SLA Policy */}
            <FormField label="SLA 政策">
              <FieldInput>
                <select
                  className="w-full bg-transparent text-[14px] leading-5 text-ink focus:outline-none"
                  defaultValue=""
                >
                  <option value="">依優先級自動套用</option>
                  {slaPolicies.map((p) => (
                    <option key={p.id} value={p.id}>{`${p.name} (${p.priority})`}</option>
                  ))}
                </select>
              </FieldInput>
            </FormField>

            {error && (
              <p className="text-center text-[14px] leading-7 text-[#EE3134]">{error}</p>
            )}
          </form>

          {/* Footer — Figma light-blue bg #EFF6FF, padding 16/20 */}
          <div className="flex items-center justify-end gap-2.5 bg-[#EFF6FF] px-5 py-4">
            <button
              type="button"
              onClick={() => { onOpenChange(false); resetForm(); }}
              className="rounded-card border border-[0.5px] border-ink-subtle bg-white px-8 py-3 text-[14px] font-medium leading-5 text-ink-subtle transition-colors hover:bg-neutral-20"
            >
              取消
            </button>
            <button
              type="button"
              onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
              disabled={isSubmitting || !isFormValid}
              className={cn(
                'rounded-card border px-8 py-3 text-[14px] font-medium leading-5 transition-colors',
                isFormValid && !isSubmitting
                  ? 'border-[#378ADD] bg-[#378ADD] text-white hover:bg-[#2876C4]'
                  : 'cursor-not-allowed border-[#C1C1C1] bg-[#F5F5F5] text-[#727272]',
              )}
            >
              {isSubmitting ? '建立中...' : '建立案件'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
