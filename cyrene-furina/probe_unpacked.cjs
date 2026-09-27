'use strict';
// 检查现网 asar 的 header：哪些条目是 unpacked，以及 unpacked 目录实际内容
const fs = require('fs');
const path = require('path');
const INSTALLED = 'C:\\Users\\ADMIN\\AppData\\Local\\Programs\\Cyrene\\resources\\app.asar';
const UNPACKED_DIR = 'C:\\Users\\ADMIN\\AppData\\Local\\Programs\\Cyrene\\resources\\app.asar.unpacked';

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
  return { fd, dataStart, map, headerSize, fileSize: fs.statSync(p).size };
}

const a = openAsar(INSTALLED);
console.log('asar size       :', a.fileSize);
console.log('header size     :', a.headerSize);
console.log('total entries   :', a.map.size);
const unpacked = [...a.map.entries()].filter(([, v]) => v.unpacked);
console.log('unpacked entries:', unpacked.length);
const dirs = new Set();
for (const [k] of unpacked) dirs.add(path.posix.dirname(k));
console.log('unpacked dirs   :', [...dirs].slice(0, 30).join(' | '));
console.log('\n-- first 20 unpacked files --');
for (const [k, v] of unpacked.slice(0, 20)) console.log('  ', k, v.size);

// models 条目
const models = [...a.map.keys()].filter((k) => k.startsWith('/dist/renderer/models/'));
console.log('\nmodels entries  :', models.length);
console.log('models unpacked?:', models.filter((k) => a.map.get(k).unpacked).length);

// unpacked 目录顶层
console.log('\n== app.asar.unpacked top-level ==');
try {
  for (const e of fs.readdirSync(UNPACKED_DIR, { withFileTypes: true })) {
    console.log('  ', e.isDirectory() ? '[D]' : '[F]', e.name);
  }
} catch (e) { console.log('  ERR', e.message); }

console.log('\n== app.asar.unpacked/dist ==');
try {
  for (const e of fs.readdirSync(path.join(UNPACKED_DIR, 'dist'), { withFileTypes: true })) {
    console.log('  ', e.isDirectory() ? '[D]' : '[F]', e.name);
  }
} catch (e) { console.log('  ERR', e.message); }
fs.closeSync(a.fd);
