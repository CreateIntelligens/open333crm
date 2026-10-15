'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { CASE_CATEGORIES } from '@open333crm/shared';
import { getApiErrorMessage } from '@/lib/api-error';

interface CaseCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** From inbox: conversation ID to link */
  conversationId?: string;
  /** From inbox: contact display name (readonly) */
  contactName?: string;
  /** From inbox: contact ID (readonly) */
  contactId?: string;
  /** From inbox: channel type label */
  channelType?: string;
  /** From inbox: conversation time label */
  conversationTime?: string;
}

interface ContactOption {
  id: string;
  displayName: string;
  phone?: string;
  email?: string;
  /** 聯絡人在看得到的渠道上的帳號（GET /contacts 已依渠道可見範圍過濾） */
  channelIdentities?: Array<{ channel?: { id: string; displayName: string; channelType: string } | null }>;
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
  displayName: string;
}

/** 聯絡人所在的渠道（去重）；工單渠道只能從這裡選 */
function contactChannels(contact: ContactOption): ChannelOption[] {
  const result: ChannelOption[] = [];
  for (const identity of contact.channelIdentities ?? []) {
    const ch = identity.channel;
    if (ch && !result.some((c) => c.id === ch.id)) result.push({ id: ch.id, displayName: ch.displayName });
  }
  return result;
}

const PRIORITIES = [
  { value: 'LOW', label: '低' },
  { value: 'MEDIUM', label: '中' },
  { value: 'HIGH', label: '高' },
  { value: 'URGENT', label: '緊急' },
];

