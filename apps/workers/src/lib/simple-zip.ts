/**
 * 極簡 ZIP 打包（store 模式，不壓縮）。
 *
 * 專案未安裝 archiver / jszip / adm-zip 等套件，且 workers package 依賴精簡；
 * 為避免新增第三方依賴，這裡自實作最小可用的 ZIP（僅 store，無 deflate）。
 * 產出的 .zip 可被一般解壓工具正常開啟。
 *
 * 取捨：store 模式檔案較大（不壓縮），但實作簡單、零依賴、正確性易驗證。
 * 若日後匯出量大需壓縮，改用 archiver（deflate + streaming）即可，介面可相容。
 */
import { Buffer } from 'node:buffer';

interface ZipEntry {
  name: string;
  data: Buffer;
  crc: number;
  offset: number;
}

// 標準 CRC32（IEEE 802.3），ZIP 需要。
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// DOS 時間/日期（固定用當下時間，秒精度即可）
function dosDateTime(d: Date): { time: number; date: number } {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

/**
 * ZIP builder：逐檔 addFile()，最後 build() 回傳完整 Buffer。
 *
 * 逐檔累積可避免一次把「所有內容 + 壓縮結果」同時放記憶體；
 * 呼叫端應以 cursor 分頁一批批把資料序列化成 Buffer 後再 addFile，
 * 控制單檔大小（此處各表各一個 entry）。
 */
export class SimpleZip {
  private entries: ZipEntry[] = [];
  private chunks: Buffer[] = [];
  private offset = 0;
  private readonly dt = dosDateTime(new Date());

  addFile(name: string, content: Buffer | string): void {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const nameBuf = Buffer.from(name, 'utf8');

    // Local file header
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // signature
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(0, 8); // method 0 = store
    header.writeUInt16LE(this.dt.time, 10);
    header.writeUInt16LE(this.dt.date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18); // compressed size
    header.writeUInt32LE(data.length, 22); // uncompressed size
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28); // extra length

    this.entries.push({ name, data, crc, offset: this.offset });
    this.chunks.push(header, nameBuf, data);
    this.offset += header.length + nameBuf.length + data.length;
  }

  build(): Buffer {
    const central: Buffer[] = [];
    let centralSize = 0;
    for (const e of this.entries) {
      const nameBuf = Buffer.from(e.name, 'utf8');
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0); // central dir signature
      cd.writeUInt16LE(20, 4); // version made by
      cd.writeUInt16LE(20, 6); // version needed
      cd.writeUInt16LE(0, 8); // flags
      cd.writeUInt16LE(0, 10); // method store
      cd.writeUInt16LE(this.dt.time, 12);
      cd.writeUInt16LE(this.dt.date, 14);
      cd.writeUInt32LE(e.crc, 16);
      cd.writeUInt32LE(e.data.length, 20); // compressed
      cd.writeUInt32LE(e.data.length, 24); // uncompressed
      cd.writeUInt16LE(nameBuf.length, 28);
      cd.writeUInt16LE(0, 30); // extra
      cd.writeUInt16LE(0, 32); // comment
      cd.writeUInt16LE(0, 34); // disk number
      cd.writeUInt16LE(0, 36); // internal attrs
      cd.writeUInt32LE(0, 38); // external attrs
      cd.writeUInt32LE(e.offset, 42); // local header offset
      central.push(cd, nameBuf);
      centralSize += cd.length + nameBuf.length;
    }

    const centralOffset = this.offset;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
    eocd.writeUInt16LE(0, 4); // disk
    eocd.writeUInt16LE(0, 6); // disk with CD
    eocd.writeUInt16LE(this.entries.length, 8); // entries this disk
    eocd.writeUInt16LE(this.entries.length, 10); // total entries
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralOffset, 16);
    eocd.writeUInt16LE(0, 20); // comment length

    return Buffer.concat([...this.chunks, ...central, eocd]);
  }
}

/** 把物件陣列轉 CSV（主表扁平化，值含逗號/引號/換行時加引號跳脫）。 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = Array.from(
    rows.reduce<Set<string>>((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()),
  );
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    let s: string;
    if (typeof v === 'object') s = JSON.stringify(v);
    else s = String(v);
    if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(',')];
  for (const row of rows) {
    lines.push(cols.map((c) => escape(row[c])).join(','));
  }
  return lines.join('\r\n');
}
