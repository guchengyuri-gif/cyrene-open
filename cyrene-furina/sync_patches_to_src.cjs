'use strict';
/* 把 out/app.asar 里【已打补丁】的 3 个文件回写到 work/src，
 * 这样以后从 work/src 重跑 step3_pack.cjs 也不会丢补丁。
 */
const fs = require('fs');
const crypto = require('crypto');

const ASAR = 'D:/ai/program/cyrene-furina/out/app.asar';
const SRC = 'D:/ai/program/cyrene-furina/work/src';
const RELS = [
  'dist/main/main/chats/chats-store.js',
  'dist/main/main/orchestrator/harness/tool-round.js',
  'dist/main/main/orchestrator/harness/tool-dispatcher.js',
];
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

function openAsar(p) {
  const fd = fs.openSync(p, 'r');
  const hb = Buffer.alloc(8);
  fs.readSync(fd, hb, 0, 8, 0);
  const headerSize = hb.readUInt32LE(4);
  const region = Buffer.alloc(headerSize);
  fs.readSync(fd, region, 0, headerSize, 8);
  const s = region.toString('utf8');
  const root = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
  const dataStart = 8 + headerSize;
  const map = new Map();
  (function walk(node, prefix) {
    const files = node.files || {};
    for (const nm of Object.keys(files)) {
      const v = files[nm];
      const p2 = prefix + '/' + nm;
      if (v.files) walk(v, p2);
      else map.set(p2, { size: v.size, offset: Number(v.offset) });
    }
  })(root, '');
  return { fd, dataStart, map };
}
function readEntry(a, rel) {
  const e = a.map.get('/' + rel.replace(/^\//, ''));
  if (!e) throw new Error('asar 内找不到: ' + rel);
  const b = Buffer.alloc(e.size);
  fs.readSync(a.fd, b, 0, e.size, a.dataStart + e.offset);
  return b;
}

const a = openAsar(ASAR);
let fail = 0;
try {
  for (const rel of RELS) {
    const buf = readEntry(a, rel);
    const dst = SRC + '/' + rel;
    const before = fs.existsSync(dst) ? fs.readFileSync(dst) : null;
    if (before && before.equals(buf)) {
      console.log('  跳过（已一致）', rel, md5(buf));
      continue;
    }
    fs.writeFileSync(dst, buf);
    const after = fs.readFileSync(dst);
    const ok = after.equals(buf);
    if (!ok) fail++;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${rel}`);
    console.log(`        src ${before ? before.length + 'B ' + md5(before) : '(新建)'}  →  ${after.length}B ${md5(after)}`);
  }
} finally { fs.closeSync(a.fd); }
console.log(fail ? '\n!! 有写入失败' : '\n★ 源树已同步（重跑 step3_pack.cjs 也不会丢补丁）');
process.exit(fail ? 1 : 0);
