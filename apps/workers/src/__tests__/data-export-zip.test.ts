/**
 * data-export 打包工具測試（tsx 自跑）。
 * 涵蓋：
 *  - SimpleZip 產出可被系統 unzip 正常解開（結構正確）
 *  - 解開後內容與寫入一致（CRC / store 正確）
 *  - toCsv 主表扁平化與跳脫正確
 */
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { SimpleZip, toCsv } from '../lib/simple-zip.js';

function testCsv() {
  const csv = toCsv([
    { id: '1', name: 'Alice', note: 'a,b' },
    { id: '2', name: 'Bob "B"', note: 'line1\nline2' },
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'id,name,note');
  // 含逗號要加引號
  assert.ok(lines[1].includes('"a,b"'));
  // 引號要跳脫成雙引號、換行值要加引號
  assert.ok(lines[2].includes('"Bob ""B"""'));
  assert.ok(lines[2].includes('"line1\nline2"'));
  console.log('  ✓ toCsv escaping');
}

function testZipRoundtrip() {
  const zip = new SimpleZip();
  const jsonContent = JSON.stringify({ tenantId: 'tenant-1', hello: '世界' });
  zip.addFile('manifest.json', jsonContent);
  zip.addFile('csv/contacts.csv', 'id,name\r\n1,Alice');
  const buffer = zip.build();

  // EOCD 簽章存在
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50);

  // 寫檔並用系統 unzip 驗證可解開
  const dir = mkdtempSync(join(tmpdir(), 'export-zip-'));
  const zipPath = join(dir, 'out.zip');
  writeFileSync(zipPath, buffer);

  // unzip -l 應成功列出兩個檔案
  const listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
  assert.ok(listing.includes('manifest.json'), 'zip 應含 manifest.json');
  assert.ok(listing.includes('csv/contacts.csv'), 'zip 應含 csv/contacts.csv');

  // 解開並比對內容一致（驗 CRC / store 正確）
  execFileSync('unzip', ['-o', zipPath, '-d', dir], { encoding: 'utf8' });
  assert.ok(existsSync(join(dir, 'manifest.json')));
  assert.equal(readFileSync(join(dir, 'manifest.json'), 'utf8'), jsonContent);
  assert.equal(readFileSync(join(dir, 'csv/contacts.csv'), 'utf8'), 'id,name\r\n1,Alice');
  console.log('  ✓ SimpleZip roundtrip (system unzip)');
}

testCsv();
testZipRoundtrip();
console.log('data-export-zip tests passed');
process.exit(0);
