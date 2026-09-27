'use strict';
// 全量核对：历次 asar 补丁的 orig 备份 vs 现网/新包 实际内容
//   相同 → 补丁不在了（被覆盖/回退）；不同 → 补丁在位
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BACKUPS = 'D:/ai/program/cyrene-tuning/backups';
const PERF = 'D:/ai/program/cyrene-asar-patch/perf-patch-20260915';
const ASARS = [
  ['C:/Users/ADMIN/AppData/Local/Programs/Cyrene/resources/app.asar', '现网'],
  ['D:/ai/program/cyrene-furina/out/app.asar', '新包'],
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
  if (!e) return null;
  const b = Buffer.alloc(e.size);
  fs.readSync(a.fd, b, 0, e.size, a.dataStart + e.offset);
  return b;
}

// ---- 收集基准（补丁前的原件） ----
const cases = [];
if (fs.existsSync(BACKUPS)) {
  for (const d of fs.readdirSync(BACKUPS)) {
    const mp = path.join(BACKUPS, d, 'manifest.json');
    if (!fs.existsSync(mp)) continue;
    let m;
    try { m = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch { continue; }
    for (const f of (m.files || [])) {
      const op = path.join(BACKUPS, d, f.savedAs);
      if (!fs.existsSync(op)) continue;
      cases.push({ set: d, rel: f.rel.replace(/\\/g, '/'), orig: fs.readFileSync(op) });
    }
  }
}
// perf-patch（chats-store）三个版本
const CS = 'dist/main/main/chats/chats-store.js';
for (const [f, tag] of [['chats-store.orig.js', 'orig'], ['chats-store.v1.js', 'v1'], ['chats-store.patched.js', 'v2(patched)']]) {
  const p = path.join(PERF, f);
  if (fs.existsSync(p)) cases.push({ set: 'perf-patch-20260915', rel: CS, orig: fs.readFileSync(p), note: tag });
}
// 去重（同 rel+set）
const seen = new Set();
const uniq = cases.filter((c) => { const k = c.set + '|' + c.rel + '|' + (c.note || ''); if (seen.has(k)) return false; seen.add(k); return true; });

console.log('基准条目数：', uniq.length, '\n');

for (const [p, label] of ASARS) {
  console.log('==================== ' + label + ' ====================');
  if (!fs.existsSync(p)) { console.log('  [缺失]'); continue; }
  const a = openAsar(p);
  try {
    let lastSet = null;
    for (const c of uniq) {
      if (c.set !== lastSet) { console.log('\n-- 补丁批次: ' + c.set + ' --'); lastSet = c.set; }
      const cur = readEntry(a, c.rel);
      if (!cur) { console.log(`  [文件不存在] ${c.rel}`); continue; }
      const same = cur.equals(c.orig);
      const tag = c.note ? (' 基准=' + c.note) : '';
      console.log(`  ${same ? '○ 补丁不在(与基准原件一致)' : '● 补丁在位(与基准原件不同)'}  ${c.rel}${tag}`);
      console.log(`      asar内 ${cur.length}B md5=${md5(cur)}`);
      console.log(`      基准件 ${c.orig.length}B md5=${md5(c.orig)}`);
    }
  } finally { fs.closeSync(a.fd); }
  console.log('');
}
console.log('完成。');
