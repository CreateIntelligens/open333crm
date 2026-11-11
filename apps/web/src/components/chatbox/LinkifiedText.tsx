import { splitTextLinks } from '@open333crm/shared';

/**
 * 文字訊息：網址顯示成另開分頁的連結，其餘維持純文字（規格 webchat-widget、core-inbox）。
 * @param className 外層 `<p>` 的樣式；收件匣要加字級
 */
export function LinkifiedText({ text, className = 'whitespace-pre-wrap break-words' }: { text: string; className?: string }) {
  return (
    <p className={className}>
      {splitTextLinks(text).map((part, index) =>
        part.type === 'link' ? (
          <a key={index} className="underline break-all" href={part.value} target="_blank" rel="noopener noreferrer">
            {part.value}
          </a>
        ) : (
          part.value
        ),
      )}
    </p>
  );
}
