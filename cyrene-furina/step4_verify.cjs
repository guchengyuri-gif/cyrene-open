'use strict';
// 校验新 app.asar：补丁标记 / furina 条目 / 设置页 / 动作表 / 与现网逐条对比
const fs = require('fs');
const NEW = 'D:/ai/program/cyrene-furina/out/app.asar';
const OLD = 'C:\\Users\\ADMIN\\AppData\\Local\\Programs\\Cyrene\\resources\\app.asar';

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
      else map.set(p2, { size: v.size, offset: Number(v.offset), unpacked: !!v.unpacked });
    }
  })(root, '');
  return { fd, dataStart, map, fileSize: fs.statSync(p).size };
}
function readEntry(a, rel) {
  const e = a.map.get('/' + rel.replace(/^\//, ''));
  if (!e) return null;
  const b = Buffer.alloc(e.size);
  fs.readSync(a.fd, b, 0, e.size, a.dataStart + e.offset);
  return b;
}

const n = openAsar(NEW);
console.log('== NEW asar ==');
console.log('size:', n.fileSize, '| entries:', n.map.size, '| dataStart:', n.dataStart);

const fur = [...n.map.keys()].filter((k) => k.startsWith('/dist/renderer/models/furina/')).sort();
console.log('\n[furina] entries:', fur.length);
for (const k of fur) console.log('   ', k, n.map.get(k).size);

const mj = JSON.parse(readEntry(n, 'dist/renderer/models/furina/Furina.model3.json').toString('utf8'));
const base = 'dist/renderer/models/furina/';
const refs = [mj.FileReferences.Moc, ...(mj.FileReferences.Textures || []), mj.FileReferences.Physics, mj.FileReferences.DisplayInfo,
  ...Object.values(mj.FileReferences.Motions || {}).flat().map((x) => x.File),
  ...(mj.FileReferences.Expressions || []).map((x) => x.File)];
let missing = 0;
for (const r of refs) if (!n.map.has('/' + base + r)) { console.log('   MISSING ref:', r); missing++; }
console.log('[furina] refs:', refs.length, '| missing:', missing,
  '| motionGroups:', Object.keys(mj.FileReferences.Motions).join('+'),
  '| expressions:', mj.FileReferences.Expressions.length,
  '| Groups:', mj.Groups.map((g) => g.Name).join('+'));

const tr = readEntry(n, 'dist/main/main/orchestrator/task-runtime.js').toString('utf8');
const ts = readEntry(n, 'dist/main/main/tasks/task-session-store.js').toString('utf8');
console.log('\n[PATCH] task-runtime onEvent batched :', tr.includes('onEvent: ((b,l)=>(e)=>'));
console.log('[PATCH] task-session-store compact  :', !ts.includes('JSON.stringify(value, null, 2)'));
console.log('[PATCH] task-runtime raw marker gone:', !tr.includes('onEvent: (event) => {'));

const h = readEntry(n, 'dist/renderer/settings/index.html').toString('utf8');
console.log('[settings] furina option:', h.includes('value="furina"'),
  '| cyrene option:', h.includes('value="cyrene"'));
for (const rel of ['dist/main/shared/live2d-actions.js', 'dist/preload/shared/live2d-actions.js']) {
  const s = readEntry(n, rel).toString('utf8');
  console.log('[actions]', rel, 'furina table:', s.includes('furina:'));
}

console.log('\n== 与现网安装版逐条对比（内容级）==');
const o = openAsar(OLD);
const skip = new Set(['/dist/renderer/settings/index.html', '/dist/main/shared/live2d-actions.js', '/dist/preload/shared/live2d-actions.js']);
const onlyOld = [], diff = [];
for (const [k] of o.map) {
  if (skip.has(k)) continue;
  if (!n.map.has(k)) { onlyOld.push(k); continue; }
  if (!readEntry(o, k).equals(readEntry(n, k))) diff.push(k);
}
const onlyNew = [];
for (const k of n.map.keys()) if (!o.map.has(k)) onlyNew.push(k);
console.log('only in OLD (应为 0):', onlyOld.length); onlyOld.slice(0, 20).forEach((k) => console.log('   -', k));
console.log('content differs (应为 0):', diff.length); diff.slice(0, 20).forEach((k) => console.log('   ~', k));
console.log('only in NEW (应为 furina 的', fur.length, '个):', onlyNew.length);
onlyNew.slice(0, 40).forEach((k) => console.log('   +', k));

const ok = onlyOld.length === 0 && diff.length === 0 && missing === 0 &&
  onlyNew.length === fur.length && tr.includes('onEvent: ((b,l)=>(e)=>') && !ts.includes('JSON.stringify(value, null, 2)') && h.includes('value="furina"');
console.log('\n===== 校验结论:', ok ? 'PASS ✅' : 'FAIL ❌', '=====');
fs.closeSync(n.fd); fs.closeSync(o.fd);
