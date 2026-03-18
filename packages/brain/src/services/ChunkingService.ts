/**
 * Service to split text into chunks for vectorization.
 * Supports basic semantic boundaries like double newlines or sentences.
 */
export class ChunkingService {
  private chunkSize: number;
  private chunkOverlap: number;

  constructor(chunkSize = 1000, chunkOverlap = 200) {
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
  }

  /**
   * Splits a Markdown string into chunks.
   * @param text The input Markdown text
   * @returns Array of character-indexed chunks with overlap
   */
  split(text: string): string[] {
    if (!text || text.trim().length === 0) return [];

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + this.chunkSize;

      // Try to find a better breakpoint (e.g., double newline or sentence end)
      if (end < text.length) {
        const nextDoubleNewline = text.indexOf('\n\n', end - 100);
        if (nextDoubleNewline !== -1 && nextDoubleNewline < end + 200) {
          end = nextDoubleNewline + 2;
        } else {
          const nextNewline = text.indexOf('\n', end - 50);
          if (nextNewline !== -1 && nextNewline < end + 100) {
            end = nextNewline + 1;
          }
        }
      }

      chunks.push(text.slice(start, end).trim());
      
      // Move window with overlap
      start = end - this.chunkOverlap;
      
      // Safety break for infinite loop if end didn't advance
      const lastChunk = chunks[chunks.length - 1];
      if (lastChunk && start <= lastChunk.length - text.slice(0, start).length) {
        // This is a bit simplified, but ensures we don't get stuck
        start = end;
      }
    }

    return chunks.filter(c => c.length > 10);
  }
}
