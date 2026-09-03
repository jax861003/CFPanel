// 用 Node 打包 dist-upload 为 deploy-panel-v2-upload.zip（跨平台，无需系统 zip）
import { readdir, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const srcDir = join(root, 'dist-upload');
const outZip = join(root, 'deploy-panel-v2-upload.zip');

// 极简 ZIP 打包（仅 store 存储，足够用于 Pages 控制台上传）
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function dosDateTime(date) {
  const t = date || new Date();
  return [
    (((t.getFullYear() - 1980) & 0x7f) << 9) | ((t.getMonth() + 1) << 5) | t.getDate(),
    (t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1)
  ];
}

async function collectFiles(dir, base = dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) out.push(...await collectFiles(full, base));
    else out.push({ name: relative(base, full).split('\\').join('/'), path: full });
  }
  return out;
}

const files = await collectFiles(srcDir);
const local = [];
const central = [];
let offset = 0;
const now = new Date();

for (const f of files) {
  const data = await readFile(f.path);
  const crc = crc32(data);
  const [dt, tm] = dosDateTime(now);
  const nameBuf = Buffer.from(f.name, 'utf8');
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);       // version needed
  localHeader.writeUInt16LE(0x0800, 6);   // flags: UTF-8
  localHeader.writeUInt16LE(0, 8);        // method: store
  localHeader.writeUInt16LE(dt, 12);
  localHeader.writeUInt16LE(tm, 14);
  localHeader.writeUInt32LE(crc, 16);
  localHeader.writeUInt32LE(data.length, 20);
  localHeader.writeUInt32LE(data.length, 24);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);
  local.push(Buffer.concat([localHeader, nameBuf, data]));
  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0x0800, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(dt, 12);
  centralHeader.writeUInt16LE(tm, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(data.length, 20);
  centralHeader.writeUInt32LE(data.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(offset, 42);
  central.push(Buffer.concat([centralHeader, nameBuf]));
  offset += localHeader.length + nameBuf.length + data.length;
}

const centralStart = offset;
const centralBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(central.length, 8);
eocd.writeUInt16LE(central.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(centralStart, 16);
eocd.writeUInt16LE(0, 20);

const zip = Buffer.concat([...local, centralBuf, eocd]);
await writeFile(outZip, zip);
console.log(`ZIP 已生成: ${outZip} (${zip.length} bytes, ${files.length} 个文件)`);
