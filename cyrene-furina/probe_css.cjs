'use strict';
// 查看设置页 select 的样式来源，以及 .setting-row / .setting-select 的真实规则
const fs = require('fs');
const path = require('path');
const D = 'D:\\ai\\program\\cyrene-furina\\work\\src\\dist\\renderer\\assets';

for (const f of fs.readdirSync(D)) {
  if (!f.endsWith('.css')) continue;
  const s = fs.readFileSync(path.join(D, f), 'utf8');
  const rules = s.match(/[^{}]{0,200}\{[^{}]{0,400}\}/g) || [];
  const hit = rules.filter((r) => /setting-select|setting-row|(^|[,\s])select\b/i.test(r.split('{')[0]));
  if (hit.length) {
    console.log('##### ' + f + ' (' + s.length + ' bytes)');
    for (const r of hit.slice(0, 12)) console.log('  ' + r.replace(/\s+/g, ' ').slice(0, 320));
  }
}
