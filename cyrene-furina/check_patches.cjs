'use strict';
// 校验任意 asar 内「卡顿补丁」是否在位（chats-store v2 + task-trace 两件）
const fs = require('fs');
const crypto = require('crypto');

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
  return { fd, dataStart, map, fileSize: fs.statSync(p).size };
}
function readEntry(a, rel) {
  const e = a.map.get('/' + rel.replace(/^\//, ''));
  if (!e) return null;
  const b = Buffer.alloc(e.size);
  fs.readSync(a.fd, b, 0, e.size, a.dataStart + e.offset);
  return b;
}
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

const TARGETS = [
  ['C:/Users/ADMIN/AppData/Local/Programs/Cyrene/resources/app.asar', '现网(已安装)'],
  ['D:/ai/program/cyrene-furina/out/app.asar', '新包(待部署)'],
  ['D:/ai/program/cyrene-furina/backup/app.asar.before-furina', '芙宁娜前回滚点'],
];

for (const [p, label] of TARGETS) {
  console.log('\n================ ' + label + ' ================');
  console.log('path:', p);
  if (!fs.existsSync(p)) { console.log('  [缺失] 文件不存在'); continue; }
  const a = openAsar(p);
  try {
    console.log('  size:', a.fileSize, '| entries:', a.map.size);

    // 1) chats-store.js (09-15 v2 补丁：缓存 + 紧凑 + 去冗余扁平 reasoning)
    const cs = readEntry(a, 'dist/main/main/chats/chats-store.js');
    if (!cs) console.log('  [!!] chats-store.js 不存在');
    else {
      const s = cs.toString('utf8');
      const h = md5(cs);
      const known = { e822e9005ebba179400f373383a1bb2c: 'v2(缓存+紧凑+去冗余)', '640aa983f93cda31ee37de33847e2778': 'v1(缓存+紧凑)', '962b9bff417ea800219c3cfa9be98931': 'orig(未打补丁)' }[h] || '未知';
      console.log(`  chats-store.js  ${cs.length}B  md5=${h}  → ${known}`);
      console.log('     sessionCacheId 缓存:', s.includes('let sessionCacheId = null;'));
      console.log('     紧凑序列化:', s.includes('JSON.stringify(data)') && !s.includes('JSON.stringify(data, null, 2)'));
      console.log('     去冗余 slimSession:', s.includes('function slimSession'));
    }

    // 2) task-runtime.js (09-26 task-trace 补丁 ①)
    const tr = readEntry(a, 'dist/main/main/orchestrator/task-runtime.js');
    if (!tr) console.log('  [!!] task-runtime.js 不存在');
    else {
      const s = tr.toString('utf8');
      console.log(`  task-runtime.js ${tr.length}B  md5=${md5(tr)}`);
      console.log('     onEvent 批处理(1s节流+delta合并):', s.includes('onEvent: ((b,l)=>(e)=>'));
      console.log('     旧写法残留 onEvent: (event) => :', s.includes('onEvent: (event) => {'));
    }

    // 3) task-session-store.js (09-26 task-trace 补丁 ②)
    const ts = readEntry(a, 'dist/main/main/tasks/task-session-store.js');
    if (!ts) console.log('  [!!] task-session-store.js 不存在');
    else {
      const s = ts.toString('utf8');
      console.log(`  task-session-store.js ${ts.length}B  md5=${md5(ts)}`);
      console.log('     紧凑落盘(无 null,2):', !s.includes('JSON.stringify(value, null, 2)'));
      console.log('     旧写法残留:', s.includes('JSON.stringify(value, null, 2)'));
    }
  } finally { fs.closeSync(a.fd); }
}
console.log('\n完成。');
