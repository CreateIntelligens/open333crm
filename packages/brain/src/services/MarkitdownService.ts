import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execAsync = promisify(exec);

export const DEFAULT_ANYDOC_BASE_URLS = [
  'https://2md.aiurl.tw',
  'https://2md.glsoft.ai',
  'https://create360.ai',
] as const;

export interface MarkitdownServiceOptions {
  workspaceRoot?: string;
  baseUrls?: readonly string[];
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

/**
 * Service to convert various document formats (PDF, Docx, XLSX, etc.) to Markdown
 * using the 2md AnyDoc cloud API as primary engine, with local Python Markitdown fallback.
 */
export class MarkitdownService {
  private venvPath: string;
  private baseUrls: readonly string[];
  private fetchImpl: typeof fetch;
  private requestTimeoutMs: number;

  constructor(workspaceRootOrOptions?: string | MarkitdownServiceOptions) {
    let workspaceRoot = process.cwd();
    if (typeof workspaceRootOrOptions === 'string') {
      workspaceRoot = workspaceRootOrOptions;
      this.baseUrls = DEFAULT_ANYDOC_BASE_URLS;
      this.fetchImpl = globalThis.fetch;
      this.requestTimeoutMs = 15_000;
    } else if (workspaceRootOrOptions && typeof workspaceRootOrOptions === 'object') {
      workspaceRoot = workspaceRootOrOptions.workspaceRoot ?? process.cwd();
      this.baseUrls = workspaceRootOrOptions.baseUrls ?? DEFAULT_ANYDOC_BASE_URLS;
      this.fetchImpl = workspaceRootOrOptions.fetchImpl ?? globalThis.fetch;
      this.requestTimeoutMs = workspaceRootOrOptions.requestTimeoutMs ?? 15_000;
    } else {
      this.baseUrls = DEFAULT_ANYDOC_BASE_URLS;
      this.fetchImpl = globalThis.fetch;
      this.requestTimeoutMs = 15_000;
    }

    this.venvPath = path.join(workspaceRoot, 'packages', 'brain', '.venv', 'bin', 'markitdown');
  }

  /**
   * Converts a local file or buffer to Markdown.
   * Prioritizes 2md AnyDoc HTTP API and falls back to local python venv if present.
   * @param inputPath Absolute path to the input file
   * @returns The converted Markdown content
   */
  async convertToMarkdown(inputPath: string): Promise<string> {
    const fileBuffer = await fs.promises.readFile(inputPath);
    const filename = path.basename(inputPath);

    // 1. Attempt primary AnyDoc conversion via 2md base URLs
    let lastError: unknown;
    for (const baseUrl of this.baseUrls) {
      try {
        const result = await this.convertViaAnyDoc(fileBuffer, filename, baseUrl);
        if (result && result.trim()) {
          return result;
        }
      } catch (error) {
        lastError = error;
      }
    }

    // 2. Secondary fallback: local python markitdown utility if venv exists
    if (fs.existsSync(this.venvPath)) {
      try {
        const { stdout, stderr } = await execAsync(`"${this.venvPath}" "${inputPath}"`);
        if (stdout && stdout.trim()) {
          return stdout;
        }
        if (stderr && !stdout) {
          throw new Error(`Markitdown local error: ${stderr}`);
        }
      } catch (pythonError) {
        console.error('Markitdown local fallback failed:', pythonError);
      }
    }

    throw new Error(
      `Document conversion failed across all AnyDoc endpoints: ${
        lastError instanceof Error ? lastError.message : 'unknown error'
      }`
    );
  }

  /**
   * Sends document buffer to 2md AnyDoc HTTP endpoint via multipart form-data.
   */
  private async convertViaAnyDoc(
    fileBuffer: Buffer,
    filename: string,
    baseUrl: string
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const targetUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
      const formData = new FormData();
      formData.append('file', new Blob([fileBuffer]), filename);

      const response = await this.fetchImpl(targetUrl, {
        method: 'POST',
        headers: { Accept: 'application/json, text/plain;q=0.9', 'X-Preset': 'agent' },
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Upstream AnyDoc responded with HTTP ${response.status}`);
      }

      const rawText = await response.text();
      try {
        const json = JSON.parse(rawText) as Record<string, unknown>;
        if (typeof json.content === 'string') return json.content;
        if (typeof json.markdown === 'string') return json.markdown;
        if (json.data && typeof json.data === 'object') {
          const data = json.data as Record<string, unknown>;
          if (typeof data.content === 'string') return data.content;
          if (typeof data.markdown === 'string') return data.markdown;
        }
      } catch {
        // Response is raw markdown string
      }
      return rawText;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Converts a file and saves the result to a specified output path.
   * @param inputPath Absolute path to the input file
   * @param outputPath Absolute path to the output .md file
   */
  async convertAndSave(inputPath: string, outputPath: string): Promise<void> {
    const markdown = await this.convertToMarkdown(inputPath);
    await fs.promises.writeFile(outputPath, markdown, 'utf8');
  }
}