// 分類清單改由 @open333crm/shared 提供單一事實來源。
// 原本這裡與 CaseDetail 各寫一份且內容完全不同（只有「其他」重疊），
// 導致建立時選的分類在詳情頁找不到對應 option、一存檔就被洗掉。
const CATEGORIES = CASE_CATEGORIES.map((c) => ({ value: c, label: c }));

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

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [category, setCategory] = useState('');
  const [selectedContactId, setSelectedContactId] = useState(contactId || '');
  const [assigneeId, setAssigneeId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [selectedSlaPolicyId, setSelectedSlaPolicyId] = useState('');
  // S10：工單渠道取聯絡人所在的渠道（原本取 /channels 的第一個，工單被歸到任意渠道）
  const [contactChannelOptions, setContactChannelOptions] = useState<ChannelOption[] | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Contact search state
  const [contactSearch, setContactSearch] = useState('');
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([]);
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const [selectedContactName, setSelectedContactName] = useState(contactName || '');

  // Reference data
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [slaPolicies, setSlaPolicies] = useState<SlaPolicy[]>([]);

  // Load reference data when modal opens
  useEffect(() => {
    if (!open) return;
    Promise.all([
      api.get('/agents').catch(() => ({ data: { data: [] } })),
      api.get('/sla-policies').catch(() => ({ data: { data: [] } })),
    ]).then(([agentsRes, slaRes]) => {
      setAgents(agentsRes.data.data || []);
      setSlaPolicies(slaRes.data.data || []);
    });
  }, [open]);

  // Update state when props change (inbox mode)
  useEffect(() => {
    if (contactId) setSelectedContactId(contactId);
    if (contactName) setSelectedContactName(contactName);
  }, [contactId, contactName]);

  // Contact search (debounced)
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

  // Derive unique teams from agents
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
      setContactChannelOptions(null);
      setSelectedChannelId('');
    }
    setAssigneeId('');
    setTeamId('');
    setSelectedSlaPolicyId('');
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
      setError('請選擇聯絡人');
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
          slaPolicyId: selectedSlaPolicyId || undefined,
        });
        caseId = res.data.data?.id;
      } else {
        const effectiveChannelId = selectedChannelId;
        if (!effectiveChannelId) {
          setError('請選擇工單所屬的渠道');
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
          slaPolicyId: selectedSlaPolicyId || undefined,
        });
        caseId = res.data.data?.id;
      }

      onOpenChange(false);
      resetForm();
      if (caseId) {
        router.push(`/dashboard/cases/${caseId}`);
      }
    } catch (err: unknown) {
      // 後端錯誤格式是 { error: { message } }；原本讀 data.message，永遠只顯示「建立案件失敗」
      setError(getApiErrorMessage(err, '建立案件失敗'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Form validation: title + contact + priority + category all required
  const isFormValid = !!(
    title.trim() &&
    (isFromInbox || (selectedContactId && selectedChannelId)) &&
    priority &&
    category
  );

  // Source conversation label for inbox mode
  const sourceLabel = isFromInbox
    ? `${contactName || '未知'} · ${channelType || '未知'} · ${conversationTime || ''}`
    : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>建立案件</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* Source conversation (inbox mode only) */}
          {sourceLabel && (
            <div>
              <label className="text-sm font-medium text-muted-foreground">來源對話</label>
              <p className="text-sm mt-0.5 rounded bg-muted px-2 py-1">{sourceLabel}</p>
            </div>
          )}

          {/* Contact */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              聯絡人 <span className="text-destructive">*</span>
            </label>
            {isFromInbox ? (
              <Input value={selectedContactName} disabled />
            ) : (
              <div className="relative">
                <Input
                  value={selectedContactName || contactSearch}
                  onChange={(e) => {
                    setContactSearch(e.target.value);
                    setSelectedContactId('');
                    setSelectedContactName('');
                    setContactChannelOptions(null);
                    setSelectedChannelId('');
                    setShowContactDropdown(true);
                  }}
                  onFocus={() => contactOptions.length > 0 && setShowContactDropdown(true)}
                  onBlur={() => setTimeout(() => setShowContactDropdown(false), 200)}
                  placeholder="搜尋聯絡人姓名..."
                />
                {showContactDropdown && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-background shadow-lg max-h-40 overflow-auto">
                    {contactOptions.length > 0 ? (
                      contactOptions.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex justify-between"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setSelectedContactId(c.id);
                            setSelectedContactName(c.displayName);
                            const options = contactChannels(c);
                            setContactChannelOptions(options);
                            setSelectedChannelId(options.length === 1 ? options[0].id : '');
                            setContactSearch('');
                            setShowContactDropdown(false);
                          }}
                        >
                          <span>{c.displayName}</span>
                          <span className="text-xs text-muted-foreground">{c.phone || c.email || ''}</span>
                        </button>
                      ))
                    ) : contactSearch.length >= 2 ? (
                      // S11：原本有「+ 建立新聯絡人」連到 contacts?action=create，但系統沒有手動建立聯絡人的功能，
                      // 而且工單必須掛在聯絡人所在的渠道，手動建立的聯絡人也無法開單
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        <p>找不到聯絡人</p>
                        <p className="mt-0.5 text-xs">
                          顧客透過渠道傳訊息後，系統會自動建立聯絡人。也可以從收件匣的對話直接建立工單。
                        </p>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Channel：聯絡人所在的渠道（列表頁建立時） */}
          {!isFromInbox && contactChannelOptions && (
            contactChannelOptions.length === 0 ? (
              <p className="text-sm text-destructive">
                這位聯絡人在你看得到的渠道沒有帳號，沒有可建立工單的渠道。請從收件匣的對話建立工單。
              </p>
            ) : contactChannelOptions.length > 1 ? (
              <div>
                <label className="mb-1 block text-sm font-medium">
                  渠道 <span className="text-destructive">*</span>
                </label>
                <Select
                  value={selectedChannelId}
                  onChange={(e) => setSelectedChannelId(e.target.value)}
                  options={[
                    { value: '', label: '請選擇聯絡人所在的渠道' },
                    ...contactChannelOptions.map((c) => ({ value: c.id, label: c.displayName })),
                  ]}
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">渠道：{contactChannelOptions[0].displayName}</p>
            )
          )}

          {/* Title */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              案件標題 <span className="text-destructive">*</span>
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="案件標題..."
              maxLength={100}
              required
            />
            <p className="mt-0.5 text-xs text-muted-foreground text-right">{title.length}/100</p>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-sm font-medium">問題描述</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="描述問題..."
              rows={3}
              maxLength={2000}
            />
            <p className="mt-0.5 text-xs text-muted-foreground text-right">{description.length}/2000</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Priority */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                優先級 <span className="text-destructive">*</span>
              </label>
              <Select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                options={PRIORITIES}
              />
            </div>

            {/* Category */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                分類 <span className="text-destructive">*</span>
              </label>
              <Select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                options={[{ value: '', label: '請選擇分類' }, ...CATEGORIES]}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Assignee */}
            <div>
              <label className="mb-1 block text-sm font-medium">指派給</label>
              <Select
                value={assigneeId}
                onChange={(e) => {
                  const agentIdVal = e.target.value;
                  setAssigneeId(agentIdVal);
                  // Auto-fill team from selected agent
                  if (agentIdVal) {
                    const agent = agents.find((a) => a.id === agentIdVal);
                    const agentTeamId = agent?.teamId || agent?.team?.id;
                    if (agentTeamId) setTeamId(agentTeamId);
                  }
                }}
                options={[
                  { value: '', label: '不指派' },
                  ...agents.map((a) => ({ value: a.id, label: a.name })),
                ]}
              />
            </div>

            {/* Team */}
            <div>
              <label className="mb-1 block text-sm font-medium">團隊</label>
              <Select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                options={[
                  { value: '', label: '不指定' },
                  ...teams.map((t) => ({ value: t.id, label: t.name })),
                ]}
              />
            </div>
          </div>

          {/* SLA Policy */}
          <div>
            <label className="mb-1 block text-sm font-medium">SLA 政策</label>
            <Select
              value={selectedSlaPolicyId}
              onChange={(e) => setSelectedSlaPolicyId(e.target.value)}
              options={[
                { value: '', label: '依優先級自動套用' },
                ...slaPolicies.map((p) => ({ value: p.id, label: `${p.name} (${p.priority})` })),
              ]}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => { onOpenChange(false); resetForm(); }}
            >
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting || !isFormValid}>
              {isSubmitting ? '建立中...' : '建立案件'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
