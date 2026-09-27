'use strict';
// 剖析现网 asar 的顶层构成，确认是否夹带备份目录、是否有 unpacked 条目
const fs = require('fs');
const ASAR = 'C:\\Users\\ADMIN\\AppData\\Local\\Programs\\Cyrene\\resources\\app.asar';

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
    for (const n of Object.keys(files)) {
      const v = files[n];
      const p2 = prefix + '/' + n;
      if (v.files) walk(v, p2);
      else map.set(p2, { size: v.size, offset: Number(v.offset), unpacked: !!v.unpacked });
    }
  })(root, '');
  return { fd, dataStart, map, fileSize: fs.statSync(p).size };
}

const a = openAsar(ASAR);
let unpacked = 0, total = 0;
const top = new Map();
for (const [k, v] of a.map) {
  if (v.unpacked) unpacked++;
  total += v.size;
  const seg = k.split('/')[1] || '(root)';
  top.set(seg, (top.get(seg) || 0) + v.size);
}
console.log('asar size      :', a.fileSize);
console.log('data total     :', total, '(' + (total / 1048576).toFixed(1) + ' MB)');
console.log('unpacked count :', unpacked);
console.log('--- top-level breakdown (MB) ---');
for (const [k, s] of [...top].sort((x, y) => y[1] - x[1])) {
  console.log(String((s / 1048576).toFixed(1)).padStart(9), k);
}
console.log('--- prefix probes ---');
for (const prefix of ['/dist-backup-pre-multimodel', '/dist/renderer-old', '/assets', '/vendor', '/node_modules', '/dist/renderer/models/cyrene']) {
  const ks = [...a.map.keys()].filter((k) => k.startsWith(prefix));
  const sz = ks.reduce((s, k) => s + a.map.get(k).size, 0);
  console.log(prefix, '-> entries', ks.length, '|', (sz / 1048576).toFixed(1), 'MB');
}
fs.closeSync(a.fd);
