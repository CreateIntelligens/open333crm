'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * 渠道憑證欄位說明
 * 依 channelType 顯示「這些欄位要去哪裡取得」的圖文步驟。
 * 資料驅動：新增其他渠道只要往 GUIDES 加一筆，不用改組件。
 */

/** 此欄位對應的表單值（用來顯示「你目前填的值」） */
interface FieldValueRef {
  /** 顯示標籤 */
  label: string;
  /** 對應 values 物件的 key */
  key: string;
  /** 是否為機密（Token/Key/Secret）→ 中間隱碼；非機密（ID）→ 完整顯示 */
  secret: boolean;
}

interface FieldStep {
  /** 欄位名稱（對應憑證表單的 label） */
  field: string;
  /** 取得步驟（逐條） */
  steps: string[];
  /** 截圖路徑（放在 public/channel-guide/），可省略 */
  image?: string;
  /** 截圖說明 */
  imageAlt?: string;
  /** 此欄位對應的當前表單值（可多個，如 App ID + App Secret） */
  values?: FieldValueRef[];
}

interface ChannelGuide {
  title: string;
  /** 前置說明 / 前往連結 */
  intro: string;
  consoleUrl?: string;
  /** 前往連結的顯示文字（各渠道不同後台，避免 FB 指引也寫成 LINE） */
  consoleLabel?: string;
  fields: FieldStep[];
}

/** 機密值中間隱碼：只露頭尾，中間以 •••• 取代。短值全遮。
 *  若已是後端遮罩過的值（含 "..." 或 "•"），直接沿用不再重複遮。 */
function maskSecret(v: string): string {
  if (!v) return '（未填）';
  if (v.includes('...') || v.includes('•') || v === '****') return v; // 後端已遮罩
  if (v.length <= 8) return '••••••••';
  return `${v.slice(0, 4)}••••••••${v.slice(-4)}`;
}

const GUIDES: Record<string, ChannelGuide> = {
  FB: {
    title: 'Facebook Messenger 渠道欄位說明',
    intro:
      '這些欄位在 Meta for Developers 後台的 App 底下。請先建立 App 並加入 Messenger 產品、連結你的粉絲專頁。',
    consoleUrl: 'https://developers.facebook.com/apps/',
    consoleLabel: '前往 Meta for Developers',
    fields: [
      {
        field: 'App ID / App Secret',
        steps: [
          '進入 Meta for Developers，選擇你的 App',
          '左側選單點「App settings」→「Basic」',
          '頁面上方即可看到「App ID」；「App Secret」點「Show」輸入密碼後顯示，點複製取得',
        ],
        image: '/channel-guide/fb/fb-app-basic.png',
        imageAlt: 'Meta App settings → Basic 的 App ID 與 App Secret 位置',
        values: [
          { label: 'App ID', key: 'appId', secret: false },
          { label: 'App Secret', key: 'appSecret', secret: true },
        ],
      },
      {
        field: 'Page Access Token',
        steps: [
          '左側選單點「使用案例」→ 在「透過 Messenger from Meta 與顧客互動」右側點「自訂」',
          '進入後左側點「Messenger API 設定」，捲到「2. 產生存取權杖」區塊',
          '在要使用的粉絲專頁那列點「產生」，複製產生的權杖（EAA... 開頭）即為 Page Access Token',
        ],
        image: '/channel-guide/fb/fb-page-token.png',
        imageAlt: 'Meta「使用案例 → Messenger API 設定 → 2. 產生存取權杖」的粉專與產生按鈕',
        values: [{ label: 'Page Access Token', key: 'pageAccessToken', secret: true }],
      },
      {
        field: 'Page ID（選填）',
        values: [{ label: 'Page ID', key: 'pageId', secret: false }],
        steps: [
          '通常可留空——發送訊息用 Page Access Token 即可，不一定需要 Page ID',
          '若要填：新版粉專已隱藏編號，需到粉專後台「專業主控版」→ 進入「Meta Business Suite（商務套件）」',
          '在 Meta Business Suite 右上角「設定」→「查看所有設定」→ 左側「訊息」，找到 m.me/xxxxx 後面那串 15 位數字即為 Page ID',
          '（或用第三方查詢工具如 lookup-id.com，貼上粉專網址即可查出）',
        ],
      },
    ],
  },
  LINE: {
    title: 'LINE 渠道欄位說明',
    intro:
      '兩個欄位都在 LINE Developers Console 的 Messaging API channel 底下。請先登入並進入你的 channel。',
    consoleUrl: 'https://developers.line.biz/console/',
    consoleLabel: '前往 LINE Developers Console',
    fields: [
      {
        field: 'Channel Secret',
        steps: [
          '進入 LINE Developers Console，選擇你的 Provider 與 Messaging API channel',
          '點上方「Basic settings」分頁',
          '往下捲，找到「Channel secret」欄位，點複製圖示即可取得',
        ],
        image: '/channel-guide/line/line-secret.png',
        imageAlt: 'LINE Console Basic settings 的 Channel secret 欄位位置',
        values: [{ label: 'Channel Secret', key: 'channelSecret', secret: true }],
      },
      {
        field: 'Channel Access Token',
        steps: [
          '在同一個 channel，點上方「Messaging API」分頁',
          '往下捲到最底的「Channel access token」區塊',
          '若「Channel access token (long-lived)」為空，點「Issue」產生；已有則點複製圖示取得',
        ],
        image: '/channel-guide/line/line-token.png',
        imageAlt: 'LINE Console Messaging API 的 Channel access token 欄位位置',
        values: [{ label: 'Channel Access Token', key: 'channelAccessToken', secret: true }],
      },
    ],
  },
};

