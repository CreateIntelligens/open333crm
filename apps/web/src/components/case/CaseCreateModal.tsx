'use client';

/* eslint-disable jsx-a11y/label-has-associated-control */
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';

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
  const [channels, setChannels] = useState<ChannelOption[]>([]);

  // Load reference data when modal opens
  useEffect(() => {
    if (!open) { return; }
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

  // Update state when props change (inbox mode)
  useEffect(() => {
    if (contactId) { setSelectedContactId(contactId); }
    if (contactName) { setSelectedContactName(contactName); }
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
    if (isFromInbox) { return; }
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
        // Use first available channel
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

  // Form validation: title + contact + priority + category all required
  const isFormValid = !!(
    title.trim() &&
    (selectedContactId || isFromInbox) &&
    priority &&
    category
  );

  // Source conversation label for inbox mode
  const sourceLabel = isFromInbox
    ? `${contactName || '未知'} · ${channelType || '未知'} · ${conversationTime || ''}`
    : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { resetForm(); } }}>
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
              聯繫人 <span className="text-destructive">*</span>
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
                    setShowContactDropdown(true);
                  }}
                  onFocus={() => contactOptions.length > 0 && setShowContactDropdown(true)}
                  onBlur={() => setTimeout(() => setShowContactDropdown(false), 200)}
                  placeholder="搜尋聯繫人姓名..."
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
                            setContactSearch('');
                            setShowContactDropdown(false);
                          }}
                        >
                          <span>{c.displayName}</span>
                          <span className="text-xs text-muted-foreground">{c.phone || c.email || ''}</span>
                        </button>
                      ))
                    ) : contactSearch.length >= 2 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        找不到聯繫人
                        <button
                          type="button"
                          className="ml-1 text-primary hover:underline font-medium"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setShowContactDropdown(false);
                            window.open('/dashboard/contacts?action=create', '_blank');
                          }}
                        >
                          + 建立新聯繫人
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>

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
                    if (agentTeamId) { setTeamId(agentTeamId); }
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
              value=""
              onChange={() => {}}
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
