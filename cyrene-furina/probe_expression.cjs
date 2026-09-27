const fs = require('fs');
const s = fs.readFileSync('D:/ai/program/cyrene-furina/work/src/dist/renderer/assets/renderer-DtFVcmkW.js', 'utf8');
// 找 si.load / resolve 相对URL的实现
for (const key of ['si.load', 'load({url', 'url:o', 'resolveURL', 'resolve(', 'AssetExtension', 'urlToJSON', 'static load(']) {
  let pos = 0;
  const hits = [];
  while (true) {
    const i = s.indexOf(key, pos);
    if (i < 0) break;
    hits.push(i);
    pos = i + 1;
  }
  console.log('KEY', key, 'hits', hits.length);
  for (const h of hits.slice(0, 3)) {
    console.log('  ===', h, '===');
    console.log('  ', s.slice(Math.max(0, h - 80), h + 500).replace(/\n/g, ' '));
    console.log();
  }
}
