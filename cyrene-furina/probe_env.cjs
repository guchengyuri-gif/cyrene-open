'use strict';
// 确认：Cyrene 的 userData 目录名、package.json 的 name、设置页 .setting-select 样式
const fs = require('fs');
const path = require('path');

console.log('== %APPDATA% 下与 Cyrene 相关的目录 ==');
const appdata = process.env.APPDATA;
try {
  for (const e of fs.readdirSync(appdata, { withFileTypes: true })) {
    if (/cyrene/i.test(e.name)) {
      const p = path.join(appdata, e.name);
      console.log('  ' + (e.isDirectory() ? '[D]' : '[F]') + ' ' + e.name);
      if (e.isDirectory()) {
        try {
          const sub = fs.readdirSync(p).slice(0, 25);
          console.log('      子项:', sub.join(', '));
        } catch (x) { console.log('      ERR', x.message); }
      }
    }
  }
} catch (e) { console.log('  ERR', e.message); }

console.log('\n== 安装目录 asar 外的 app 目录（若有）==');
const RES = 'C:\\Users\\ADMIN\\AppData\\Local\\Programs\\Cyrene\\resources';
for (const n of ['app', 'pet-models', 'stickers']) {
  const p = path.join(RES, n);
  console.log('  ' + n + ': ' + (fs.existsSync(p) ? 'EXISTS' : 'no'));
}

console.log('\n== asar 内 package.json ==');
const ASAR = path.join(RES, 'app.asar');
try {
  const fd = fs.openSync(ASAR, 'r');
  const hb = Buffer.alloc(8); fs.readSync(fd, hb, 0, 8, 0);
  const hs = hb.readUInt32LE(4);
  const reg = Buffer.alloc(hs); fs.readSync(fd, reg, 0, hs, 8);
  const s = reg.toString('utf8');
  const root = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
  const dataStart = 8 + hs;
  const pkg = root.files['package.json'];
  if (pkg) {
    const buf = Buffer.alloc(pkg.size);
    fs.readSync(fd, buf, 0, pkg.size, dataStart + Number(pkg.offset));
    const j = JSON.parse(buf.toString('utf8'));
    console.log('  name=', j.name, '| productName=', j.productName, '| version=', j.version, '| main=', j.main);
  } else console.log('  no package.json at root');
  fs.closeSync(fd);
} catch (e) { console.log('  ERR', e.message); }

console.log('\n== settings CSS 中 .setting-select 规则 ==');
const CSSDIR = 'D:\\ai\\program\\cyrene-furina\\work\\src\\dist\\renderer\\assets';
for (const f of fs.readdirSync(CSSDIR)) {
  if (!f.endsWith('.css')) continue;
  const s = fs.readFileSync(path.join(CSSDIR, f), 'utf8');
  const i = s.indexOf('.setting-select');
  if (i >= 0) {
    console.log('--- ' + f + ' @' + i + ' ---');
    console.log(s.slice(Math.max(0, i - 120), i + 500));
  }
}
