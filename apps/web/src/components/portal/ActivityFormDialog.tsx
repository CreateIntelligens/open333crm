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
import { getApiErrorMessage } from '@/lib/api-error';
import { toLocalInputValue, toIsoForApi } from '@/lib/datetime-local';

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
  // 原本儲存失敗只 console.error，使用者按了沒反應也不知道為什麼
  const [error, setError] = useState('');
  const [type, setType] = useState<string>('POLL');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [pointsPerSubmit, setPointsPerSubmit] = useState(0);
  const [options, setOptions] = useState<OptionItem[]>([{ label: '', isCorrect: false }]);
  const [fields, setFields] = useState<FieldItem[]>([{ fieldKey: '', label: '', fieldType: 'text', isRequired: false }]);

  // 編輯時要以完整活動（含 options／fields）帶入內容。列表項沒有這兩項，
  // 直接拿來填會讓選項欄變空白，只改標題儲存就送出 options: [] 刪光選項（#424）。
  // 載入完成前與載入失敗時都不能儲存。
  // 已載入完整資料的活動 id；與目前編輯的 id 不同就代表還沒載入（第一次 render 也算）
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const editId = editData ? String(editData.id) : null;

  useEffect(() => {
    setError('');
    setLoadError('');
    setLoadedId(null);
    if (!editId) {
      setType('POLL');
      setTitle('');
      setDescription('');
      setStartsAt('');
      setEndsAt('');
      setPointsPerSubmit(0);
      setOptions([{ label: '', isCorrect: false }]);
      setFields([{ fieldKey: '', label: '', fieldType: 'text', isRequired: false }]);
      return;
    }
    if (!open) return;

    let cancelled = false;
    api
      .get(`/portal/activities/${editId}`)
      .then((res) => {
        if (cancelled) return;
        const full = res.data?.data as Record<string, unknown> | undefined;
        if (!full) throw new Error('活動資料格式不正確');
        setType((full.type as string) || 'POLL');
        setTitle((full.title as string) || '');
        setDescription((full.description as string) || '');
        setStartsAt(toLocalInputValue(full.startsAt as string | null | undefined));
        setEndsAt(toLocalInputValue(full.endsAt as string | null | undefined));
        const settings = (full.settings || {}) as Record<string, unknown>;
        setPointsPerSubmit((settings.pointsPerSubmit as number) || 0);
        const fullOptions = (full.options as OptionItem[] | undefined) ?? [];
        setOptions(
          fullOptions.length > 0
            ? fullOptions.map((o) => ({ label: o.label, imageUrl: o.imageUrl ?? undefined, isCorrect: o.isCorrect }))
            : [{ label: '', isCorrect: false }],
        );
        const fullFields = (full.fields as FieldItem[] | undefined) ?? [];
        setFields(
          fullFields.length > 0
            ? fullFields.map((f) => ({ fieldKey: f.fieldKey, label: f.label, fieldType: f.fieldType, isRequired: f.isRequired }))
            : [{ fieldKey: '', label: '', fieldType: 'text', isRequired: false }],
        );
        setLoadedId(editId);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Load activity error:', err);
        setLoadError(getApiErrorMessage(err, '無法載入活動內容，請稍後再試'));
      });
    return () => {
      cancelled = true;
    };
  }, [editId, open, reloadKey]);

  const loadingFull = Boolean(editId) && loadedId !== editId && !loadError;
  const editNotReady = Boolean(editId) && loadedId !== editId;

  const handleSave = async () => {
    if (!title || editNotReady) return;
    setError('');
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        type,
        title,
        description: description || undefined,
        // 第二參數 = 可清除：編輯時清空要送 null，否則後端當成「這欄不動」
        startsAt: toIsoForApi(startsAt, Boolean(editData)),
        endsAt: toIsoForApi(endsAt, Boolean(editData)),
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
      setError(getApiErrorMessage(err, '儲存活動失敗，請檢查輸入內容'));
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

        {editData && loadingFull && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在載入活動內容
          </div>
        )}

        {editData && loadError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <span>{loadError}</span>
            <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
              重新載入
            </Button>
          </div>
        )}

        {!editNotReady && (
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
            {/* min 擋不住手動輸入負數；後端只接受 0 以上的整數 */}
            <Input type="number" value={pointsPerSubmit} onChange={(e) => setPointsPerSubmit(Math.max(0, parseInt(e.target.value) || 0))} min={0} />
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
              {/* 後端發布時會擋沒有正確答案的競猜（#471）；草稿可以先存 */}
              {type === 'QUIZ' && (
                <p className="mb-2 text-xs text-muted-foreground">發布前至少勾選一個正確答案</p>
              )}
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
        )}

        {error && (
          // 視窗內容長，失敗時捲回錯誤位置，否則使用者停在上方欄位
          // 會以為按了沒反應
          <div
            role="alert"
            ref={(el) => el?.scrollIntoView({ block: 'nearest' })}
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSave} disabled={saving || !title || editNotReady}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {editData ? '儲存' : '建立'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
