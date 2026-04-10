'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { API_BASE_URL } from '@/lib/constants';

interface DaySchedule {
  start: string;
  end: string;
}

interface OfficeHoursConfig {
  enabled: boolean;
  schedule: Record<string, DaySchedule | null>;
  holidays: string[];
  outsideHoursMessage: string;
}

const DAY_LABELS: Record<string, string> = {
  mon: '週一',
  tue: '週二',
  wed: '週三',
  thu: '週四',
  fri: '週五',
  sat: '週六',
  sun: '週日',
};

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const DEFAULT_CONFIG: OfficeHoursConfig = {
  enabled: false,
  schedule: {
    mon: { start: '09:00', end: '18:00' },
    tue: { start: '09:00', end: '18:00' },
    wed: { start: '09:00', end: '18:00' },
    thu: { start: '09:00', end: '18:00' },
    fri: { start: '09:00', end: '18:00' },
    sat: null,
    sun: null,
  },
  holidays: [],
  outsideHoursMessage: '您好！目前為非營業時間，我們將在營業時間內盡速回覆您。',
};

export function OfficeHoursSettings() {
  const [config, setConfig] = useState<OfficeHoursConfig>(DEFAULT_CONFIG);
  const [timezone, setTimezone] = useState('Asia/Taipei');
  const [newHoliday, setNewHoliday] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const getToken = () => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('token') || '';
  };

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/settings/office-hours`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        const json = await res.json();
        const data = json.data;
        setTimezone(data.timezone || 'Asia/Taipei');
        setConfig(data.officeHours || DEFAULT_CONFIG);
      }
    } catch (err) {
      console.error('Failed to fetch office hours:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/office-hours`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ timezone, officeHours: config }),
      });
      if (res.ok) {
        alert('營業時間設定已儲存');
      } else {
        alert('儲存失敗');
      }
    } catch (err) {
      console.error('Failed to save office hours:', err);
      alert('儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const toggleDay = (day: string) => {
    setConfig((prev) => ({
      ...prev,
      schedule: {
        ...prev.schedule,
        [day]: prev.schedule[day] ? null : { start: '09:00', end: '18:00' },
      },
    }));
  };

  const updateDayTime = (day: string, field: 'start' | 'end', value: string) => {
    setConfig((prev) => ({
      ...prev,
      schedule: {
        ...prev.schedule,
        [day]: {
          ...(prev.schedule[day] || { start: '09:00', end: '18:00' }),
          [field]: value,
        },
      },
    }));
  };

  const addHoliday = () => {
    if (!newHoliday) return;
    if (config.holidays.includes(newHoliday)) return;
    setConfig((prev) => ({
      ...prev,
      holidays: [...prev.holidays, newHoliday].sort(),
    }));
    setNewHoliday('');
  };

  const removeHoliday = (date: string) => {
    setConfig((prev) => ({
      ...prev,
      holidays: prev.holidays.filter((h) => h !== date),
    }));
  };

  if (loading) {
    return <div className="p-4 text-muted-foreground">載入中...</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold mb-4">營業時間設定</h2>
        <p className="text-sm text-muted-foreground mb-4">
          設定營業時間後，非營業時間收到的訊息將自動回覆提示訊息。
        </p>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={config.enabled}
          onClick={() => setConfig((prev) => ({ ...prev, enabled: !prev.enabled }))}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${config.enabled ? 'bg-primary' : 'bg-muted'}`}
        >
          <span className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform ${config.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
        <span className="text-sm font-medium">
          {config.enabled ? '已啟用營業時間' : '未啟用營業時間'}
        </span>
      </div>

      {config.enabled && (
        <>
          {/* Timezone */}
          <div className="space-y-2">
            <label className="text-sm font-medium">時區</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="Asia/Taipei">Asia/Taipei (GMT+8)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (GMT+9)</option>
              <option value="Asia/Shanghai">Asia/Shanghai (GMT+8)</option>
              <option value="Asia/Hong_Kong">Asia/Hong_Kong (GMT+8)</option>
              <option value="Asia/Singapore">Asia/Singapore (GMT+8)</option>
              <option value="America/New_York">America/New_York (EST)</option>
              <option value="Europe/London">Europe/London (GMT)</option>
            </select>
          </div>

          {/* Weekly schedule */}
          <div className="space-y-3">
            <label className="text-sm font-medium">每週排程</label>
            {DAY_ORDER.map((day) => {
              const schedule = config.schedule[day];
              const isOn = schedule !== null && schedule !== undefined;
              return (
                <div key={day} className="flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isOn}
                    onClick={() => toggleDay(day)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isOn ? 'bg-primary' : 'bg-muted'}`}
                  >
                    <span className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg transition-transform ${isOn ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <span className="w-10 text-sm font-medium">{DAY_LABELS[day]}</span>
                  {isOn ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={schedule!.start}
                        onChange={(e) => updateDayTime(day, 'start', e.target.value)}
                        className="w-32"
                      />
                      <span className="text-muted-foreground">至</span>
                      <Input
                        type="time"
                        value={schedule!.end}
                        onChange={(e) => updateDayTime(day, 'end', e.target.value)}
                        className="w-32"
                      />
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">休息</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Holidays */}
          <div className="space-y-2">
            <label className="text-sm font-medium">假日（非營業日）</label>
            <div className="flex gap-2">
              <Input
                type="date"
                value={newHoliday}
                onChange={(e) => setNewHoliday(e.target.value)}
                className="w-48"
              />
              <Button variant="outline" size="sm" onClick={addHoliday}>
                新增
              </Button>
            </div>
            {config.holidays.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {config.holidays.map((date) => (
                  <span
                    key={date}
                    className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
                  >
                    {date}
                    <button
                      onClick={() => removeHoliday(date)}
                      className="text-muted-foreground hover:text-foreground ml-1"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Auto-reply message */}
          <div className="space-y-2">
            <label className="text-sm font-medium">非營業時間自動回覆訊息</label>
            <textarea
              value={config.outsideHoursMessage}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  outsideHoursMessage: e.target.value,
                }))
              }
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </>
      )}

      {/* Save button */}
      <Button onClick={handleSave} disabled={saving}>
        {saving ? '儲存中...' : '儲存設定'}
      </Button>
    </div>
  );
}
