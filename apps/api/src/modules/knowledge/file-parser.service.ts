import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import * as XLSX from 'xlsx';

export interface ParsedFile {
  title: string;
  content: string;
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

const MIME_MAP: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'text/html': 'html',
  'text/markdown': 'md',
  'text/plain': 'txt',
};

function detectFormat(mimetype: string, filename: string): string {
  // Try mimetype first
  const fromMime = MIME_MAP[mimetype];
  if (fromMime) return fromMime;

  // Fallback to extension
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  if (['pdf', 'docx', 'xlsx', 'csv', 'html', 'htm', 'md', 'txt'].includes(ext)) {
    return ext === 'htm' ? 'html' : ext;
  }

  throw new Error(`Unsupported file format: ${mimetype} / ${filename}`);
}

function titleFromFilename(filename: string): string {
  const base = path.basename(filename);
  const ext = path.extname(base);
  return base.slice(0, base.length - ext.length);
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const pdf = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await pdf.getText();
  await pdf.destroy();
  return result.text.trim();
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer });
  return turndown.turndown(result.value);
}

function parseXlsx(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const parts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
    if (rows.length === 0) continue;

    if (workbook.SheetNames.length > 1) {
      parts.push(`## ${sheetName}\n`);
    }

    // Build Markdown table
    const header = rows[0].map((c) => String(c ?? ''));
    const separator = header.map(() => '---');
    const tableRows = [
      `| ${header.join(' | ')} |`,
      `| ${separator.join(' | ')} |`,
    ];

    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].map((c) => String(c ?? ''));
      // Pad to header length
      while (cells.length < header.length) cells.push('');
      tableRows.push(`| ${cells.join(' | ')} |`);
    }

    parts.push(tableRows.join('\n'));
  }

  return parts.join('\n\n');
}

function parseCsv(buffer: Buffer): string {
  // XLSX can also parse CSV — reuse the same xlsx parser
  return parseXlsx(buffer);
}

function parseHtml(buffer: Buffer): string {
  const html = buffer.toString('utf-8');
  return turndown.turndown(html);
}

function parsePlainText(buffer: Buffer): string {
  return buffer.toString('utf-8').trim();
}

export async function parseFileToMarkdown(
  buffer: Buffer,
  mimetype: string,
  filename: string,
): Promise<ParsedFile> {
  const format = detectFormat(mimetype, filename);
  const title = titleFromFilename(filename);

  let content: string;

  switch (format) {
    case 'pdf':
      content = await parsePdf(buffer);
      break;
    case 'docx':
      content = await parseDocx(buffer);
      break;
    case 'xlsx':
      content = parseXlsx(buffer);
      break;
    case 'csv':
      content = parseCsv(buffer);
      break;
    case 'html':
      content = parseHtml(buffer);
      break;
    case 'md':
    case 'txt':
      content = parsePlainText(buffer);
      break;
    default:
      throw new Error(`Unsupported format: ${format}`);
  }

  if (!content || content.trim().length === 0) {
    throw new Error(`No content could be extracted from ${filename}`);
  }

  return { title, content };
}