interface ChannelFieldGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelType: string;
  /** 目前表單填寫的值（key → 值），用來對照顯示「你現在填的內容」 */
  values?: Record<string, string>;
}

export function ChannelFieldGuide({ open, onOpenChange, channelType, values = {} }: ChannelFieldGuideProps) {
  const guide = GUIDES[channelType];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{guide?.title ?? '欄位說明'}</DialogTitle>
        </DialogHeader>

        {!guide ? (
          <p className="py-6 text-sm text-muted-foreground">
            此渠道的欄位說明尚未提供。
          </p>
        ) : (
          <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
            <div className="rounded-md bg-primary-subtle p-3 text-sm text-primary">
              {guide.intro}
              {guide.consoleUrl && (
                <>
                  {' '}
                  <a
                    href={guide.consoleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline underline-offset-2"
                  >
                    {guide.consoleLabel ?? '前往開發者後台'} ↗
                  </a>
                </>
              )}
            </div>

            {guide.fields.map((f, i) => (
              <div key={f.field} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                  <h4 className="text-sm font-semibold">{f.field}</h4>
                </div>
                <ol className="ml-8 list-decimal space-y-1 text-sm text-muted-foreground">
                  {f.steps.map((s, si) => (
                    <li key={si}>{s}</li>
                  ))}
                </ol>
                {f.values && f.values.length > 0 && (
                  <div className="ml-8 mt-2 space-y-1.5 rounded-md border border-border bg-muted/50 p-3">
                    <p className="text-xs font-medium text-muted-foreground">你目前填寫的內容：</p>
                    {f.values.map((v) => {
                      const raw = values[v.key] ?? '';
                      const filled = raw.length > 0;
                      const shown = !filled
                        ? '（尚未填寫）'
                        : v.secret
                          ? maskSecret(raw)
                          : raw;
                      return (
                        <div key={v.key} className="flex items-center gap-2 text-sm">
                          <span className="min-w-[130px] shrink-0 text-muted-foreground">{v.label}</span>
                          <code
                            className={`break-all font-mono text-xs ${
                              filled ? 'text-foreground' : 'text-muted-foreground/60 italic'
                            }`}
                          >
                            {shown}
                          </code>
                          {filled && v.secret && (
                            <span className="shrink-0 text-xs text-muted-foreground/60">（中間隱碼）</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {f.image && (
                  <figure className="ml-8 mt-2 overflow-hidden rounded-md border border-border">
                    <img src={f.image} alt={f.imageAlt ?? f.field} className="w-full" loading="lazy" />
                    {f.imageAlt && (
                      <figcaption className="bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                        {f.imageAlt}（值已隱碼）
                      </figcaption>
                    )}
                  </figure>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            關閉
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
