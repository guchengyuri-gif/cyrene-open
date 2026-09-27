'use strict';
// step6：校验含「外部模型目录」改造的新 asar
//   期望：与现网逐条对比时，差异恰好是 3 个被改造的文件；其余全部一致
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

let fail = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fail++; };

const n = openAsar(NEW);
console.log('== NEW asar ==');
console.log('  size:', n.fileSize, '| entries:', n.map.size, '| dataStart:', n.dataStart);

// --- 定位被改造的 renderer bundle ---
let bundle = null;
for (const k of n.map.keys()) {
  if (!/^\/dist\/renderer\/assets\/renderer-[^/]+\.js$/.test(k)) continue;
  if (k.includes('renderer-base-')) continue;
  const s = readEntry(n, k).toString('utf8');
  if (s.includes('function hx(r)')) { bundle = k; break; }
}
console.log('\n== 1) 三处改造标记 ==');
ok(!!bundle, 'renderer bundle 定位: ' + bundle);

const boot = readEntry(n, 'dist/main/main/protocols/bootstrap.js').toString('utf8');
ok(boot.includes('{ scheme: "cyrene-model", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }'), 'bootstrap: scheme');
ok(boot.includes('electron_1.protocol.handle("cyrene-model"'), 'bootstrap: handler');
ok(boot.includes('"pet-models"'), 'bootstrap: userData/pet-models');
ok(boot.includes('app.getAppPath(), "dist", "renderer", "models"'), 'bootstrap: asar 回退');
ok(boot.includes('file.startsWith(base + path.sep)'), 'bootstrap: 穿越防护');

const rb = bundle ? readEntry(n, bundle).toString('utf8') : '';
ok(rb.includes('cyrene-model://pet/'), 'renderer: hx 返回协议 URL');
ok(!rb.includes('ef(hx('), 'renderer: ef 包装已去除');
ok(rb.includes('const t=hx(r)'), 'renderer: 调用点已直连');

const html = readEntry(n, 'dist/renderer/settings/index.html').toString('utf8');
ok(html.includes('id="pet-model-presets"'), 'settings: datalist');
ok(!html.includes('<select id="pet-model"'), 'settings: select 已替换');
ok(html.includes('value="cyrene"') && html.includes('value="furina"'), 'settings: cyrene/furina 候选');

// --- 旧功能回归 ---
console.log('\n== 2) 旧功能回归 ==');
const fur = [...n.map.keys()].filter((k) => k.startsWith('/dist/renderer/models/furina/'));
ok(fur.length === 26, 'furina 条目 26 个（实际 ' + fur.length + '）');
const cyr = [...n.map.keys()].filter((k) => k.startsWith('/dist/renderer/models/cyrene/'));
console.log('  INFO  cyrene 条目', cyr.length, '个');
const cs = readEntry(n, 'dist/main/main/chats/chats-store.js').toString('utf8');
ok(cs.includes('let sessionCacheId = null;'), '补丁: chats-store 单会话缓存');
ok(!cs.includes('JSON.stringify(data, null, 2)') && cs.includes('JSON.stringify(data)'), '补丁: chats-store 紧凑序列化');
ok(cs.includes('function slimSession'), '补丁: chats-store 去冗余 reasoning');
const tdis = readEntry(n, 'dist/main/main/orchestrator/harness/tool-dispatcher.js').toString('utf8');
ok(tdis.includes('thresholdChars: 8_000'), '补丁: tool-dispatcher 阈值 8K');
ok(!tdis.includes('thresholdChars: 30_000'), '补丁: tool-dispatcher 旧阈值已不在');
const trd = readEntry(n, 'dist/main/main/orchestrator/harness/tool-round.js').toString('utf8');
ok(trd.includes('delete modelObservation.message') && trd.includes('delete modelObservation.preview'), '补丁: tool-round 去三副本');
const tr = readEntry(n, 'dist/main/main/orchestrator/task-runtime.js').toString('utf8');
const ts = readEntry(n, 'dist/main/main/tasks/task-session-store.js').toString('utf8');
ok(tr.includes('onEvent: ((b,l)=>(e)=>'), '卡顿补丁: task-runtime batched');
ok(!ts.includes('JSON.stringify(value, null, 2)'), '卡顿补丁: task-session-store compact');
for (const rel of ['dist/main/shared/live2d-actions.js', 'dist/preload/shared/live2d-actions.js']) {
  ok(readEntry(n, rel).toString('utf8').includes('furina:'), '动作表 furina: ' + rel);
}

// --- 与现网逐条对比 ---
console.log('\n== 3) 与现网逐条对比（内容级）==');
const o = openAsar(OLD);
const expectDiff = new Set([
  '/dist/main/main/protocols/bootstrap.js',
  '/dist/renderer/settings/index.html',
  bundle,
  '/dist/main/main/chats/chats-store.js',
  '/dist/main/main/orchestrator/harness/tool-round.js',
  '/dist/main/main/orchestrator/harness/tool-dispatcher.js',
]);
const onlyOld = [];
const diff = [];
for (const [k] of o.map) {
  if (!n.map.has(k)) { onlyOld.push(k); continue; }
  if (!readEntry(o, k).equals(readEntry(n, k))) diff.push(k);
}
const onlyNew = [];
for (const k of n.map.keys()) if (!o.map.has(k)) onlyNew.push(k);

console.log('  only in OLD:', onlyOld.length); onlyOld.slice(0, 20).forEach((k) => console.log('     -', k));
console.log('  only in NEW:', onlyNew.length); onlyNew.slice(0, 20).forEach((k) => console.log('     +', k));
console.log('  content differs:', diff.length);
diff.forEach((k) => console.log('     ~', k, expectDiff.has(k) ? '(预期)' : '(意外!*)'));

ok(onlyOld.length === 0, 'only in OLD = 0');
ok(onlyNew.length === 0, 'only in NEW = 0');
ok(diff.length === 6 && diff.every((k) => expectDiff.has(k)), 'content differs 恰好是 6 个预期文件');

console.log('\n===== 校验结论:', fail ? 'FAIL ❌ (' + fail + ')' : 'PASS ✅', '=====');
fs.closeSync(n.fd); fs.closeSync(o.fd);
process.exit(fail ? 1 : 0);
