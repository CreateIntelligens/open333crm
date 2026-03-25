'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import api from '@/lib/api';

interface OptionItem {
  label: string;
  imageUrl?: string;
  isCorrect?: boolean;
}

interface FieldItem {
  fieldKey: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
}

interface ActivityFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editData?: Record<string, unknown> | null;
}

export function ActivityFormDialog({ open, onClose, onSaved, editData }: ActivityFormDialogProps) {
  const [saving, setSaving] = useState(false);
  const [type, setType] = useState<string>('POLL');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [pointsPerSubmit, setPointsPerSubmit] = useState(0);
  const [options, setOptions] = useState<OptionItem[]>([{ label: '', isCorrect: false }]);
  const [fields, setFields] = useState<FieldItem[]>([{ fieldKey: '', label: '', fieldType: 'text', isRequired: false }]);

  useEffect(() => {
    if (editData) {
      setType((editData.type as string) || 'POLL');
      setTitle((editData.title as string) || '');
      setDescription((editData.description as string) || '');
      setStartsAt(editData.startsAt ? (editData.startsAt as string).slice(0, 16) : '');
      setEndsAt(editData.endsAt ? (editData.endsAt as string).slice(0, 16) : '');
      const settings = (editData.settings || {}) as Record<string, unknown>;
      setPointsPerSubmit((settings.pointsPerSubmit as number) || 0);
      if (editData.options && (editData.options as unknown[]).length > 0) {
        setOptions((editData.options as OptionItem[]).map((o) => ({ label: o.label, imageUrl: o.imageUrl, isCorrect: o.isCorrect })));
      } else {
        setOptions([{ label: '', isCorrect: false }]);
      }
      if (editData.fields && (editData.fields as unknown[]).length > 0) {
        setFields((editData.fields as FieldItem[]).map((f) => ({ fieldKey: f.fieldKey, label: f.label, fieldType: f.fieldType, isRequired: f.isRequired })));
      } else {
        setFields([{ fieldKey: '', label: '', fieldType: 'text', isRequired: false }]);
      }
    } else {
      setType('POLL');
      setTitle('');
      setDescription('');
      setStartsAt('');
      setEndsAt('');
      setPointsPerSubmit(0);
      setOptions([{ label: '', isCorrect: false }]);
      setFields([{ fieldKey: '', label: '', fieldType: 'text', isRequired: false }]);
    }
  }, [editData, open]);

  const handleSave = async () => {
    if (!title) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        type,
        title,
        description: description || undefined,
        startsAt: startsAt || undefined,
        endsAt: endsAt || undefined,
        settings: { pointsPerSubmit },
      };

      if (type === 'POLL' || type === 'QUIZ') {
        payload.options = options.filter((o) => o.label).map((o, i) => ({ ...o, sortOrder: i }));
      }
      if (type === 'FORM') {
        payload.fields = fields.filter((f) => f.fieldKey && f.label).map((f, i) => ({ ...f, sortOrder: i }));
      }

      if (editData) {
        await api.patch(`/portal/activities/${editData.id}`, payload);
      } else {
        await api.post('/portal/activities', payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error('Save activity error:', err);
    } finally {
      setSaving(false);
    }
  };

  const showOptions = type === 'POLL' || type === 'QUIZ';
  const showFields = type === 'FORM';

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editData ? '編輯活動' : '建立活動'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">類型</label>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={!!editData}
              options={[
                { value: 'POLL', label: '投票' },
                { value: 'FORM', label: '表單' },
                { value: 'QUIZ', label: '競猜' },
              ]}
            />
          </div>

          <div>
            <label className="text-sm font-medium">標題 *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="活動標題" />
          </div>

          <div>
            <label className="text-sm font-medium">描述</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="活動描述" rows={3} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">開始時間</label>
              <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">結束時間</label>
              <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">每次提交積分</label>
            <Input type="number" value={pointsPerSubmit} onChange={(e) => setPointsPerSubmit(parseInt(e.target.value) || 0)} min={0} />
          </div>

          {/* Options editor for POLL/QUIZ */}
          {showOptions && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">選項</label>
                <Button size="sm" variant="outline" onClick={() => setOptions([...options, { label: '', isCorrect: false }])}>
                  <Plus className="h-3 w-3 mr-1" /> 新增
                </Button>
              </div>
              <div className="space-y-2">
                {options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={opt.label}
                      onChange={(e) => {
                        const next = [...options];
                        next[i] = { ...next[i], label: e.target.value };
                        setOptions(next);
                      }}
                      placeholder={`選項 ${i + 1}`}
                      className="flex-1"
                    />
                    {type === 'QUIZ' && (
                      <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={opt.isCorrect || false}
                          onChange={(e) => {
                            const next = [...options];
                            next[i] = { ...next[i], isCorrect: e.target.checked };
                            setOptions(next);
                          }}
                        />
                        正確
                      </label>
                    )}
                    {options.length > 1 && (
                      <Button size="sm" variant="ghost" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fields editor for FORM */}
          {showFields && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">欄位</label>
                <Button size="sm" variant="outline" onClick={() => setFields([...fields, { fieldKey: '', label: '', fieldType: 'text', isRequired: false }])}>
                  <Plus className="h-3 w-3 mr-1" /> 新增
                </Button>
              </div>
              <div className="space-y-2">
                {fields.map((field, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={field.fieldKey}
                      onChange={(e) => {
                        const next = [...fields];
                        next[i] = { ...next[i], fieldKey: e.target.value };
                        setFields(next);
                      }}
                      placeholder="欄位 key"
                      className="w-28"
                    />
                    <Input
                      value={field.label}
                      onChange={(e) => {
                        const next = [...fields];
                        next[i] = { ...next[i], label: e.target.value };
                        setFields(next);
                      }}
                      placeholder="顯示名稱"
                      className="flex-1"
                    />
                    <Select
                      value={field.fieldType}
                      onChange={(e) => {
                        const next = [...fields];
                        next[i] = { ...next[i], fieldType: e.target.value };
                        setFields(next);
                      }}
                      className="w-24"
                      options={[
                        { value: 'text', label: '文字' },
                        { value: 'textarea', label: '多行' },
                        { value: 'email', label: 'Email' },
                        { value: 'phone', label: '電話' },
                        { value: 'date', label: '日期' },
                        { value: 'select', label: '選單' },
                      ]}
                    />
                    <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={field.isRequired}
                        onChange={(e) => {
                          const next = [...fields];
                          next[i] = { ...next[i], isRequired: e.target.checked };
                          setFields(next);
                        }}
                      />
                      必填
                    </label>
                    {fields.length > 1 && (
                      <Button size="sm" variant="ghost" onClick={() => setFields(fields.filter((_, j) => j !== i))}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSave} disabled={saving || !title}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {editData ? '儲存' : '建立'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
