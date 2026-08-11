'use client';

/**
 * 設計系統預覽頁 — 驗證階段 1 (Design Tokens) 成果
 * 對照 Figma「OPEN333．CRM Design System」的配色、字體、圓角、語意色。
 * 純展示、不依賴 API，可安全刪除。
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Avatar } from '@/components/ui/avatar';
import { MessageBubble } from '@/components/inbox/MessageBubble';
import { CaseStatusBadge } from '@/components/case/CaseStatusBadge';
import { CasePriorityBadge } from '@/components/case/CasePriorityBadge';
import { ChannelBadge } from '@/components/shared/ChannelBadge';
import { CsatMessage } from '@/components/inbox/CsatMessage';

function PillTabsDemo() {
  const [tab, setTab] = useState('ongoing');
  return (
    <Tabs value={tab} onValueChange={setTab} variant="pill">
      <TabsList>
        <TabsTrigger value="ongoing">進行中</TabsTrigger>
        <TabsTrigger value="closed">已關閉</TabsTrigger>
      </TabsList>
      <TabsContent value="ongoing"><span className="text-sm text-muted-foreground">進行中的案件列表</span></TabsContent>
      <TabsContent value="closed"><span className="text-sm text-muted-foreground">已關閉的案件列表</span></TabsContent>
    </Tabs>
  );
}

function UnderlineTabsDemo() {
  const [tab, setTab] = useState('all');
  return (
    <Tabs value={tab} onValueChange={setTab} variant="underline">
      <TabsList>
        <TabsTrigger value="all">全部</TabsTrigger>
        <TabsTrigger value="mine">我的</TabsTrigger>
        <TabsTrigger value="unread">未讀</TabsTrigger>
      </TabsList>
      <TabsContent value="all"><span className="text-sm text-muted-foreground">全部對話</span></TabsContent>
      <TabsContent value="mine"><span className="text-sm text-muted-foreground">我負責的對話</span></TabsContent>
      <TabsContent value="unread"><span className="text-sm text-muted-foreground">未讀對話</span></TabsContent>
    </Tabs>
  );
}

function Swatch({ name, className, hex }: { name: string; className: string; hex: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className={`h-16 w-full rounded-lg border ${className}`} />
      <span className="text-xs font-medium text-foreground">{name}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{hex}</span>
    </div>
  );
}

export default function DesignPreviewPage() {
  const [dark, setDark] = useState(false);

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="min-h-screen bg-background px-8 py-10 text-foreground">
        <div className="mx-auto max-w-5xl space-y-12">
          {/* Header */}
          <header className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">open333CRM 設計系統</h1>
              <p className="mt-1 text-muted-foreground">
                階段 1 · Design Tokens 預覽（對照 Figma）
              </p>
            </div>
            <button
              onClick={() => setDark((d) => !d)}
              className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent"
            >
              切換 {dark ? '亮色' : '暗色'}
            </button>
          </header>

          {/* 色彩 */}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">色彩 Palette</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
              <Swatch name="Primary" className="bg-primary" hex="#378ADD" />
              <Swatch name="Primary Subtle" className="bg-primary-subtle" hex="#EFF6FF" />
              <Swatch name="Success" className="bg-success" hex="#008236" />
              <Swatch name="Warning" className="bg-warning" hex="#FF6E00" />
              <Swatch name="Destructive" className="bg-destructive" hex="#EE3134" />
              <Swatch name="AI / Bot" className="bg-ai" hex="#9810FA" />
              <Swatch name="Foreground" className="bg-foreground" hex="#37404C" />
              <Swatch name="Muted FG" className="bg-muted-foreground" hex="#707E93" />
              <Swatch name="Muted" className="bg-muted" hex="#F8FAFC" />
              <Swatch name="Border" className="bg-border" hex="#E2E8F0" />
              <Swatch name="Secondary" className="bg-secondary" hex="#F1F5F9" />
              <Swatch name="Card" className="bg-card border" hex="#FFFFFF" />
            </div>
          </section>

          {/* 階段 2：真實元件 */}
          <section className="space-y-5 rounded-xl border border-primary-border bg-primary-subtle/30 p-6">
            <h2 className="text-lg font-semibold text-primary">階段 2 · 實際 UI 元件</h2>

            {/* Button 元件 */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Button（8 變體 × 尺寸 + loading）</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="subtle">Subtle</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">刪除</Button>
                <Button variant="ai">✨ AI 建議</Button>
                <Button loading>載入中</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="xs">XS</Button>
                <Button size="sm">Small</Button>
                <Button size="default">Medium</Button>
                <Button size="lg">Large</Button>
              </div>
            </div>

            {/* Badge 元件 */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Badge / Tag（語意色）</p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="danger">進行中</Badge>
                <Badge variant="success">已解決</Badge>
                <Badge variant="info">待處理</Badge>
                <Badge variant="secondary">已關閉</Badge>
                <Badge variant="warning">高優先</Badge>
                <Badge variant="ai">Bot 自動</Badge>
                <Badge variant="outline">Outline</Badge>
              </div>
            </div>

            {/* Card + Tabs + Input + Avatar */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>案件摘要 #1087</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">維修預約 — 冰箱不製冷</p>
                  <div className="flex items-center gap-2">
                    <Avatar alt="王 客服" size="sm" />
                    <Avatar variant="bot" fallback="B" size="sm" />
                    <span className="text-sm text-muted-foreground">王客服 · Bot</span>
                  </div>
                  <Input placeholder="輸入回覆內容…" />
                </CardContent>
              </Card>

              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-sm font-medium text-muted-foreground">Tabs · Pill</p>
                  <PillTabsDemo />
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium text-muted-foreground">Tabs · Underline</p>
                  <UnderlineTabsDemo />
                </div>
              </div>
            </div>
          </section>

          {/* 按鈕 (tokens 效果對照) */}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">按鈕 Button（純 tokens 手刻對照）</h2>
            <div className="flex flex-wrap items-center gap-3">
              <button className="rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover">
                Primary
              </button>
              <button className="rounded-md bg-primary-subtle px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary-subtle/70">
                Subtle
              </button>
              <button className="rounded-md border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                Outline
              </button>
              <button className="rounded-md bg-ai px-4 py-2.5 text-sm font-medium text-ai-foreground transition-colors hover:opacity-90">
                AI 建議
              </button>
              <button className="rounded-md bg-muted px-4 py-2.5 text-sm font-medium text-muted-foreground" disabled>
                Disabled
              </button>
            </div>
          </section>

          {/* 標籤 Tags */}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">標籤 Tags（狀態 / 優先級 / 通道）</h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-destructive-subtle px-2.5 py-1 text-xs font-semibold text-destructive">進行中</span>
              <span className="rounded-lg bg-success-subtle px-2.5 py-1 text-xs font-semibold text-success">已解決</span>
              <span className="rounded-lg bg-primary-subtle px-2.5 py-1 text-xs font-semibold text-primary">待處理</span>
              <span className="rounded-lg bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">已關閉</span>
              <span className="rounded-lg bg-warning-subtle px-2.5 py-1 text-xs font-semibold text-warning">● 高優先</span>
              <span className="rounded-lg bg-ai-subtle px-2.5 py-1 text-xs font-semibold text-ai">Bot 自動</span>
              <span className="rounded-lg bg-success-subtle px-2.5 py-1 text-xs font-semibold text-success">信心值 92%</span>
            </div>
          </section>

          {/* 卡片 + 聊天泡泡 */}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">卡片 Card / 聊天泡泡 Chat Bubble</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {/* 卡片 */}
              <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">維修預約</h3>
                  <span className="rounded-lg bg-warning-subtle px-2 py-0.5 text-xs font-semibold text-warning">高</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  客戶回報冰箱不製冷，已安排維修師傅今日 14-18 時到府。
                </p>
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                  <span>案件 #1087</span>·<span>10:32</span>
                </div>
              </div>

              {/* 聊天泡泡群 */}
              <div className="space-y-3">
                <div className="max-w-[80%] rounded-2xl rounded-tl-none border border-border bg-card px-4 py-2.5 text-sm shadow-bubble">
                  冰箱不製冷了，可以幫我安排維修嗎？
                </div>
                <div className="ml-auto max-w-[80%] rounded-2xl rounded-tr-none bg-primary-subtle px-4 py-2.5 text-sm">
                  好的，已為您安排維修師傅到府。
                </div>
                {/* AI Bot 回覆 */}
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-none border border-ai-border bg-ai-subtle px-4 py-2.5 text-sm">
                  <p>已為您建立案件工單，維修師傅今日 14-18 時到府。</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs font-semibold text-ai">✨ 判斷依據</span>
                    <span className="rounded-md bg-success-subtle px-1.5 py-0.5 text-[10px] font-semibold text-success">信心值 92%</span>
                    <span className="rounded-md bg-ai-subtle px-1.5 py-0.5 text-[10px] font-semibold text-ai">KM 語義命中</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 階段 3：CRM 專屬元件 */}
          <section className="space-y-5 rounded-xl border border-ai-border bg-ai-subtle/20 p-6">
            <h2 className="text-lg font-semibold text-ai">階段 3 · CRM 專屬元件（真實元件）</h2>

            {/* 狀態 / 優先級 / 通道標籤 */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">案件狀態 / 優先級 / 通道標籤</p>
              <div className="flex flex-wrap items-center gap-2">
                <CaseStatusBadge status="in_progress" />
                <CaseStatusBadge status="resolved" />
                <CaseStatusBadge status="pending" />
                <CaseStatusBadge status="escalated" />
                <CaseStatusBadge status="closed" />
                <span className="mx-1 text-border">|</span>
                <CasePriorityBadge priority="urgent" />
                <CasePriorityBadge priority="high" />
                <CasePriorityBadge priority="low" />
                <span className="mx-1 text-border">|</span>
                <ChannelBadge channel="LINE" />
                <ChannelBadge channel="FB" />
                <ChannelBadge channel="WEBCHAT" />
              </div>
            </div>

            {/* 聊天泡泡 (真實 MessageBubble) */}
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">聊天泡泡 MessageBubble（含 Bot AI 回覆）</p>
              <div className="rounded-xl border border-border bg-background py-2">
                <MessageBubble message={{ id: '1', direction: 'inbound', contentType: 'text', content: '冰箱不製冷了，可以幫我安排維修嗎？', senderName: '陳小芳', createdAt: new Date('2026-01-01T10:32:00').toISOString() }} />
                <MessageBubble message={{ id: '2', direction: 'outbound', contentType: 'text', content: '好的，已為您安排維修師傅到府。', createdAt: new Date('2026-01-01T10:33:00').toISOString() }} />
                <MessageBubble message={{ id: '3', direction: 'outbound', contentType: 'text', content: '已為您建立案件工單，維修師傅今日 14-18 時到府，請您留意時間，謝謝。', senderType: 'BOT', createdAt: new Date('2026-01-01T10:33:00').toISOString(), metadata: { confidence: 0.92, triggerType: 'semantic' } }} />
              </div>
            </div>

            {/* CSAT 評分卡 */}
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">CSAT 滿意度評分卡</p>
              <CsatMessage score={4} readonly />
            </div>
          </section>

          {/* 階段 4：Sidebar 選中態示意 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">階段 4 · Sidebar 導覽（選中態示意）</h2>
            <div className="inline-flex flex-col gap-1 rounded-xl border border-border bg-card p-3 shadow-soft" style={{ width: 220 }}>
              {[
                { label: '收件匣', active: true, badge: 12 },
                { label: '工單', active: false, badge: 3 },
                { label: '聯繫人', active: false },
                { label: '自動化', active: false },
                { label: '報表', active: false },
              ].map((item) => (
                <div
                  key={item.label}
                  className={
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ' +
                    (item.active
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground')
                  }
                >
                  <span className="h-4 w-4 rounded bg-current opacity-70" />
                  <span>{item.label}</span>
                  {item.badge && (
                    <span
                      className={
                        'ml-auto min-w-[20px] rounded-full px-1.5 py-0.5 text-center text-xs font-semibold ' +
                        (item.active
                          ? 'bg-primary-foreground/20 text-primary-foreground'
                          : 'bg-destructive text-destructive-foreground')
                      }
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* 字體 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">字體 Typography（Inter + Noto Sans TC）</h2>
            <div className="space-y-2 rounded-xl border border-border bg-card p-5">
              <p className="text-2xl font-bold">維修預約 Maintenance Booking 1234567890</p>
              <p className="text-base">內文 body 14px — 客戶服務管理系統 open333CRM</p>
              <p className="text-sm text-muted-foreground">caption 說明文字 · Traditional Chinese 繁體中文</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
