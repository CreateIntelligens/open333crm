'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Save, Check, Eye, EyeOff } from 'lucide-react';

/** 角色顯示名稱對應表 */
const roleLabels: Record<string, string> = {
  admin: '管理員',
  agent: '客服人員',
  supervisor: '主管',
};

export function GeneralSettings() {
  const { agent } = useAuth();

  // 個人資料表單
  const [name, setName] = useState('');

  // 密碼修改表單
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // 密碼可見性
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // 儲存狀態
  const [profileSaved, setProfileSaved] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // 初始化姓名欄位
  useEffect(() => {
    if (agent?.name) {
      setName(agent.name);
    }
  }, [agent?.name]);

  /** 儲存個人資料（POC：模擬成功） */
  const handleSaveProfile = () => {
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2000);
  };

  /** 儲存密碼（POC：前端驗證後模擬成功） */
  const handleSavePassword = () => {
    setPasswordError('');

    if (!oldPassword) {
      setPasswordError('請輸入舊密碼');
      return;
    }
    if (!newPassword) {
      setPasswordError('請輸入新密碼');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('新密碼至少需要 6 個字元');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('新密碼與確認密碼不一致');
      return;
    }

    // POC：模擬儲存成功
    setPasswordSaved(true);
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setTimeout(() => setPasswordSaved(false), 2000);
  };

  if (!agent) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        載入中...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-4">
      {/* 個人資料 */}
      <Card>
        <CardHeader>
          <CardTitle>個人資料</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 姓名 */}
          <div className="space-y-2">
            <label htmlFor="profile-name" className="text-sm font-medium">
              姓名
            </label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="輸入姓名"
            />
          </div>

          {/* Email（唯讀） */}
          <div className="space-y-2">
            <label htmlFor="profile-email" className="text-sm font-medium">
              電子信箱
            </label>
            <Input
              id="profile-email"
              value={agent.email}
              readOnly
              disabled
              className="bg-muted"
            />
          </div>

          {/* 角色（唯讀） */}
          <div className="space-y-2">
            <label htmlFor="profile-role" className="text-sm font-medium">
              角色
            </label>
            <Input
              id="profile-role"
              value={roleLabels[agent.role] || agent.role}
              readOnly
              disabled
              className="bg-muted"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSaveProfile} disabled={!name.trim()}>
              {profileSaved ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  儲存成功
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  儲存資料
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 密碼修改 */}
      <Card>
        <CardHeader>
          <CardTitle>修改密碼</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 舊密碼 */}
          <div className="space-y-2">
            <label htmlFor="old-password" className="text-sm font-medium">
              目前密碼
            </label>
            <div className="relative">
              <Input
                id="old-password"
                type={showOldPassword ? 'text' : 'password'}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="輸入目前密碼"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowOldPassword(!showOldPassword)}
                aria-label={showOldPassword ? '隱藏密碼' : '顯示密碼'}
              >
                {showOldPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <Separator />

          {/* 新密碼 */}
          <div className="space-y-2">
            <label htmlFor="new-password" className="text-sm font-medium">
              新密碼
            </label>
            <div className="relative">
              <Input
                id="new-password"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="輸入新密碼（至少 6 個字元）"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowNewPassword(!showNewPassword)}
                aria-label={showNewPassword ? '隱藏密碼' : '顯示密碼'}
              >
                {showNewPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* 確認新密碼 */}
          <div className="space-y-2">
            <label htmlFor="confirm-password" className="text-sm font-medium">
              確認新密碼
            </label>
            <div className="relative">
              <Input
                id="confirm-password"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次輸入新密碼"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                aria-label={showConfirmPassword ? '隱藏密碼' : '顯示密碼'}
              >
                {showConfirmPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* 錯誤訊息 */}
          {passwordError && (
            <p className="text-sm text-destructive">{passwordError}</p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSavePassword}>
              {passwordSaved ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  密碼已更新
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  更新密碼
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
