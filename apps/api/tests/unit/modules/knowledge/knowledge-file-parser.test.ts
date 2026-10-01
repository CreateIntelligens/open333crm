import assert from 'node:assert/strict';
import * as XLSX from '@e965/xlsx';
import { parseSpreadsheetToQaRows, parseFileToMarkdown } from '../modules/knowledge/file-parser.service.js';

const worksheet = XLSX.utils.aoa_to_sheet([
  ['question', 'answer'],
  ['How do I reset my password?', 'Use the reset link on the login page.'],
]);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, 'FAQ');
const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

assert.deepEqual(parseSpreadsheetToQaRows(buffer), [{
  title: 'How do I reset my password?',
  content: 'Use the reset link on the login page.',
}]);

const markdown = parseFileToMarkdown(buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'faq.xlsx');
assert.equal((await markdown).content.includes('How do I reset my password?'), true);

console.log('knowledge file parser tests passed');
