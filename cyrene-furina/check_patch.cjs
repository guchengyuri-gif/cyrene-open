'use strict';
// 校验 work/src 里的「外部模型目录」改造是否全部到位
const fs = require('fs');
const T = 'D:/ai/program/cyrene-furina/work/src';
let fail = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fail++; };

console.log('== 1) dist/main/main/protocols/bootstrap.js ==');
const b = fs.readFileSync(T + '/dist/main/main/protocols/bootstrap.js', 'utf8');
ok(b.includes('{ scheme: "cyrene-model", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }'), 'scheme 特权注册');
ok(b.includes('electron_1.protocol.handle("cyrene-model"'), 'handler 注册');
ok(b.includes('path.join(electron_1.app.getPath("userData"), "pet-models")'), '外部根目录 userData/pet-models');
ok(b.includes('path.join(electron_1.app.getAppPath(), "dist", "renderer", "models")'), 'asar 回退根目录');
ok(b.includes('file.startsWith(base + path.sep)'), '穿越防护 startsWith');
ok(b.includes('url_1.pathToFileURL'), 'pathToFileURL 返回');
const hi = b.indexOf('electron_1.protocol.handle("cyrene-model"');
console.log('  ---- handler 源码 ----');
console.log(b.slice(hi, b.indexOf('\n//# sourceMappingURL')).split('\n').map((l) => '  | ' + l).join('\n'));

console.log('\n== 2) dist/renderer/assets/renderer-*.js ==');
const AD = T + '/dist/renderer/assets';
let file = null;
for (const n of fs.readdirSync(AD)) {
  if (!/^renderer-[^/]+\.js$/.test(n) || n.startsWith('renderer-base-')) continue;
  const s = fs.readFileSync(AD + '/' + n, 'utf8');
  if (s.includes('function hx(r)')) { file = n; break; }
}
ok(!!file, 'bundle 定位: ' + file);
const r = fs.readFileSync(AD + '/' + file, 'utf8');
const hx = r.indexOf('function hx(r)');
console.log('  ---- hx() ----');
console.log('  | ' + r.slice(hx, hx + 210));
const call = r.indexOf('const t=hx(r)');
console.log('  ---- 调用点 ----');
console.log('  | ' + r.slice(call - 90, call + 70));
ok(r.includes('cyrene-model://pet/'), 'hx 返回协议 URL');
ok(!r.includes('ef(hx('), 'ef(...) 包装已去除');
ok(r.includes('||"cyrene"'), '空 id 回退 cyrene');

console.log('\n== 3) dist/renderer/settings/index.html ==');
const h = fs.readFileSync(T + '/dist/renderer/settings/index.html', 'utf8');
const pi = h.indexOf('id="pet-model"');
console.log('  ---- 控件段 ----');
console.log(h.slice(pi - 210, pi + 520).split('\n').map((l) => '  | ' + l).join('\n'));
ok(h.includes('id="pet-model-presets"'), 'datalist 存在');
ok(!h.includes('<select id="pet-model"'), 'select 已被替换');
ok(h.includes('value="cyrene"') && h.includes('value="furina"'), 'cyrene/furina 候选保留');

console.log('\nRESULT: ' + (fail ? 'FAIL(' + fail + ')' : 'ALL PASS'));
process.exit(fail ? 1 : 0);
