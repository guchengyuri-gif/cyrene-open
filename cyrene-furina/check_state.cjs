'use strict';
// 核对：现网安装版 app.asar 与 cyrene-asar-extract 镜像的实际状态
const fs = require('fs');
const crypto = require('crypto');
const INSTALLED = 'C:\\Users\\ADMIN\\AppData\\Local\\Programs\\Cyrene\\resources\\app.asar';
const EXTRACT = 'D:/ai/program/cyrene-asar-extract';

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
      const p = prefix + '/' + n;
      if (v.files) walk(v, p);
      else map.set(p, { size: v.size, offset: Number(v.offset), unpacked: !!v.unpacked });
    }
  })(root, '');
  return { fd, dataStart, map, fileSize: fs.statSync(p).size };
}
function readEntry(a, rel) {
  const e = a.map.get('/' + rel.replace(/^\//, ''));
  if (!e) return null;
  const buf = Buffer.alloc(e.size);
  fs.readSync(a.fd, buf, 0, e.size, a.dataStart + e.offset);
  return buf;
}
function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

const a = openAsar(INSTALLED);
console.log('== INSTALLED asar (现网安装版) ==');
console.log('size       :', a.fileSize);
console.log('dataStart  :', a.dataStart);
console.log('entries    :', a.map.size);

const TR_REL = 'dist/main/main/orchestrator/task-runtime.js';
const TS_REL = 'dist/main/main/tasks/task-session-store.js';
const trBuf = readEntry(a, TR_REL);
const tsBuf = readEntry(a, TS_REL);
const tr = trBuf.toString('utf8');
const ts = tsBuf.toString('utf8');
console.log('task-runtime patched(onEvent batched)?', tr.includes('onEvent: ((b,l)=>(e)=>'));
console.log('task-runtime raw marker present?       ', tr.includes('onEvent: (event) => {'));
console.log('task-session-store pretty JSON present?', ts.includes('JSON.stringify(value, null, 2)'));
console.log('task-runtime sha256:', sha(trBuf).slice(0, 16));
console.log('task-store   sha256:', sha(tsBuf).slice(0, 16));

const models = [...a.map.keys()].filter((k) => k.startsWith('/dist/renderer/models/'));
console.log('models entries:', models.length);
for (const m of models.slice(0, 60)) console.log('   ', m);

const settings = readEntry(a, 'dist/renderer/settings/index.html');
if (settings) {
  const h = settings.toString('utf8');
  const i = h.indexOf('pet-model');
  console.log('settings pet-model ctx:', i < 0 ? '(none)' : JSON.stringify(h.slice(Math.max(0, i - 250), i + 500)));
} else {
  console.log('settings/index.html: NOT FOUND');
}

// 渲染层模型加载正则 / 动作表
const LM = readEntry(a, 'dist/main/shared/live2d-actions.js') || readEntry(a, 'dist/preload/shared/live2d-actions.js');
if (LM) {
  const s = LM.toString('utf8');
  const i = s.indexOf('LIVE2D_MODEL_ACTIONS');
  console.log('live2d-actions head:', i < 0 ? '(none)' : s.slice(i, i + 300));
} else { console.log('live2d-actions.js: not found at shared paths'); }
fs.closeSync(a.fd);

console.log('\n== EXTRACT dir (cyrene-asar-extract) ==');
function stat(p) { try { const st = fs.statSync(p); return 'mtime=' + new Date(st.mtimeMs).toISOString() + ' size=' + st.size; } catch (e) { return 'MISSING'; } }
console.log('extract dist/main/orchestrator/task-runtime.js:', stat(EXTRACT + '/' + TR_REL));
const etrBuf = new Uint8Array(fs.readFileSync(EXTRACT + '/' + TR_REL));
let etr = Buffer.from(etrBuf).toString('utf8');
console.log('extract task-runtime patched?', etr.includes('onEvent: ((b,l)=>(e)=>'), '| raw marker?', etr.includes('onEvent: (event) => {'));
console.log('extract task-runtime sha256:', sha(Buffer.from(etrBuf)).slice(0, 16));
try {
  const ets = fs.readFileSync(EXTRACT + '/' + TS_REL, 'utf8');
  console.log('extract task-session-store pretty present?', ets.includes('JSON.stringify(value, null, 2)'));
} catch (e) { console.log('extract task-session-store: ERR', e.message); }
console.log('extract models dir:', stat(EXTRACT + '/dist/renderer/models'));
console.log('--- match check (installed vs extract) ---');
console.log('task-runtime identical?', sha(trBuf).slice(0, 16) === sha(Buffer.from(etrBuf)).slice(0, 16));
